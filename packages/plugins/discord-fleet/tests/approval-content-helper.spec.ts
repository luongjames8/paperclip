/**
 * Tests for resolveApprovalContent (CHANGE 1 shared helper) and the
 * "always post content" behaviour in handleApprovalCreated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postToThread: vi.fn().mockResolvedValue("msg-1"),
  postToChannel: vi.fn().mockResolvedValue("msg-2"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-3"),
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-4"),
  postEmbedsToChannel: vi.fn().mockResolvedValue("msg-5"),
}));

vi.mock("../src/render/issue-docs.js", () => ({
  renderIssueDocs: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/api/paperclip.js", () => ({
  PaperclipClient: vi.fn().mockImplementation(() => ({
    getApprovalIssues: vi.fn().mockResolvedValue([]),
    listIssueDocuments: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("../src/render/embeds.js", () => ({
  buildApprovalEmbed: vi.fn().mockReturnValue({ title: "approval embed" }),
  buildApprovalActionRow: vi.fn().mockReturnValue({ type: 1, components: [] }),
  APPROVAL_BUTTON_PREFIX: { approve: "approval-approve:", reject: "approval-reject:" },
}));

function makeConfig(): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: "c1",
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "tc1",
      },
    ],
  };
}

function makeEvent(payloadOverrides: Record<string, unknown> = {}): PluginEvent {
  return {
    eventId: "evt-1",
    eventType: "approval.created",
    occurredAt: new Date().toISOString(),
    companyId: "c1",
    entityId: "appr-001",
    entityType: "approval",
    payload: { approvalId: "appr-001", title: "Test approval", ...payloadOverrides },
  };
}

// ── resolveApprovalContent unit tests ─────────────────────────────────────────

describe("resolveApprovalContent", () => {
  it("returns proposedComment when present", async () => {
    const { resolveApprovalContent } = await import("../src/handlers/approval-created.js");
    expect(resolveApprovalContent({ proposedComment: "pc", details: "d", description: "desc" })).toBe("pc");
  });

  it("falls back to details when proposedComment is empty", async () => {
    const { resolveApprovalContent } = await import("../src/handlers/approval-created.js");
    expect(resolveApprovalContent({ proposedComment: "", details: "d", description: "desc" })).toBe("d");
  });

  it("falls back to description when proposedComment and details are absent", async () => {
    const { resolveApprovalContent } = await import("../src/handlers/approval-created.js");
    expect(resolveApprovalContent({ description: "desc" })).toBe("desc");
  });

  it("returns empty string when all fields are absent", async () => {
    const { resolveApprovalContent } = await import("../src/handlers/approval-created.js");
    expect(resolveApprovalContent({})).toBe("");
  });

  it("trims whitespace", async () => {
    const { resolveApprovalContent } = await import("../src/handlers/approval-created.js");
    expect(resolveApprovalContent({ proposedComment: "  hello  " })).toBe("hello");
  });
});

// ── CHANGE 1: content is ALWAYS posted after header ───────────────────────────

describe("handleApprovalCreated — CHANGE 1: always post content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts proposedComment immediately after header even when rich docs are present", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");
    const { renderIssueDocs } = await import("../src/render/issue-docs.js");
    // Rich docs also returned — content must STILL be posted first.
    (renderIssueDocs as any).mockReturnValue([[{ title: "a slide" }]]);

    const harness = createTestHarness({ manifest });
    const event = makeEvent({ proposedComment: "## Section 1\nbody content here" });
    await handleApprovalCreated(harness.ctx, event, {} as Client, makeConfig());

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);  // header
    // postToChannel signature: (client, channelId, msg)
    expect(postToChannel).toHaveBeenCalledWith(expect.anything(), "o1", expect.stringContaining("body content here"));
  });

  it("falls back to details when proposedComment is absent", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const event = makeEvent({ details: "details content" });
    await handleApprovalCreated(harness.ctx, event, {} as Client, makeConfig());

    expect(postToChannel).toHaveBeenCalledWith(expect.anything(), "o1", expect.stringContaining("details content"));
  });

  it("falls back to description when both proposedComment and details are absent", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const event = makeEvent({ description: "description content" });
    await handleApprovalCreated(harness.ctx, event, {} as Client, makeConfig());

    expect(postToChannel).toHaveBeenCalledWith(expect.anything(), "o1", expect.stringContaining("description content"));
  });

  it("does not call postToChannel when no content fields are present", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const event = makeEvent({});  // no proposedComment / details / description
    await handleApprovalCreated(harness.ctx, event, {} as Client, makeConfig());

    expect(postToChannel).not.toHaveBeenCalled();
  });

  it("chunks long proposedComment into <=1900 char messages", async () => {
    const { handleApprovalCreated } = await import("../src/handlers/approval-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    // Build content that will definitely exceed 1900 chars in at least 2 sections.
    const long = "## Section 1\n" + "x".repeat(1950) + "\n\n## Section 2\nshort";
    const event = makeEvent({ proposedComment: long });
    await handleApprovalCreated(harness.ctx, event, {} as Client, makeConfig());

    const calls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    // postToChannel signature: (client, channelId, msg)
    for (const [, , msg] of calls) {
      expect((msg as string).length).toBeLessThanOrEqual(1900);
    }
  });
});
