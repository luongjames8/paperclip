/**
 * Tests for CHANGE 2: config-driven auto-expiry of time-sensitive approvals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { CompanyConfig, DiscordFleetConfig } from "../src/config/schema.js";
import type { PaperclipApproval, PaperclipClient } from "../src/api/paperclip.js";
import { PaperclipApiError } from "../src/api/paperclip.js";
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

function makePaperclip(
  pending: PaperclipApproval[],
  rejectFn = vi.fn().mockResolvedValue(undefined),
  getApprovalByIdFn = vi.fn().mockResolvedValue({ id: "appr-1", status: "pending", createdAt: new Date(NOW.getTime() - 80 * 3_600_000).toISOString(), payload: { title: "Carousel week 27" } }),
): PaperclipClient {
  return {
    getPendingApprovals: vi.fn().mockResolvedValue(pending),
    getApprovalIssues: vi.fn().mockResolvedValue([]),
    rejectApproval: rejectFn,
    getApprovalById: getApprovalByIdFn,
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

  it("falls through to reminder posting when the reject API call fails (codex P2)", async () => {
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const rejectFn = vi.fn().mockRejectedValue(new Error("paperclip API reject error: 403"));
    // Approval is 80h old (exceeds maxAgeHours:72) AND older than REMIND_AFTER_MS (1h)
    const paperclip = makePaperclip(
      [makePendingApproval({ createdAt: new Date(NOW.getTime() - 80 * 3_600_000).toISOString() })],
      rejectFn,
    );
    const fleet = makeFleetConfig(company, {
      approvalExpiry: { c1: [{ titleRegex: "Carousel", maxAgeHours: 72 }] },
    });

    // Should not throw
    await expect(
      runApprovalsReminder(harness.ctx, "c1", {} as Client, company, fleet, paperclip, NOW),
    ).resolves.toBeUndefined();

    // Reject was attempted
    expect(rejectFn).toHaveBeenCalledWith("appr-1", expect.stringContaining("auto-expiry after 72h"));
    // Because reject failed, the reminder card MUST still be posted so the card
    // does not go permanently silent.
    expect(postEmbedToChannel).toHaveBeenCalled();
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

  it("getApprovalById returns status:'approved' → rejectApproval NOT called AND no reminder posted", async () => {
    // TOCTOU guard: if the approval was decided between the pending-list fetch and
    // the re-check, we must NOT reject (human decision stands) and also must not
    // post a stale reminder card for an already-decided approval.
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const rejectFn = vi.fn().mockResolvedValue(undefined);
    // getApprovalById returns approved — human decided while we were sweeping
    const approvalByIdFn = vi.fn().mockResolvedValue({
      id: "appr-1",
      status: "approved",
      createdAt: new Date(NOW.getTime() - 80 * 3_600_000).toISOString(),
      payload: { title: "Carousel week 27" },
    });
    const paperclip = makePaperclip(
      [makePendingApproval({ createdAt: new Date(NOW.getTime() - 80 * 3_600_000).toISOString() })],
      rejectFn,
      approvalByIdFn,
    );
    const fleet = makeFleetConfig(company, {
      approvalExpiry: { c1: [{ titleRegex: "Carousel", maxAgeHours: 72 }] },
    });

    await runApprovalsReminder(harness.ctx, "c1", {} as Client, company, fleet, paperclip, NOW);

    expect(rejectFn).not.toHaveBeenCalled();
    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("getApprovalById rejects (fetch error) → rejectApproval NOT called (fail closed) but reminder IS posted", async () => {
    // Fail-closed: if the re-check itself fails we cannot know the current state,
    // so we skip the auto-reject. However, the normal reminder path still runs so
    // the card does not go permanently silent.
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const rejectFn = vi.fn().mockResolvedValue(undefined);
    // getApprovalById throws — network error during re-fetch
    const approvalByIdFn = vi.fn().mockRejectedValue(new Error("network error"));
    // Approval is 80h old (exceeds 72h) AND older than REMIND_AFTER_MS (1h)
    const paperclip = makePaperclip(
      [makePendingApproval({ createdAt: new Date(NOW.getTime() - 80 * 3_600_000).toISOString() })],
      rejectFn,
      approvalByIdFn,
    );
    const fleet = makeFleetConfig(company, {
      approvalExpiry: { c1: [{ titleRegex: "Carousel", maxAgeHours: 72 }] },
    });

    await expect(
      runApprovalsReminder(harness.ctx, "c1", {} as Client, company, fleet, paperclip, NOW),
    ).resolves.toBeUndefined();

    expect(rejectFn).not.toHaveBeenCalled();
    // Normal reminder is still posted (card must not go silent)
    expect(postEmbedToChannel).toHaveBeenCalled();
  });

  it("rejectApproval throws PaperclipApiError with status 409 → no reminder posted, no throw", async () => {
    // 409 = approval already decided (race lost to a human) — human decision stands.
    // The job must continue without posting a stale reminder card.
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();
    const rejectFn = vi.fn().mockRejectedValue(
      new PaperclipApiError("paperclip API reject error: 409", 409, "http://localhost:3000/api/approvals/appr-1/reject"),
    );
    const paperclip = makePaperclip(
      [makePendingApproval({ createdAt: new Date(NOW.getTime() - 80 * 3_600_000).toISOString() })],
      rejectFn,
    );
    const fleet = makeFleetConfig(company, {
      approvalExpiry: { c1: [{ titleRegex: "Carousel", maxAgeHours: 72 }] },
    });

    await expect(
      runApprovalsReminder(harness.ctx, "c1", {} as Client, company, fleet, paperclip, NOW),
    ).resolves.toBeUndefined();

    expect(rejectFn).toHaveBeenCalledWith("appr-1", expect.stringContaining("auto-expiry after 72h"));
    // 409 branch: continue → no reminder posted
    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("successful expiry prunes approval id from PENDING_APPROVALS_KEY state", async () => {
    // After a successful auto-reject, the expired id must be removed from the
    // shared pending list (same as the button handler does on decide) so the
    // daily digest does not re-surface it.
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");
    const { PENDING_APPROVALS_KEY } = await import("../src/handlers/approval-created.js");

    const harness = createTestHarness({ manifest });
    const company = makeCompanyConfig();

    // Pre-seed the pending list to simulate a previously-posted card
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: PENDING_APPROVALS_KEY },
      ["appr-1", "appr-2"],
    );

    const rejectFn = vi.fn().mockResolvedValue(undefined);
    const paperclip = makePaperclip(
      [makePendingApproval({ createdAt: new Date(NOW.getTime() - 80 * 3_600_000).toISOString() })],
      rejectFn,
    );
    const fleet = makeFleetConfig(company, {
      approvalExpiry: { c1: [{ titleRegex: "Carousel", maxAgeHours: 72 }] },
    });

    await runApprovalsReminder(harness.ctx, "c1", {} as Client, company, fleet, paperclip, NOW);

    expect(rejectFn).toHaveBeenCalled();

    const remaining = await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: PENDING_APPROVALS_KEY,
    }) as string[] | null;
    // appr-1 must be pruned; appr-2 must remain
    expect(remaining).not.toContain("appr-1");
    expect(remaining).toContain("appr-2");
  });
});
