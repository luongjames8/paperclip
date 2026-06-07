import type { PluginContext } from "@paperclipai/plugin-sdk";

export class PaperclipRestClient {
  constructor(
    private readonly ctx: PluginContext,
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async listAgents(companyId: string): Promise<Array<{ id: string; name: string }>> {
    const url = `${this.baseUrl}/api/companies/${companyId}/agents`;
    const res = await this.ctx.http.fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (res.status >= 400) {
      throw new Error(`paperclip API error: ${res.status} ${url}`);
    }
    return (await res.json()) as Array<{ id: string; name: string }>;
  }

  async invokeAgent(agentId: string, prompt: string, reason: string): Promise<{ runId: string }> {
    const url = `${this.baseUrl}/api/agents/${agentId}/wakeup`;
    const res = await this.ctx.http.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "automation", triggerDetail: "system", reason, payload: { prompt } }),
    });
    if (res.status >= 400) {
      throw new Error(`paperclip API error: ${res.status} ${url}`);
    }
    const body = (await res.json()) as { id?: string; data?: { id?: string }; status?: string };
    if (body.status === "skipped") {
      throw new Error("Agent wakeup was skipped by heartbeat policy");
    }
    const runId = body.id ?? body.data?.id;
    if (!runId) {
      throw new Error(`paperclip API wakeup: missing run id in response from ${url}`);
    }
    return { runId };
  }

  async getDocument(issueId: string, key: string): Promise<{ body: string } | null> {
    const url = `${this.baseUrl}/api/issues/${issueId}/documents`;
    const res = await this.ctx.http.fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (res.status >= 400) {
      throw new Error(`paperclip API error: ${res.status} ${url}`);
    }
    const docs = (await res.json()) as Array<{ key: string; body: string }>;
    const found = docs.find((d) => d.key === key);
    return found ? { body: found.body } : null;
  }
}
