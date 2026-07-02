/**
 * Tests for routine-health.ts
 *
 * Rule: for each active routine's enabled schedule trigger,
 *   - nextRunAt in the future → no alert (not yet due)
 *   - nextRunAt in the past within GRACE_MS (1h) → no alert (catching up)
 *   - nextRunAt in the past beyond GRACE_MS → alert (scheduler missed planned fire)
 *   - nextRunAt missing/invalid on enabled schedule trigger → misconfigured alert
 *   - disabled trigger → ignored
 *   - webhook-kind trigger → ignored
 *   - routine status !== "active" → ignored
 *   - getRoutines failure for one company → skip that company, still process others
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PaperclipClient, PaperclipRoutine } from "../src/api/paperclip.js";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id"),
  postToChannel: vi.fn().mockResolvedValue("msg-id"),
  postToThread: vi.fn().mockResolvedValue("msg-id"),
}));

function makeConfig(overrides: { companyId?: string } = {}): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: overrides.companyId ?? "c1",
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Tokyo" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "tc1",
      },
    ],
  };
}

function makeTwoCompanyConfig(): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: "c1",
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Tokyo" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "tc1",
      },
      {
        companyId: "c2",
        guildId: "g2",
        channels: { digest: "d2", errors: "e2", orphan: "o2" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Tokyo" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "tc2",
      },
    ],
  };
}

function makeRoutine(overrides: Partial<PaperclipRoutine> = {}): PaperclipRoutine {
  return {
    id: "r1",
    title: "Daily digest routine",
    status: "active",
    lastTriggeredAt: null,
    triggers: [
      {
        id: "t1",
        kind: "schedule",
        enabled: true,
        cronExpression: "0 7 * * *",
        timezone: "Asia/Tokyo",
        nextRunAt: new Date(Date.now() + 12 * 3600_000).toISOString(), // future by default
        lastFiredAt: null,
      },
    ],
    ...overrides,
  };
}

function makeMockClient(): Client {
  return {} as Client;
}

function makeMockPaperclip(routines: PaperclipRoutine[]): PaperclipClient {
  return {
    getRoutines: vi.fn().mockResolvedValue(routines),
  } as unknown as PaperclipClient;
}

describe("runRoutineHealth — nextRunAt-based rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT alert when nextRunAt is in the future (not yet due)", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [{
        id: "t1", kind: "schedule", enabled: true,
        nextRunAt: new Date(Date.now() + 2 * 3600_000).toISOString(), // 2h from now
      }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("does NOT alert when nextRunAt is past but within grace (< 1h ago)", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [{
        id: "t1", kind: "schedule", enabled: true,
        nextRunAt: new Date(Date.now() - 30 * 60_000).toISOString(), // 30 min ago — within 1h grace
      }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("alerts when nextRunAt is past beyond grace (> 1h ago — scheduler missed planned fire)", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [{
        id: "t1", kind: "schedule", enabled: true,
        nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString(), // 3h ago — well past grace
      }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).toHaveBeenCalledOnce();
    expect(postEmbedToChannel).toHaveBeenCalledWith(expect.any(Object), "e1", expect.any(Object));
  });

  it("alerts as misconfigured when nextRunAt is null on an enabled schedule trigger", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [{
        id: "t1", kind: "schedule", enabled: true,
        nextRunAt: null,
      }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).toHaveBeenCalledOnce();
    // The embed passed should be the misconfigured variant (red color)
    const embed = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(embed.color).toBe(0xff0000);
  });

  it("alerts as misconfigured when nextRunAt is missing (undefined) on an enabled schedule trigger", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [{
        id: "t1", kind: "schedule", enabled: true,
        // nextRunAt intentionally absent
      }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).toHaveBeenCalledOnce();
    const embed = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(embed.color).toBe(0xff0000);
  });

  it("ignores routines with status !== 'active'", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      status: "draft",
      triggers: [{
        id: "t1", kind: "schedule", enabled: true,
        nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString(), // past grace, but inactive
      }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("ignores disabled triggers", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [{
        id: "t1", kind: "schedule", enabled: false,
        nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString(), // past grace, but disabled
      }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("ignores webhook-kind triggers", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [{ id: "t1", kind: "webhook", enabled: true, nextRunAt: null }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("per-company error isolation: getRoutines failure on c1 does not skip c2", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeTwoCompanyConfig();

    const routine = makeRoutine({
      triggers: [{
        id: "t1", kind: "schedule", enabled: true,
        nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString(), // past grace → alert
      }],
    });
    const goodPaperclip = makeMockPaperclip([routine]);
    const badPaperclip = { getRoutines: vi.fn().mockRejectedValue(new Error("network error")) } as unknown as PaperclipClient;

    const factory = vi.fn()
      .mockResolvedValueOnce(badPaperclip)   // c1 fails
      .mockResolvedValueOnce(goodPaperclip); // c2 succeeds

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    // c2 should still alert
    expect(postEmbedToChannel).toHaveBeenCalledOnce();
    expect(postEmbedToChannel).toHaveBeenCalledWith(expect.any(Object), "e2", expect.any(Object));
  });
});
