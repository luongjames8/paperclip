import type { PluginContext } from "@paperclipai/plugin-sdk";

/**
 * Thin facade over the SDK host-service clients the conductor needs.
 *
 * Deliberately NOT an outbound-HTTP REST client: ctx.http.fetch is
 * SSRF-filtered (private/reserved IPs are rejected after DNS resolution), so
 * a Docker-internal hostname like `paperclip` can never be reached from the
 * plugin host. The SDK clients run in-process against the same server and
 * need no base URL or API key at all.
 */
export class PaperclipHostClient {
  constructor(private readonly ctx: PluginContext) {}

  async listAgents(companyId: string): Promise<Array<{ id: string; name: string }>> {
    const agents = await this.ctx.agents.list({ companyId });
    return agents.map((a) => ({ id: a.id, name: a.name }));
  }

  async invokeAgent(
    agentId: string,
    companyId: string,
    prompt: string,
    reason: string,
  ): Promise<{ runId: string }> {
    return this.ctx.agents.invoke(agentId, companyId, { prompt, reason });
  }

  async getDocument(
    issueId: string,
    key: string,
    companyId: string,
  ): Promise<{ body: string } | null> {
    const doc = await this.ctx.issues.documents.get(issueId, key, companyId);
    return doc ? { body: doc.body } : null;
  }
}
