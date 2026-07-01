/**
 * Tests for CHANGE 2: config-driven auto-expiry of time-sensitive approvals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { CompanyConfig, DiscordFleetConfig } from "../src/config/schema.js";
import type { PaperclipApproval, PaperclipClient } from "../src/api/paperclip.js";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postToChannel: vi.fn().mockResolvedValue("msg-1"),
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-2"),
  postEmbedsToChannel: vi.fn().mockResolvedValue("msg-3"),
  postToThread: vi.fn().mockResolvedValue("msg-4"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-5"),
}));

const NOW = new Date("2026-07-01T12:00:00.000Z");

function makeCompanyConfig(): CompanyConfig {
  return {
    companyId: "c1",
    guildId: "g1",
    channels: { digest: "d1", errors: "e1", orphan: "o1" },
    projectRouting: {},
    digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
    stuckIssueThresholdHours: 6,
    paperclipApiKeySecretRef: "ref",
    paperclipApiUrl: "http://localhost:3000",
    companyPrefix: "tc1",
  };
}

function makeFleetConfig(company: CompanyConfig, extra?: Partial<DiscordFleetConfig>): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [company],
    ...extra,
  };
}

function makePendingApproval(overrides: Partial<PaperclipApproval> = {}): PaperclipApproval {
  return {
    id: "appr-1",
    type: "request_board_approval",
    status: "pending",
    createdAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), // 3h old by default
    payload: { title: "Carousel week 27" },
    ...overrides,
  };
}

function makePaperclip(pending: PaperclipApproval[], rejectFn = vi.fn().mockResolvedValue(undefined)): PaperclipClient {
  return {
    getPendingApprovals: vi.fn().mockResolvedValue(pending),
    getApprovalIssues: vi.fn().mockResolvedValue([]),
    rejectApproval: rejectFn,
  } as unknown as PaperclipClient;
}

describe("runApprovalsReminder — CHANGE 2: auto-expiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-rejects an approval that matches a titleRegex rule AND has exceeded maxAgeHours", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const rejectFn = vi.fn().mockResolvedValue(undefined);
    const paperclip = makePaperclip(
      [makePendingApproval({ createdAt: new Date(NOW.getTime() - 80 * 3_600_000).toISOString() })],
      rejectFn,
    );
    const fleet = makeFleetConfig(company, {
      approvalExpiry: {
        c1: [{ titleRegex: "Carousel", maxAgeHours: 72 }],
      },
    });

    await runApprovalsReminder(harness.ctx, "c1", {} as Client, company, fleet, paperclip, NOW);

    // Auto-rejected
    expect(rejectFn).toHaveBeenCalledWith(
      "appr-1",
      expect.stringContaining("auto-expiry after 72h"),
    );
    // NOT re-posted as a reminder
    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("does NOT auto-reject when titleRegex matches but age is below maxAgeHours", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const rejectFn = vi.fn().mockResolvedValue(undefined);
    // approval is 10h old; rule maxAgeHours is 72
    const paperclip = makePaperclip(
      [makePendingApproval({ createdAt: new Date(NOW.getTime() - 10 * 3_600_000).toISOString() })],
      rejectFn,
    );
    const fleet = makeFleetConfig(company, {
      approvalExpiry: { c1: [{ titleRegex: "Carousel", maxAgeHours: 72 }] },
    });

    await runApprovalsReminder(harness.ctx, "c1", {} as Client, company, fleet, paperclip, NOW);

    expect(rejectFn).not.toHaveBeenCalled();
  });

  it("does NOT auto-reject when titleRegex does not match", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const rejectFn = vi.fn().mockResolvedValue(undefined);
    // age exceeds rule but title doesn't match
    const paperclip = makePaperclip(
      [makePendingApproval({
        createdAt: new Date(NOW.getTime() - 100 * 3_600_000).toISOString(),
        payload: { title: "Budget proposal" },
      })],
      rejectFn,
    );
    const fleet = makeFleetConfig(company, {
      approvalExpiry: { c1: [{ titleRegex: "Carousel", maxAgeHours: 72 }] },
    });

    await runApprovalsReminder(harness.ctx, "c1", {} as Client, company, fleet, paperclip, NOW);

    expect(rejectFn).not.toHaveBeenCalled();
  });

  it("logs and continues when the reject API call fails (403 / board-key required)", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const rejectFn = vi.fn().mockRejectedValue(new Error("paperclip API reject error: 403"));
    const paperclip = makePaperclip(
      [makePendingApproval({ createdAt: new Date(NOW.getTime() - 80 * 3_600_000).toISOString() })],
      rejectFn,
    );
    const fleet = makeFleetConfig(company, {
      approvalExpiry: { c1: [{ titleRegex: "Carousel", maxAgeHours: 72 }] },
    });

    // Should not throw — error is caught and logged
    await expect(
      runApprovalsReminder(harness.ctx, "c1", {} as Client, company, fleet, paperclip, NOW),
    ).resolves.toBeUndefined();
  });

  it("does not call reject when no approvalExpiry config is present", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const rejectFn = vi.fn().mockResolvedValue(undefined);
    // Very old approval
    const paperclip = makePaperclip(
      [makePendingApproval({ createdAt: new Date(NOW.getTime() - 500 * 3_600_000).toISOString() })],
      rejectFn,
    );
    // No approvalExpiry in fleet config
    const fleet = makeFleetConfig(company);

    await runApprovalsReminder(harness.ctx, "c1", {} as Client, company, fleet, paperclip, NOW);

    expect(rejectFn).not.toHaveBeenCalled();
  });
});
