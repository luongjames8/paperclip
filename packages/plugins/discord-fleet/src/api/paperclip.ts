import type { PluginContext } from "@paperclipai/plugin-sdk";

export interface PaperclipDocument {
  key: string;
  body: string;
}

export interface PaperclipIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assigneeId?: string;
  assigneeAgentId?: string;
  assigneeUserId?: string;
  projectId?: string;
  parentId?: string;
  originKind?: string;
  updatedAt: string;
  createdAt: string;
  // Present on blocked issues; empty/absent means no declared blockers (black-hole case).
  blockedByIssueIds?: string[];
  // Read by the execution-stage button handler's stale-card guard — the ONLY
  // fields of executionState this client reads. status must be checked
  // alongside currentStageId (codex P2): a "changes requested" cycle keeps
  // the SAME currentStageId (it returns to the same stage on resubmission),
  // so stageId alone can't tell a still-awaiting-decision card from one whose
  // decision window already closed.
  executionState?: { status?: string | null; currentStageId?: string | null } | null;
}

export interface PaperclipInteraction {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  payload?: Record<string, unknown>;
}

export interface PaperclipApproval {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  // Refreshed by the server on resubmit (request-changes cycle reuses the row).
  updatedAt?: string;
  payload?: {
    title?: string;
    // Stable routing discriminator (slot-8): a copy-paste constant the
    // card-creating skill stores; matched ahead of the title by both
    // handleApprovalCreated and the approvals-reminder job.
    approvalType?: string;
    proposedComment?: unknown;
    details?: unknown;
    description?: unknown;
    // Guidance fields resolveApprovalContent/resolveApprovalGuidance read —
    // declared here (GH #501) so callers that type an approval payload as
    // PaperclipApproval["payload"] (e.g. test fixtures) don't need a cast.
    summary?: unknown;
    recommendedAction?: unknown;
    risks?: unknown;
    // Structured posts-batch render contract (GH #501) — see ../render/posts-batch.js.
    postsBatch?: unknown;
  } | null;
}

export interface PaperclipRoutineTrigger {
  id: string;
  kind: string;
  label?: string | null;
  enabled?: boolean;
  cronExpression?: string | null;
  timezone?: string | null;
  nextRunAt?: string | null;
  lastFiredAt?: string | Date | null;
}

export interface PaperclipAgent {
  id: string;
  status?: string | null;
  reportsTo?: string | null;
}

export interface PaperclipRoutineRun {
  id: string;
  status: string;
  failureReason?: string | null;
}

export interface PaperclipRoutine {
  id: string;
  title: string;
  status: string;
  assigneeAgentId?: string | null;
  lastTriggeredAt?: string | Date | null;
  triggers?: PaperclipRoutineTrigger[];
  lastRun?: PaperclipRoutineRun | null;
}

// Typed API error: callers can branch on `status` (e.g. 409 = already decided)
// and always get the URL + a body snippet for triage instead of a bare
// SyntaxError or context-less message.
export class PaperclipApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = "PaperclipApiError";
  }
}

export class PaperclipClient {
  constructor(
    private readonly ctx: PluginContext,
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  private async request<T>(url: string): Promise<T> {
    const res = await this.ctx.http.fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (res.status >= 400) {
      throw new PaperclipApiError(`paperclip API error: ${res.status} ${url}`, res.status, url);
    }
    // A proxy/nginx error page can return 200 with an HTML body; JSON.parse
    // would throw a context-less SyntaxError that crashes a whole sweep. Rethrow
    // as a typed error with status/url so per-item catches can log and continue.
    let body: unknown;
    try {
      body = (await res.json()) as unknown;
    } catch {
      throw new PaperclipApiError(`paperclip API non-JSON response: ${res.status} ${url}`, res.status, url);
    }
    // Current list routes (issues, routines) return bare JSON arrays; older
    // routes wrapped responses in { data: T }. Accept both so a server-side
    // envelope change cannot silently break every consumer again
    // ("issues is not iterable", Jun 2026).
    if (body && typeof body === "object" && !Array.isArray(body) && "data" in body) {
      return (body as { data: T }).data;
    }
    return body as T;
  }

  // List endpoints MUST return arrays. A rate-limit object, null, or any other
  // shape would make `[...page]` spreads throw deep inside a sweep loop —
  // assert here once so every list consumer gets a typed, catchable error.
  private async requestArray<T>(url: string): Promise<T[]> {
    const body = await this.request<unknown>(url);
    if (!Array.isArray(body)) {
      throw new PaperclipApiError(`paperclip API expected array response: ${url}`, 200, url);
    }
    return body as T[];
  }

  // Page through an issues list endpoint using offset pagination.
  // The server accepts up to 1000 rows per page (ISSUE_LIST_MAX_LIMIT).
  // We stop after 2000 total rows and log a warning to avoid runaway fetches.
  private async paginatedIssues(baseUrl: string): Promise<PaperclipIssue[]> {
    const PAGE_SIZE = 1000;
    const MAX_TOTAL = 2000;
    const separator = baseUrl.includes("?") ? "&" : "?";
    const all: PaperclipIssue[] = [];
    let offset = 0;
    while (true) {
      const url = `${baseUrl}${separator}limit=${PAGE_SIZE}&offset=${offset}`;
      const page = await this.requestArray<PaperclipIssue>(url);
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (all.length >= MAX_TOTAL) {
        this.ctx.logger.warn("discord-fleet: paginatedIssues hit 2000-row cap; some issues may be skipped", { baseUrl });
        break;
      }
    }
    return all;
  }

  async getInProgressIssues(companyId: string): Promise<PaperclipIssue[]> {
    return this.paginatedIssues(`${this.baseUrl}/api/companies/${companyId}/issues?status=in_progress`);
  }

  async getErrorsLast24h(companyId: string): Promise<PaperclipIssue[]> {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    return this.paginatedIssues(`${this.baseUrl}/api/companies/${companyId}/issues?status=blocked&updatedSince=${since}`);
  }

  async getRoutines(companyId: string): Promise<PaperclipRoutine[]> {
    const url = `${this.baseUrl}/api/companies/${companyId}/routines`;
    const rows = await this.requestArray<PaperclipRoutine>(url);
    if (rows.length >= 100) {
      this.ctx.logger.warn("discord-fleet: getRoutines returned >=100 rows — verify the endpoint is not truncating", { companyId });
    }
    return rows;
  }

  async getAgents(companyId: string): Promise<PaperclipAgent[]> {
    const url = `${this.baseUrl}/api/companies/${companyId}/agents`;
    return this.requestArray<PaperclipAgent>(url);
  }

  // Single-issue fetch. NOTE: the only registered GET route for one issue is
  // /api/issues/:id (server/src/routes/issues.ts) — there is no company-scoped
  // variant; company access is enforced server-side from the caller's auth,
  // not a path segment (codex P1: an earlier company-scoped URL here always
  // 404'd, so every stale-stage check silently treated the current stage as
  // stale).
  async getIssueById(issueId: string): Promise<PaperclipIssue | null> {
    const url = `${this.baseUrl}/api/issues/${issueId}`;
    const res = await this.ctx.http.fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (res.status === 404) {
      return null;
    }
    if (res.status >= 400) {
      throw new PaperclipApiError(`paperclip API error: ${res.status} ${url}`, res.status, url);
    }
    let body: unknown;
    try {
      body = (await res.json()) as unknown;
    } catch {
      throw new PaperclipApiError(`paperclip API non-JSON response: ${res.status} ${url}`, res.status, url);
    }
    if (body && typeof body === "object" && "data" in body) {
      return (body as { data: PaperclipIssue }).data;
    }
    return body as PaperclipIssue;
  }

  async listIssueComments(issueId: string, opts: { limit?: number } = {}): Promise<Array<{ id?: string; body?: string; createdAt?: string; authorAgentId?: string | null }>> {
    // Explicit order+limit (codex): the route defaults to order=desc with NO
    // limit — an unbounded fetch of a long-running issue's whole history just
    // to build one card. desc + small limit = the newest N, bounded.
    const limit = opts.limit ?? 10;
    return this.requestArray(`${this.baseUrl}/api/issues/${issueId}/comments?order=desc&limit=${limit}`);
  }

  async listIssueDocuments(issueId: string): Promise<PaperclipDocument[]> {
    const rows = await this.requestArray<PaperclipDocument>(`${this.baseUrl}/api/issues/${issueId}/documents`);
    if (rows.length >= 100) {
      this.ctx.logger.warn("discord-fleet: listIssueDocuments returned >=100 rows — verify the endpoint is not truncating", { issueId });
    }
    return rows;
  }

  async getApprovalIssues(approvalId: string): Promise<PaperclipIssue[]> {
    const rows = await this.requestArray<PaperclipIssue>(`${this.baseUrl}/api/approvals/${approvalId}/issues`);
    if (rows.length >= 100) {
      this.ctx.logger.warn("discord-fleet: getApprovalIssues returned >=100 rows — verify the endpoint is not truncating", { approvalId });
    }
    return rows;
  }

  async getPendingApprovals(companyId: string): Promise<PaperclipApproval[]> {
    // Single fetch: the approvals route returns the full set in one response
    // (observed live 2026-07-02: 175 rows in one call — no low default page cap).
    // Warn if a response ever looks truncated so a future server-side cap is
    // visible instead of silently hiding pending cards from the reminder sweep.
    const rows = await this.requestArray<PaperclipApproval>(`${this.baseUrl}/api/companies/${companyId}/approvals?status=pending`);
    if (rows.length >= 1000) {
      this.ctx.logger.warn("discord-fleet: getPendingApprovals returned >=1000 rows — verify the endpoint is not paginating/truncating", { companyId });
    }
    return rows;
  }

  async getApprovalById(approvalId: string): Promise<PaperclipApproval | null> {
    const url = `${this.baseUrl}/api/approvals/${approvalId}`;
    const res = await this.ctx.http.fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (res.status === 404) {
      return null;
    }
    if (res.status >= 400) {
      throw new PaperclipApiError(`paperclip API error: ${res.status} ${url}`, res.status, url);
    }
    let body: unknown;
    try {
      body = (await res.json()) as unknown;
    } catch {
      throw new PaperclipApiError(`paperclip API non-JSON response: ${res.status} ${url}`, res.status, url);
    }
    if (body && typeof body === "object" && "data" in body) {
      return (body as { data: PaperclipApproval }).data;
    }
    return body as PaperclipApproval;
  }

  async getBlockedIssues(companyId: string): Promise<PaperclipIssue[]> {
    // includeBlockedBy=true causes the server to return a `blockedBy` array on
    // each issue (objects with at least an `id` field).  We normalise that into
    // the `blockedByIssueIds` field expected by the stuck-detector so that
    // issues with real blockers are NOT misclassified as stranded (codex P2).
    const raw = await this.paginatedIssues(`${this.baseUrl}/api/companies/${companyId}/issues?status=blocked&includeBlockedBy=true`);
    return raw.map((issue) => {
      const blockedBy = (issue as unknown as { blockedBy?: Array<{ id: string }> }).blockedBy;
      if (!Array.isArray(blockedBy)) return issue;
      return { ...issue, blockedByIssueIds: blockedBy.map((b) => b.id) };
    });
  }

  async getAssignedTodoIssues(companyId: string): Promise<PaperclipIssue[]> {
    return this.paginatedIssues(`${this.baseUrl}/api/companies/${companyId}/issues?status=todo`);
  }

  async getOpenIssues(companyId: string): Promise<PaperclipIssue[]> {
    // Three separate requests; combine client-side since query doesn't support multi-value status.
    // in_review is included because upstream guidance parks issues awaiting a
    // request_confirmation response there (server/src/onboarding-assets/ceo/HEARTBEAT.md).
    const [backlog, todo, inReview] = await Promise.all([
      this.paginatedIssues(`${this.baseUrl}/api/companies/${companyId}/issues?status=backlog`),
      this.paginatedIssues(`${this.baseUrl}/api/companies/${companyId}/issues?status=todo`),
      this.paginatedIssues(`${this.baseUrl}/api/companies/${companyId}/issues?status=in_review`),
    ]);
    return [...backlog, ...todo, ...inReview];
  }

  /** @deprecated Use getOpenIssues — also sweeps in_review. */
  async getBacklogAndTodoIssues(companyId: string): Promise<PaperclipIssue[]> {
    return this.getOpenIssues(companyId);
  }

  async listIssueInteractions(issueId: string): Promise<PaperclipInteraction[]> {
    // Issue-scoped and small in practice; requestArray guards the shape.
    const rows = await this.requestArray<PaperclipInteraction>(`${this.baseUrl}/api/issues/${issueId}/interactions`);
    if (rows.length >= 100) {
      this.ctx.logger.warn("discord-fleet: listIssueInteractions returned >=100 rows — verify the endpoint is not truncating", { issueId });
    }
    return rows;
  }

  async acceptInteraction(issueId: string, interactionId: string): Promise<void> {
    const url = `${this.baseUrl}/api/issues/${issueId}/interactions/${interactionId}/accept`;
    const res = await this.ctx.http.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (res.status >= 400) {
      const text = await res.text().catch(() => "");
      throw new PaperclipApiError(`paperclip API acceptInteraction error: ${res.status} ${url} ${text.slice(0, 200)}`, res.status, url);
    }
  }

  async rejectInteraction(issueId: string, interactionId: string, reason: string): Promise<void> {
    const url = `${this.baseUrl}/api/issues/${issueId}/interactions/${interactionId}/reject`;
    const res = await this.ctx.http.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason }),
    });
    if (res.status >= 400) {
      const text = await res.text().catch(() => "");
      throw new PaperclipApiError(`paperclip API rejectInteraction error: ${res.status} ${url} ${text.slice(0, 200)}`, res.status, url);
    }
  }

  // Drives an executionPolicy review/approval stage decision — NOT the
  // approvals endpoints (a different entity family; issue.executionState vs
  // the approvals table). status:"done" with a comment approves the current
  // stage; any other status (typically "in_progress") with a comment
  // requests changes and returns the issue to its executor. The runtime
  // requires a non-empty comment on both outcomes (issue-execution-policy.ts).
  //
  // expectedExecutionStageId (fleet issue #631 / PR-0, codex P1 round 3): a
  // compare-and-swap guard the server enforces ATOMICALLY as part of this
  // same request — pass the stageId the caller observed as pending (e.g. a
  // Discord card's customId) and the server rejects with 409 if that stage
  // is no longer the current one. Replaces an earlier client-side
  // GET-then-PATCH pre-check, which left a round-trip race window this
  // closes by construction.
  async updateIssueStatus(
    issueId: string,
    status: string,
    comment: string,
    expectedExecutionStageId?: string,
  ): Promise<void> {
    const url = `${this.baseUrl}/api/issues/${issueId}`;
    const res = await this.ctx.http.fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status, comment, ...(expectedExecutionStageId ? { expectedExecutionStageId } : {}) }),
    });
    if (res.status >= 400) {
      const text = await res.text().catch(() => "");
      throw new PaperclipApiError(`paperclip API updateIssueStatus error: ${res.status} ${url} ${text.slice(0, 200)}`, res.status, url);
    }
  }

  async approveApproval(approvalId: string, decisionNote?: string): Promise<void> {
    await this.resolveApproval(approvalId, "approve", decisionNote);
  }

  async rejectApproval(approvalId: string, decisionNote?: string): Promise<void> {
    await this.resolveApproval(approvalId, "reject", decisionNote);
  }

  async requestRevisionApproval(approvalId: string, decisionNote?: string): Promise<void> {
    await this.resolveApproval(approvalId, "request-revision", decisionNote);
  }

  async addApprovalComment(approvalId: string, body: string): Promise<void> {
    const url = `${this.baseUrl}/api/approvals/${approvalId}/comments`;
    const res = await this.ctx.http.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    });
    if (res.status >= 400) {
      const text = await res.text().catch(() => "");
      throw new PaperclipApiError(`paperclip API addApprovalComment error: ${res.status} ${url} ${text.slice(0, 200)}`, res.status, url);
    }
  }

  private async resolveApproval(
    approvalId: string,
    action: "approve" | "reject" | "request-revision",
    decisionNote?: string,
  ): Promise<void> {
    const url = `${this.baseUrl}/api/approvals/${approvalId}/${action}`;
    const body = decisionNote ? JSON.stringify({ decisionNote }) : "{}";
    const res = await this.ctx.http.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (res.status >= 400) {
      const text = await res.text().catch(() => "");
      throw new PaperclipApiError(`paperclip API ${action} error: ${res.status} ${url} ${text.slice(0, 200)}`, res.status, url);
    }
  }
}
