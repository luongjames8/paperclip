/**
 * Coverage for the delivery-fallback instrumentation added in
 * fix/discord-delivery-surface: the live incident's flagged suspect was a
 * send to a guild/channel the bot cannot see being SILENT to the operator.
 * These tests exercise the previously-untested branches directly against
 * their own log/HTTP call shape (grepping tests/ for these strings returned
 * no matches before this file existed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest, { JOB_KEYS } from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";

// Company "c-fail" resolves a valid token but its bot was never invited to
// "guild-fail" — buildClientMaps' pre-existing guild-membership check skips
// it, so its companyId never enters clientByCompanyId (see worker.ts).
vi.mock("../src/discord/client.js", () => ({
  createDiscordClient: vi.fn(() => ({
    user: { id: "bot-user" },
    on: vi.fn(),
    once: vi.fn(),
    destroy: vi.fn(),
    guilds: {
      cache: { has: (id: string) => id !== "guild-fail" },
      fetch: async (id: string) => {
        if (id === "guild-fail") throw new Error("Unknown Guild");
        return {};
      },
    },
  })),
  connectDiscordClient: vi.fn().mockResolvedValue(undefined),
  destroyDiscordClient: vi.fn(),
}));

vi.mock("../src/discord/slash.js", () => ({
  registerSlashCommands: vi.fn().mockResolvedValue(undefined),
  setupInteractionHandler: vi.fn(),
}));

vi.mock("../src/jobs/approvals-reminder.js", () => ({
  runApprovalsReminder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/api/paperclip.js", () => ({
  PaperclipClient: vi.fn().mockImplementation(() => ({
    addApprovalComment: vi.fn().mockResolvedValue(undefined),
  })),
}));

function makeApprovalEvent(companyId: string, approvalId: string): PluginEvent {
  return {
    eventId: "evt-1",
    eventType: "approval.created",
    occurredAt: new Date().toISOString(),
    companyId,
    entityId: approvalId,
    entityType: "approval",
    payload: { approvalId, approvalType: "budget" },
  };
}

// ─── (1) + (3): worker.ts's no-client / sweep-skip branches ──────────────────
//
// A company whose bot is a valid token but was never invited to its guild
// gets fault-isolated in buildClientMaps (pre-existing) — its companyId never
// enters clientByCompanyId. Both the approval.created handler and the
// approvals-reminder job must treat this as "no client" and log accordingly,
// without taking down the OTHER (connected) company.
describe("worker.ts — no-connected-client branches (companyId c-fail never joined its guild)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMixedConfig(): DiscordFleetConfig {
    return {
      botTokenSecretRef: "unused-root-token",
      companies: [
        {
          companyId: "c-fail",
          companyPrefix: "CF",
          guildId: "guild-fail",
          botTokenSecretRef: "token-fail",
          channels: { digest: "d1", errors: "e1", orphan: "o1" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "paperclip/api-key",
          paperclipApiUrl: "http://100.98.95.12:3100",
        },
        {
          companyId: "c-ok",
          companyPrefix: "CO",
          guildId: "guild-ok",
          botTokenSecretRef: "token-ok",
          channels: { digest: "d2", errors: "e2", orphan: "o2" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "paperclip/api-key",
          paperclipApiUrl: "http://100.98.95.12:3100",
        },
      ],
    };
  }

  it("(1) approval.created for the company with no connected client calls addApprovalComment with a 'no Discord client' message", async () => {
    const plugin = (await import("../src/worker.js")).default;
    const { PaperclipClient } = await import("../src/api/paperclip.js");

    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities, "jobs.schedule"],
      config: makeMixedConfig() as unknown as Record<string, unknown>,
    });

    await plugin.definition.setup(harness.ctx);

    await harness.emit(
      "approval.created",
      { approvalId: "appr-cfail-1", approvalType: "budget" },
      { companyId: "c-fail", entityId: "appr-cfail-1", entityType: "approval" },
    );

    const errorLog = harness.logs.find(
      (l) => l.message === "discord-fleet: approval.created received for company with no connected client; dropping",
    );
    expect(errorLog?.meta).toMatchObject({ companyId: "c-fail", approvalId: "appr-cfail-1" });

    const paperclipInstance = (PaperclipClient as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    expect(paperclipInstance.addApprovalComment).toHaveBeenCalledWith(
      "appr-cfail-1",
      expect.stringContaining("no Discord client"),
    );
  });

  it("(3) approvals-reminder sweep warns for the client-less company by companyId and still processes the connected company", async () => {
    const plugin = (await import("../src/worker.js")).default;
    const { runApprovalsReminder } = await import("../src/jobs/approvals-reminder.js");

    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities, "jobs.schedule"],
      config: makeMixedConfig() as unknown as Record<string, unknown>,
    });

    await plugin.definition.setup(harness.ctx);
    await harness.runJob(JOB_KEYS.approvalsReminder);

    const warnLog = harness.logs.find(
      (l) => l.message === "discord-fleet: approvals-reminder sweep skipping company — no connected client",
    );
    expect(warnLog?.meta).toMatchObject({ companyId: "c-fail" });

    // The connected company (c-ok) is still processed — one client, one company.
    expect(runApprovalsReminder).toHaveBeenCalledTimes(1);
    expect((runApprovalsReminder as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe("c-ok");
  });
});

// ─── (2): postDeliveryFailureFallback's own fallback POST failing ────────────
describe("postDeliveryFailureFallback — the fallback's own comment-post failing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeConfig(): DiscordFleetConfig {
    return {
      botTokenSecretRef: "bot-ref",
      companies: [
        {
          companyId: "c1",
          companyPrefix: "TC1",
          guildId: "guild-1",
          channels: { digest: "d1", errors: "e1", orphan: "o1" },
          projectRouting: {},
          digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
          stuckIssueThresholdHours: 6,
          paperclipApiKeySecretRef: "paperclip/api-key",
          paperclipApiUrl: "http://100.98.95.12:3100",
        },
      ],
    };
  }

  it("logs the double-failure error and does not throw when the fallback comment POST itself fails", async () => {
    const { PaperclipClient } = await import("../src/api/paperclip.js");
    (PaperclipClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      addApprovalComment: vi.fn().mockRejectedValue(new Error("paperclip API addApprovalComment error: 500")),
    }));

    const { postDeliveryFailureFallback } = await import("../src/handlers/delivery-fallback.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const event = makeApprovalEvent("c1", "appr-double-fail");

    await expect(
      postDeliveryFailureFallback(harness.ctx, config, event, "no Discord client connected for this company"),
    ).resolves.toBeUndefined();

    const doubleFailureLog = harness.logs.find(
      (l) => l.message === "discord-fleet: fallback comment post also failed — non-delivery is now doubly silent",
    );
    expect(doubleFailureLog?.meta).toMatchObject({ approvalId: "appr-double-fail", companyId: "c1" });
  });
});
