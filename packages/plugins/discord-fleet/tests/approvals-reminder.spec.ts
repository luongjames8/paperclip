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
