import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { CompanyConfig, DiscordFleetConfig } from "../src/config/schema.js";
import type { PaperclipApproval, PaperclipClient } from "../src/api/paperclip.js";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postToChannel: vi.fn().mockResolvedValue("msg-id-123"),
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id-456"),
  postEmbedsToChannel: vi.fn().mockResolvedValue("msg-id-457"),
  postToThread: vi.fn().mockResolvedValue("msg-id-789"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id-abc"),
}));

const NOW = new Date("2026-06-12T12:00:00.000Z");

function makeCompanyConfig(): CompanyConfig {
  return {
    companyId: "company-1",
    guildId: "guild-1",
    channels: { digest: "channel-digest", errors: "channel-errors", orphan: "channel-orphan" },
    projectRouting: {},
    digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
    stuckIssueThresholdHours: 6,
    paperclipApiKeySecretRef: "paperclip/api-key",
    paperclipApiUrl: "http://localhost:3000",
    companyPrefix: "tc1",
  };
}

function makeFleetConfig(company: CompanyConfig): DiscordFleetConfig {
  return {
    botTokenSecretRef: "paperclip-discord/bot-token",
    approvalsChannelsByType: {
      "company-1": [["content batch", "channel-batch"]],
    },
    companies: [company],
  } as DiscordFleetConfig;
}

function approval(overrides: Partial<PaperclipApproval>): PaperclipApproval {
  return {
    id: "approval-1",
    type: "request_board_approval",
    status: "pending",
    createdAt: new Date(NOW.getTime() - 3 * 3600_000).toISOString(),
    payload: { title: "Review weekly content batch" },
    ...overrides,
  };
}

function makePaperclip(pending: PaperclipApproval[], approvalIssues: Array<{ id: string }> = []): PaperclipClient {
  return {
    getPendingApprovals: vi.fn().mockResolvedValue(pending),
    getApprovalIssues: vi.fn().mockResolvedValue(approvalIssues),
  } as unknown as PaperclipClient;
}

describe("runApprovalsReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-posts a card for a pending approval older than the remind threshold", async () => {
    const { runApprovalsReminder, APPROVAL_REMINDERS_KEY } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company), makePaperclip([approval({})]), NOW,
    );

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
    const [, channelId, embed] = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("channel-batch");
    expect(embed.title).toContain("Still pending (3h)");
    expect(embed.title).toContain("Review weekly content batch");

    const reminders = await harness.ctx.state.get({
      scopeKind: "company", scopeId: "company-1", stateKey: APPROVAL_REMINDERS_KEY,
    }) as Record<string, string>;
    expect(reminders["approval-1"]).toBe(NOW.toISOString());
  });

  it("routes the reminder on payload.approvalType when the title misses every regex (mirrors handleApprovalCreated)", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const fleetConfig = makeFleetConfig(company);
    fleetConfig.approvalsChannelsByType!["company-1"] = [
      ["^content_batch_approval$", "channel-batch"],
      ["content batch", "channel-batch"],
    ];
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, fleetConfig,
      makePaperclip([
        approval({
          payload: {
            title: "Totally Reworded Weekly Posts Card",
            approvalType: "content_batch_approval",
          },
        }),
      ]),
      NOW,
    );

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
    const [, channelId] = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    // Without the discriminator candidate this would have fallen to the
    // orphan/work-thread path while the ORIGINAL card sat in channel-batch.
    expect(channelId).toBe("channel-batch");
  });

  it("skips approvals younger than the remind threshold", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const fresh = approval({ createdAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() });
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company), makePaperclip([fresh]), NOW,
    );

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("does not re-remind within the per-approval interval, then reminds again after it", async () => {
    const { runApprovalsReminder, APPROVAL_REMINDERS_KEY } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const fleet = makeFleetConfig(company);
    const stateKey = { scopeKind: "company" as const, scopeId: "company-1", stateKey: APPROVAL_REMINDERS_KEY };

    await harness.ctx.state.set(stateKey, {
      "approval-1": new Date(NOW.getTime() - 2 * 3600_000).toISOString(),
    });
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, fleet, makePaperclip([approval({})]), NOW,
    );
    expect(postEmbedToChannel).not.toHaveBeenCalled();

    await harness.ctx.state.set(stateKey, {
      "approval-1": new Date(NOW.getTime() - 7 * 3600_000).toISOString(),
    });
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, fleet, makePaperclip([approval({})]), NOW,
    );
    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
  });

  it("prunes decided approvals from reminder state", async () => {
    const { runApprovalsReminder, APPROVAL_REMINDERS_KEY } = await import("../src/jobs/approvals-reminder.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const stateKey = { scopeKind: "company" as const, scopeId: "company-1", stateKey: APPROVAL_REMINDERS_KEY };
    await harness.ctx.state.set(stateKey, { "decided-old": NOW.toISOString() });

    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company), makePaperclip([]), NOW,
    );

    const reminders = await harness.ctx.state.get(stateKey) as Record<string, string>;
    expect(reminders).toEqual({});
  });

  it("falls back to the orphan channel when no route matches", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const unrouted = approval({ payload: { title: "Some unrelated approval" } });
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company), makePaperclip([unrouted]), NOW,
    );

    const [, channelId] = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("channel-orphan");
  });

  it("reminds into the linked issue's work thread when no type route matches", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { setThreadForIssue } = await import("../src/routing/thread-state.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    await setThreadForIssue(harness.ctx, "company-1", "issue-9", {
      threadId: "thread-9",
      channelId: "thread-9",
      createdAt: NOW.toISOString(),
    });
    const unrouted = approval({ payload: { title: "Some unrelated approval" } });
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company),
      makePaperclip([unrouted], [{ id: "issue-9" }]), NOW,
    );

    const [, channelId] = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("thread-9");
  });

  it("does not mark an approval reminded when the Discord post fails", async () => {
    const { runApprovalsReminder, APPROVAL_REMINDERS_KEY } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    (postEmbedToChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("discord 500"));

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company), makePaperclip([approval({})]), NOW,
    );

    const reminders = await harness.ctx.state.get({
      scopeKind: "company", scopeId: "company-1", stateKey: APPROVAL_REMINDERS_KEY,
    }) as Record<string, string>;
    expect(reminders["approval-1"]).toBeUndefined();
  });
});

// ─── postsBatch structured render contract (GH #501) ─────────────────────────
// Mirrors handleApprovalCreated's detection: same contract, same
// degrade-to-plaintext-on-miss semantics — see handler-approval-created.spec.ts.

function validPostsBatch() {
  return {
    version: 1,
    weekOf: "2026-07-13",
    items: [
      {
        slug: "tokyo-trifecta",
        day: "Mon",
        postTime: "Mon 2026-07-13 12:00 Taipei",
        imageUrl: "https://hinomaru.one/images/tours/trifecta-card.avif",
        hook: "Three neighborhoods, three completely different Tokyos.",
        platforms: { threads: "Three neighborhoods..." },
      },
    ],
  };
}

describe("runApprovalsReminder — postsBatch structured render (GH #501)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but NOT a mockRejectedValue set by an
    // earlier test — restore rest.js mocks to their module-level defaults so
    // e.g. the "total delivery failure" test's postEmbedsToChannel rejection
    // can't leak into a later test in this describe block.
    const { postToChannel, postEmbedToChannel, postEmbedsToChannel } = await import("../src/discord/rest.js");
    (postToChannel as any).mockResolvedValue("msg-id-123");
    (postEmbedToChannel as any).mockResolvedValue("msg-id-456");
    (postEmbedsToChannel as any).mockResolvedValue("msg-id-457");
  });

  it("structured postsBatch on the stored approval → posts embeds via postEmbedsToChannel, not plaintext", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company),
      makePaperclip([approval({ payload: { title: "Weekly posts batch", proposedComment: "prose fallback, should NOT post", postsBatch: validPostsBatch() } })]),
      NOW,
    );

    expect(postEmbedsToChannel).toHaveBeenCalledTimes(1);
    expect(postToChannel).not.toHaveBeenCalled();
  });

  it("malformed postsBatch degrades to the plaintext path — reviewableContent still posts", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company),
      makePaperclip([approval({ payload: { title: "Weekly posts batch", proposedComment: "## plaintext body", postsBatch: { version: 2 } } })]),
      NOW,
    );

    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalled();
  });

  it("absent postsBatch (legacy card) degrades to the plaintext path unchanged", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company),
      makePaperclip([approval({ payload: { title: "Weekly posts batch", proposedComment: "legacy prose artifact" } })]),
      NOW,
    );

    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalled();
  });

  // codex P2 (mirrors handleApprovalCreated's fix): a total structured-render
  // delivery failure must fall back to the plaintext path, not leave the
  // reminder header-only.
  it("total postsBatch delivery failure (every embed group post fails) falls back to the plaintext path", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("discord 400: invalid image url"));

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company),
      makePaperclip([approval({ payload: { title: "Weekly posts batch", proposedComment: "plaintext fallback content", postsBatch: validPostsBatch() } })]),
      NOW,
    );

    expect(postEmbedsToChannel).toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalled();
  });

  // codex P2: summary/recommendedAction/risks must reach Discord alongside
  // postsBatch embeds in the reminder path too.
  it("summary/recommendedAction/risks post via postToChannel ALONGSIDE the postsBatch embeds (not swallowed)", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company),
      makePaperclip([approval({
        payload: {
          title: "Weekly posts batch",
          summary: "Weekly posts batch for 2026-07-13",
          recommendedAction: "Approve all 13 posts",
          risks: ["One image URL is a placeholder"],
          postsBatch: validPostsBatch(),
        },
      })]),
      NOW,
    );

    expect(postToChannel).toHaveBeenCalledTimes(1);
    const guidanceCall = (postToChannel as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(guidanceCall).toContain("Weekly posts batch for 2026-07-13");
    expect(guidanceCall).toContain("Approve all 13 posts");
    expect(guidanceCall).toContain("One image URL is a placeholder");
    expect(postEmbedsToChannel).toHaveBeenCalledTimes(1);
  });

  it("no guidance fields set → postToChannel is not called for postsBatch (unchanged from before)", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    await runApprovalsReminder(
      harness.ctx, "company-1", {} as Client, company, makeFleetConfig(company),
      makePaperclip([approval({ payload: { title: "Weekly posts batch", postsBatch: validPostsBatch() } })]),
      NOW,
    );

    expect(postToChannel).not.toHaveBeenCalled();
    expect(postEmbedsToChannel).toHaveBeenCalledTimes(1);
  });
});
