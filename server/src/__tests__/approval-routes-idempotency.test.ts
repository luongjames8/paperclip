import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  requestRevision: vi.fn(),
  resubmit: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  listIssuesForApproval: vi.fn(),
  linkManyForApproval: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeHireApprovalPayloadForPersistence: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn(),
}));

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    accessService: () => mockAccessService,
    approvalService: () => mockApprovalService,
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => mockIssueApprovalService,
    logActivity: mockLogActivity,
    secretService: () => mockSecretService,
  }));
}

async function createApp(actorOverrides: Record<string, unknown> = {}) {
  const [{ errorHandler }, { approvalRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/approvals.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
      ...actorOverrides,
    };
    next();
  });
  app.use("/api", approvalRoutes(createRouteDb()));
  app.use(errorHandler);
  return app;
}

// Matches routes/approvals.ts resolveApprovalKindFromLinkedIssues' `db.select({
// id: issues.id, approvalKind: issues.approvalKind })` query (fleet issue #687).
// Default stub ("found, no kind" for the one fixed issueId this file's
// existing create-approval-with-issueIds fixture sends) keeps that older test
// passing without opting in; pass approvalKindRows explicitly to unit-test
// the route's own handling of the query result (conflicting kinds, missing
// issueIds) — see createApprovalKindRouteDb below.
const DEFAULT_ISSUE_APPROVAL_KIND_ROWS = [{ id: "00000000-0000-0000-0000-000000000001", approvalKind: null }];

function createRouteDb(
  contextSnapshot: Record<string, unknown> = {},
  runId = "run-1",
  agentId = "agent-1",
  approvalKindRows: Array<{ id: string; approvalKind: string | null }> = DEFAULT_ISSUE_APPROVAL_KIND_ROWS,
) {
  const runRows = [{
    id: runId,
    companyId: "company-1",
    agentId,
    contextSnapshot,
  }];
  return {
    select: vi.fn((selection: Record<string, unknown> = {}) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          then: async (resolve: (rows: unknown[]) => unknown) => {
            const keys = Object.keys(selection);
            if (keys.includes("contextSnapshot")) return resolve(runRows);
            if (keys.includes("approvalKind")) return resolve(approvalKindRows);
            return resolve([]);
          },
        })),
      })),
    })),
  } as any;
}

// Thin alias for tests that only care about the approvalKind query shape
// (conflicting kinds, missing issueIds) — same mock as createRouteDb, just
// without needing to spell out the contextSnapshot/runId/agentId defaults.
function createApprovalKindRouteDb(rows: Array<{ id: string; approvalKind: string | null }>) {
  return createRouteDb(undefined, undefined, undefined, rows);
}

async function createAgentApp(options: { runId?: string; contextSnapshot?: Record<string, unknown>; db?: unknown } = {}) {
  const [{ errorHandler }, { approvalRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/approvals.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      runId: options.runId ?? "run-1",
      source: "api_key",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", approvalRoutes((options.db ?? createRouteDb(options.contextSnapshot, options.runId ?? "run-1")) as any));
  app.use(errorHandler);
  return app;
}

describe("approval routes idempotent retries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/approvals.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockApprovalService.list.mockReset();
    mockApprovalService.getById.mockReset();
    mockApprovalService.create.mockReset();
    mockApprovalService.approve.mockReset();
    mockApprovalService.reject.mockReset();
    mockApprovalService.requestRevision.mockReset();
    mockApprovalService.resubmit.mockReset();
    mockApprovalService.listComments.mockReset();
    mockApprovalService.addComment.mockReset();
    mockAgentService.getById.mockReset();
    mockHeartbeatService.wakeup.mockReset();
    mockIssueApprovalService.listIssuesForApproval.mockReset();
    mockIssueApprovalService.linkManyForApproval.mockReset();
    mockSecretService.normalizeHireApprovalPayloadForPersistence.mockReset();
    mockLogActivity.mockReset();
    mockAccessService.decide.mockReset();
    mockAccessService.decide.mockResolvedValue({
      allowed: true,
      action: "company_scope:read",
      reason: "allow_test",
      explanation: "Allowed by test mock.",
    });
    // Default: agent belongs to the same company as the approval.
    mockAgentService.getById.mockResolvedValue({ id: "agent-42", companyId: "company-1" });
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "wake-1" });
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([{ id: "issue-1", status: "backlog", assigneeAgentId: "agent-42" }]);
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("does not emit duplicate approval side effects when approve is already resolved", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "approved",
      payload: {},
      requestedByAgentId: "agent-1",
    });
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-1",
        companyId: "company-1",
        type: "hire_agent",
        status: "approved",
        payload: {},
        requestedByAgentId: "agent-1",
      },
      applied: false,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-1/approve")
      .send({});

    expect(res.status).toBe(200);
    expect(mockIssueApprovalService.listIssuesForApproval).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("does not emit duplicate rejection logs when reject is already resolved", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "rejected",
      payload: {},
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-1",
        companyId: "company-1",
        type: "hire_agent",
        status: "rejected",
        payload: {},
      },
      applied: false,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-1/reject")
      .send({});

    expect(res.status).toBe(200);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("rejects approval decisions for companies outside the caller scope", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-2",
      companyId: "company-2",
      type: "hire_agent",
      status: "pending",
      payload: {},
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-2/approve")
      .send({});

    expect(res.status).toBe(403);
    expect(mockApprovalService.approve).not.toHaveBeenCalled();
  });

  it("rejects approval revision requests for companies outside the caller scope", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-3",
      companyId: "company-2",
      type: "hire_agent",
      status: "pending",
      payload: {},
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-3/request-revision")
      .send({ decisionNote: "Need changes" });

    expect(res.status).toBe(403);
    expect(mockApprovalService.requestRevision).not.toHaveBeenCalled();
  });

  it("derives approval attribution from the authenticated actor on approve", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-4",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: {},
      requestedByAgentId: null,
    });
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-4",
        companyId: "company-1",
        type: "hire_agent",
        status: "approved",
        payload: {},
        requestedByAgentId: null,
      },
      applied: true,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-4/approve")
      .send({ decidedByUserId: "forged-user", decisionNote: "ship it" });

    expect(res.status).toBe(200);
    expect(mockApprovalService.approve).toHaveBeenCalledWith("approval-4", "user-1", "ship it");
  });

  it("derives approval attribution from the authenticated actor on reject", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-5",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: {},
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-5",
        companyId: "company-1",
        type: "hire_agent",
        status: "rejected",
        payload: {},
      },
      applied: true,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-5/reject")
      .send({ decidedByUserId: "forged-user", decisionNote: "not now" });

    expect(res.status).toBe(200);
    expect(mockApprovalService.reject).toHaveBeenCalledWith("approval-5", "user-1", "not now");
  });

  it("wakes the requesting agent with approval_rejected reason when reject is applied", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-7",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-42",
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-7",
        companyId: "company-1",
        type: "request_board_approval",
        status: "rejected",
        payload: {},
        requestedByAgentId: "agent-42",
      },
      applied: true,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-7/reject")
      .send({ decisionNote: "not aligned with strategy" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "agent-42",
      expect.objectContaining({
        reason: "approval_rejected",
        payload: expect.objectContaining({
          approvalId: "approval-7",
          approvalStatus: "rejected",
          decisionNote: "not aligned with strategy",
          issueId: "issue-1",
          issueIds: ["issue-1"],
        }),
        contextSnapshot: expect.objectContaining({
          wakeReason: "approval_rejected",
          approvalId: "approval-7",
          approvalStatus: "rejected",
          decisionNote: "not aligned with strategy",
        }),
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "approval.requester_wakeup_queued",
        details: expect.objectContaining({
          wakeReason: "approval_rejected",
          requesterAgentId: "agent-42",
        }),
      }),
    );
  });

  it("does not wake when reject is already applied (applied=false)", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-8",
      companyId: "company-1",
      type: "request_board_approval",
      status: "rejected",
      payload: {},
      requestedByAgentId: "agent-42",
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-8",
        companyId: "company-1",
        type: "request_board_approval",
        status: "rejected",
        payload: {},
        requestedByAgentId: "agent-42",
      },
      applied: false,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-8/reject")
      .send({});

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("does not wake on reject when requestedByAgentId is null", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-9",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: null,
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-9",
        companyId: "company-1",
        type: "request_board_approval",
        status: "rejected",
        payload: {},
        requestedByAgentId: null,
      },
      applied: true,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-9/reject")
      .send({ decisionNote: "no agent, no wake" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("derives approval attribution from the authenticated actor on request revision", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-6",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: {},
    });
    mockApprovalService.requestRevision.mockResolvedValue({
      id: "approval-6",
      companyId: "company-1",
      type: "hire_agent",
      status: "revision_requested",
      payload: {},
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-6/request-revision")
      .send({ decidedByUserId: "forged-user", decisionNote: "Need changes" });

    expect(res.status).toBe(200);
    expect(mockApprovalService.requestRevision).toHaveBeenCalledWith(
      "approval-6",
      "user-1",
      "Need changes",
    );
  });

  it("does not wake a cross-company agent on reject", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-10",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-foreign",
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-10",
        companyId: "company-1",
        type: "request_board_approval",
        status: "rejected",
        payload: {},
        requestedByAgentId: "agent-foreign",
      },
      applied: true,
    });
    // Agent belongs to a different company — guard must block the wake.
    mockAgentService.getById.mockResolvedValue({ id: "agent-foreign", companyId: "company-other" });

    const res = await request(await createApp())
      .post("/api/approvals/approval-10/reject")
      .send({ decisionNote: "cross-company reject" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("uses the first non-terminal linked issue as the wake anchor (done first, backlog second)", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-20",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-42",
    });
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-20",
        companyId: "company-1",
        type: "request_board_approval",
        status: "approved",
        payload: {},
        requestedByAgentId: "agent-42",
      },
      applied: true,
    });
    // Editor issue is done; parent issue (backlog) should be the anchor.
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([
      { id: "editor-done", status: "done" },
      { id: "parent-backlog", status: "backlog", assigneeAgentId: "agent-42" },
    ]);

    const res = await request(await createApp())
      .post("/api/approvals/approval-20/approve")
      .send({});

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "agent-42",
      expect.objectContaining({
        payload: expect.objectContaining({
          issueId: "parent-backlog",
          issueIds: ["editor-done", "parent-backlog"],
        }),
        contextSnapshot: expect.objectContaining({
          issueId: "parent-backlog",
          taskId: "parent-backlog",
        }),
      }),
    );
  });

  it("does not anchor to a non-terminal issue owned by a DIFFERENT agent (would be cancelled as stale)", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-21",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-42",
    });
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-21",
        companyId: "company-1",
        type: "request_board_approval",
        status: "approved",
        payload: {},
        requestedByAgentId: "agent-42",
      },
      applied: true,
    });
    // Requester's own issue is done; the only live issue belongs to another
    // agent — anchoring there would get the queued run cancelled as stale
    // (assigneeAgentId !== run.agentId). Expect an agent-level wake instead.
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([
      { id: "editor-done", status: "done", assigneeAgentId: "agent-42" },
      { id: "poster-backlog", status: "backlog", assigneeAgentId: "agent-publisher" },
    ]);

    const res = await request(await createApp())
      .post("/api/approvals/approval-21/approve")
      .send({});

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "agent-42",
      expect.objectContaining({
        payload: expect.objectContaining({ issueId: null }),
      }),
    );
  });

  it("uses null anchor (agent-level wake) when all linked issues are terminal", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-21",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-42",
    });
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-21",
        companyId: "company-1",
        type: "request_board_approval",
        status: "approved",
        payload: {},
        requestedByAgentId: "agent-42",
      },
      applied: true,
    });
    // All linked issues terminal — anchor must be null so the run is not cancelled.
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([
      { id: "issue-done", status: "done" },
      { id: "issue-cancelled", status: "cancelled" },
    ]);

    const res = await request(await createApp())
      .post("/api/approvals/approval-21/approve")
      .send({});

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "agent-42",
      expect.objectContaining({
        payload: expect.objectContaining({
          issueId: null,
          issueIds: ["issue-done", "issue-cancelled"],
        }),
        contextSnapshot: expect.objectContaining({
          issueId: null,
          taskId: null,
        }),
      }),
    );
  });

  it("lets agents create generic issue-linked board approval requests", async () => {
    mockApprovalService.create.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "request_board_approval",
      requestedByAgentId: "agent-1",
      requestedByUserId: null,
      status: "pending",
      payload: { title: "Approve hosting spend", proposedComment: "## Section\nProposed body" },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: new Date("2026-04-06T00:00:00.000Z"),
      updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    });

    const res = await request(await createAgentApp())
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        issueIds: ["00000000-0000-0000-0000-000000000001"],
        payload: {
          title: "Approve hosting spend",
          proposedComment: "## Section\nProposed body",
          approvalType: "content_batch_approval",
        },
      });

    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body).toMatchObject({
      companyId: "company-1",
      type: "request_board_approval",
      requestedByAgentId: "agent-1",
      requestedByUserId: null,
      status: "pending",
    });
    expect(mockSecretService.normalizeHireApprovalPayloadForPersistence).not.toHaveBeenCalled();
    expect(mockIssueApprovalService.linkManyForApproval).toHaveBeenCalledWith(
      "approval-1",
      ["00000000-0000-0000-0000-000000000001"],
      { agentId: "agent-1", userId: null },
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "agent",
        actorId: "agent-1",
        action: "approval.created",
        // Downstream consumers (discord-fleet plugin's approvalsChannelsByType
        // regex routing + chunked-comment posting) match on details.title and
        // read details.proposedComment; if either is dropped from the emit,
        // routes fall through to the orphan fallback and the proposedComment
        // is silently dropped.
        details: expect.objectContaining({
          type: "request_board_approval",
          issueIds: ["00000000-0000-0000-0000-000000000001"],
          title: "Approve hosting spend",
          proposedComment: "## Section\nProposed body",
          // The slot-8 routing discriminator MUST ride the event details —
          // the plugin handler receives these details, not the stored
          // payload; dropping this forwards silently kills discriminator
          // routing (codex P1, PR #26).
          approvalType: "content_batch_approval",
        }),
      }),
    );
  });

  // ─── approvalKind derivation at approval creation (fleet issue #687) ───────

  it("derives approvalKind from a single consistent linked issue and persists + forwards it", async () => {
    mockApprovalService.create.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "request_board_approval",
      requestedByAgentId: "agent-1",
      requestedByUserId: null,
      status: "pending",
      approvalKind: "content_batch_approval",
      payload: { title: "Weekly content batch" },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: new Date("2026-04-06T00:00:00.000Z"),
      updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    });

    const db = createApprovalKindRouteDb([
      { id: "00000000-0000-0000-0000-000000000001", approvalKind: "content_batch_approval" },
    ]);
    const res = await request(await createAgentApp({ db }))
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        issueIds: ["00000000-0000-0000-0000-000000000001"],
        payload: { title: "Weekly content batch" },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ approvalKind: "content_batch_approval" }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        details: expect.objectContaining({ approvalKind: "content_batch_approval" }),
      }),
    );
  });

  it("rejects (422) creating an approval whose linked issues carry conflicting approvalKind values — zero approval created", async () => {
    const db = createApprovalKindRouteDb([
      { id: "11111111-1111-1111-1111-111111111111", approvalKind: "content_batch_approval" },
      { id: "22222222-2222-2222-2222-222222222222", approvalKind: "hire_review" },
    ]);
    const res = await request(await createAgentApp({ db }))
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        issueIds: [
          "11111111-1111-1111-1111-111111111111",
          "22222222-2222-2222-2222-222222222222",
        ],
        payload: { title: "Conflicting chain" },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error).toContain("conflicting approvalKind");
    expect(mockApprovalService.create).not.toHaveBeenCalled();
  });

  it("rejects (422) creating an approval linked to a nonexistent/cross-company issueId — zero approval created", async () => {
    // Only ONE of the two requested issueIds resolves — the query is scoped
    // by companyId, so a foreign/nonexistent id is silently absent from the
    // result set; the route must catch the count mismatch rather than
    // silently resolving approvalKind from a subset of what was requested.
    const db = createApprovalKindRouteDb([
      { id: "11111111-1111-1111-1111-111111111111", approvalKind: null },
    ]);
    const res = await request(await createAgentApp({ db }))
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        issueIds: [
          "11111111-1111-1111-1111-111111111111",
          "99999999-9999-9999-9999-999999999999",
        ],
        payload: { title: "Bad issueId" },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error).toContain("do not exist in this company");
    expect(res.body.details?.missingIssueIds).toEqual(["99999999-9999-9999-9999-999999999999"]);
    expect(mockApprovalService.create).not.toHaveBeenCalled();
  });

  it("an agent-supplied payload.approvalKind is never read — the server-derived value always wins", async () => {
    mockApprovalService.create.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "request_board_approval",
      requestedByAgentId: "agent-1",
      requestedByUserId: null,
      status: "pending",
      approvalKind: "content_batch_approval",
      payload: { title: "Weekly content batch" },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: new Date("2026-04-06T00:00:00.000Z"),
      updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    });

    const db = createApprovalKindRouteDb([
      { id: "00000000-0000-0000-0000-000000000001", approvalKind: "content_batch_approval" },
    ]);
    const res = await request(await createAgentApp({ db }))
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        issueIds: ["00000000-0000-0000-0000-000000000001"],
        payload: { title: "Weekly content batch", approvalKind: "agent_made_this_up" },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // The server-derived kind (from the linked issue) wins — the agent's
    // payload.approvalKind is never consulted for routing purposes.
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ approvalKind: "content_batch_approval" }),
    );
  });

  it("blocks status-only recovery runs from creating approvals", async () => {
    const res = await request(await createAgentApp({
      contextSnapshot: {
        modelProfile: "cheap",
        recoveryIntent: "status_only",
        allowDeliverableWork: false,
        allowDocumentUpdates: false,
        resumeRequiresNormalModel: true,
      },
    }))
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        payload: { title: "Approve hosting spend" },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toContain("Cheap status-only recovery runs cannot create or modify approvals");
    expect(mockApprovalService.create).not.toHaveBeenCalled();
    expect(mockIssueApprovalService.linkManyForApproval).not.toHaveBeenCalled();
  });

  it("blocks status-only recovery runs from resubmitting approvals", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-7",
      companyId: "company-1",
      type: "request_board_approval",
      status: "revision_requested",
      payload: {},
      requestedByAgentId: "agent-1",
    });

    const res = await request(await createAgentApp({
      contextSnapshot: {
        modelProfile: "cheap",
        recoveryIntent: "status_only",
        allowDeliverableWork: false,
        allowDocumentUpdates: false,
        resumeRequiresNormalModel: true,
      },
    }))
      .post("/api/approvals/approval-7/resubmit")
      .send({ payload: { title: "Retry" } });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toContain("Cheap status-only recovery runs cannot create or modify approvals");
    expect(mockApprovalService.resubmit).not.toHaveBeenCalled();
  });

  it("blocks status-only recovery runs from commenting on approvals", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-8",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-1",
    });

    const res = await request(await createAgentApp({
      contextSnapshot: {
        modelProfile: "cheap",
        recoveryIntent: "status_only",
        allowDeliverableWork: false,
        allowDocumentUpdates: false,
        resumeRequiresNormalModel: true,
      },
    }))
      .post("/api/approvals/approval-8/comments")
      .send({ body: "please approve" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toContain("Cheap status-only recovery runs cannot create or modify approvals");
    expect(mockApprovalService.addComment).not.toHaveBeenCalled();
  });
});
