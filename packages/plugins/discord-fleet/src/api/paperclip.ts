import type { PluginContext } from "@paperclipai/plugin-sdk";

export interface PaperclipIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assigneeId?: string;
  projectId?: string;
  parentId?: string;
  originKind?: string;
  updatedAt: string;
  createdAt: string;
}

export interface PaperclipRoutine {
  id: string;
  name: string;
  enabled: boolean;
  lastTriggeredAt?: string;
  schedule?: {
    type: "cron";
    expression: string;
  };
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
      throw new Error(`paperclip API error: ${res.status} ${url}`);
    }
    const body = (await res.json()) as { data: T };
    return body.data;
  }

  async getInProgressIssues(companyId: string): Promise<PaperclipIssue[]> {
    const url = `${this.baseUrl}/api/companies/${companyId}/issues?status=in_progress`;
    return this.request<PaperclipIssue[]>(url);
  }

  async getErrorsLast24h(companyId: string): Promise<PaperclipIssue[]> {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const url = `${this.baseUrl}/api/companies/${companyId}/issues?status=blocked&updatedSince=${since}`;
    return this.request<PaperclipIssue[]>(url);
  }

  async getRoutines(companyId: string): Promise<PaperclipRoutine[]> {
    const url = `${this.baseUrl}/api/companies/${companyId}/routines`;
    return this.request<PaperclipRoutine[]>(url);
  }

  async getIssueById(companyId: string, issueId: string): Promise<PaperclipIssue | null> {
    const url = `${this.baseUrl}/api/companies/${companyId}/issues/${issueId}`;
    const res = await this.ctx.http.fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (res.status === 404) {
      return null;
    }
    if (res.status >= 400) {
      throw new Error(`paperclip API error: ${res.status} ${url}`);
    }
    const body = (await res.json()) as { data: PaperclipIssue };
    return body.data;
  }

  async approveApproval(approvalId: string, decisionNote?: string): Promise<void> {
    await this.resolveApproval(approvalId, "approve", decisionNote);
  }

  async rejectApproval(approvalId: string, decisionNote?: string): Promise<void> {
    await this.resolveApproval(approvalId, "reject", decisionNote);
  }

  private async resolveApproval(approvalId: string, action: "approve" | "reject", decisionNote?: string): Promise<void> {
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
      throw new Error(`paperclip API ${action} error: ${res.status} ${url} ${text}`);
    }
  }
}
