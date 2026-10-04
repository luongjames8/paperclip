import type { Issue, PluginContext } from "@paperclipai/plugin-sdk";

export class PaperclipClient {
  constructor(
    private ctx: Pick<PluginContext, "issues">,
    private companyId: string
  ) {}

  async upsertDocument(issueId: string, key: string, content: string): Promise<void> {
    await this.ctx.issues.documents.upsert({ issueId, key, body: content, companyId: this.companyId });
  }

  async postComment(issueId: string, body: string): Promise<void> {
    await this.ctx.issues.createComment(issueId, body, this.companyId);
  }

  async patchIssueStatus(issueId: string, status: string): Promise<void> {
    await this.ctx.issues.update(issueId, { status: status as Issue["status"] }, this.companyId);
  }
}
