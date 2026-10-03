import { describe, it, expect, vi } from "vitest";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { ApprovalDecidedHandler } from "../src/handlers/approval-decided.js";
import { IssueUpdatedHandler } from "../src/handlers/issue-updated.js";
import type { PluginConfig } from "../src/config/schema.js";

// Payload shapes the server actually emits (activity-log persistActivity: details + action).
function makeCtx(issue: Record<string, unknown> | null = null) {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    issues: {
      get: vi.fn().mockResolvedValue(issue),
      update: vi.fn().mockResolvedValue({}),
      createComment: vi.fn().mockResolvedValue({}),
      documents: { upsert: vi.fn().mockResolvedValue({}) },
    } as unknown as PluginContext["issues"],
    secrets: { resolve: vi.fn() },
  };
}

function event(eventType: string, payload: Record<string, unknown>): PluginEvent {
  return {
    eventId: "e1",
    eventType,
    occurredAt: new Date().toISOString(),
    actorType: "user",
    entityId: "ent-1",
    entityType: eventType.startsWith("approval") ? "approval" : "issue",
    companyId: "co-1",
    payload,
  } as PluginEvent;
}

const helper = (trigger: Record<string, unknown>) =>
  ({ helpers: [{ name: "h", trigger, exec: { command: "/bin/true" } }] }) as unknown as PluginConfig;

describe("approval.decided payload", () => {
  it("derives status from the emitted action and issue ids from linkedIssueIds", async () => {
    const ctx = makeCtx();
    const handler = new ApprovalDecidedHandler(() => helper({ kind: "approval", event: "decided" }), ctx);
    await handler.handle(event("approval.decided", { action: "approval.approved", type: "t", linkedIssueIds: ["iss-1"] }));
    expect(ctx.issues.documents.upsert).toHaveBeenCalledWith(expect.objectContaining({ issueId: "iss-1" }));
  });

  it("does not fire an approved-only helper on a rejection", async () => {
    const ctx = makeCtx();
    const handler = new ApprovalDecidedHandler(() => helper({ kind: "approval", event: "decided" }), ctx);
    await handler.handle(event("approval.decided", { action: "approval.rejected", linkedIssueIds: ["iss-1"] }));
    expect(ctx.issues.documents.upsert).not.toHaveBeenCalled();
  });
});

describe("issue.updated payload", () => {
  it("matches assignee filters against the current issue on a status-only update", async () => {
    const ctx = makeCtx({ id: "ent-1", assigneeAgentId: "agent-x", title: "Weekly batch", identifier: "HIN-1" });
    const handler = new IssueUpdatedHandler(
      () => helper({ kind: "issue", statusFilter: "done", assigneeAgentId: "agent-x", titleContains: "weekly" }),
      ctx,
    );
    await handler.handle(event("issue.updated", { status: "done", identifier: "HIN-1" }));
    expect(ctx.issues.get).toHaveBeenCalledWith("ent-1", "co-1");
    expect(ctx.issues.documents.upsert).toHaveBeenCalled();
  });

  it("skips the issue fetch when no helper filters on assignee or title", async () => {
    const ctx = makeCtx();
    const handler = new IssueUpdatedHandler(() => helper({ kind: "issue", statusFilter: "done" }), ctx);
    await handler.handle(event("issue.updated", { status: "done" }));
    expect(ctx.issues.get).not.toHaveBeenCalled();
    expect(ctx.issues.documents.upsert).toHaveBeenCalled();
  });
});
