/**
 * Tests for routine-health.ts
 *
 * Verifies:
 * - Alert fires when a schedule trigger's lastFiredAt is older than expected
 * - Alert fires when lastFiredAt is absent (never fired)
 * - No alert when routine status !== "active"
 * - Disabled trigger is ignored
 * - Webhook-kind trigger is ignored
 * - Per-company error isolation: a getRoutines failure skips only that company
 * - Tokyo TZ case: UTC server correctly derives Tokyo fire time
 * - expectedLastFire TZ correction is independent of server TZ
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PaperclipClient, PaperclipRoutine } from "../src/api/paperclip.js";
import type { Client } from "discord.js";
import { expectedLastFire } from "../src/jobs/routine-health.js";

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

describe("runRoutineHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts an alert when lastFiredAt is null (never fired)", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({ triggers: [{ id: "t1", kind: "schedule", enabled: true, cronExpression: "0 7 * * *", timezone: "Asia/Tokyo", lastFiredAt: null }] });

    // now = Tokyo 07:30, which is past the 07:00 fire; lastFiredAt=null → alert
    // Tokyo = UTC+9, so 07:30 Tokyo = 22:30 UTC previous day
    const now = new Date(Date.UTC(2026, 5, 22, 22, 30, 0)); // 2026-06-22 22:30 UTC = 2026-06-23 07:30 Tokyo
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).toHaveBeenCalledOnce();
    expect(postEmbedToChannel).toHaveBeenCalledWith(expect.any(Object), "e1", expect.any(Object));
  });

  it("posts an alert when lastFiredAt is older than expected by more than 1h", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();

    // Routine last fired 3 days ago (stale)
    const staleFire = new Date(Date.UTC(2026, 5, 19, 22, 0, 0)).toISOString(); // Tokyo 2026-06-20 07:00
    // now = Tokyo 2026-06-23 07:30
    const now = new Date(Date.UTC(2026, 5, 22, 22, 30, 0));
    const routine = makeRoutine({
      triggers: [{ id: "t1", kind: "schedule", enabled: true, cronExpression: "0 7 * * *", timezone: "Asia/Tokyo", lastFiredAt: staleFire }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).toHaveBeenCalledOnce();
  });

  it("does NOT alert when lastFiredAt is recent (within threshold)", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();

    // Use Date.now() so the "recent" fire is within the current run's 1h window regardless of when the test runs.
    // Set lastFiredAt to 10 minutes ago — well within the 1h miss threshold.
    const recentFire = new Date(Date.now() - 10 * 60_000).toISOString();
    const routine = makeRoutine({
      triggers: [{ id: "t1", kind: "schedule", enabled: true, cronExpression: "0 7 * * *", timezone: "Asia/Tokyo", lastFiredAt: recentFire }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("ignores routines with status !== 'active'", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({ status: "draft", triggers: [{ id: "t1", kind: "schedule", enabled: true, cronExpression: "0 7 * * *", timezone: "Asia/Tokyo", lastFiredAt: null }] });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    const now = new Date(Date.UTC(2026, 5, 22, 22, 30, 0));
    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("ignores disabled triggers", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [{ id: "t1", kind: "schedule", enabled: false, cronExpression: "0 7 * * *", timezone: "Asia/Tokyo", lastFiredAt: null }],
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
      triggers: [{ id: "t1", kind: "webhook", enabled: true, cronExpression: null, timezone: null, lastFiredAt: null }],
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

    // now = Tokyo 07:30 = UTC 22:30 previous day
    const now = new Date(Date.UTC(2026, 5, 22, 22, 30, 0));

    const routine = makeRoutine();
    const goodPaperclip = makeMockPaperclip([routine]);
    const badPaperclip = { getRoutines: vi.fn().mockRejectedValue(new Error("network error")) } as unknown as PaperclipClient;

    const factory = vi.fn()
      .mockResolvedValueOnce(badPaperclip)   // c1 fails
      .mockResolvedValueOnce(goodPaperclip); // c2 succeeds

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    // c2 should still alert (routine has no lastFiredAt)
    expect(postEmbedToChannel).toHaveBeenCalledOnce();
    expect(postEmbedToChannel).toHaveBeenCalledWith(expect.any(Object), "e2", expect.any(Object));
  });

  it("falls back to routine.lastTriggeredAt when trigger.lastFiredAt is null", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();

    // now = Tokyo 2026-06-23 07:30
    const now = new Date(Date.UTC(2026, 5, 22, 22, 30, 0));
    // routine.lastTriggeredAt = 3 days ago (stale)
    const staleTriggeredAt = new Date(Date.UTC(2026, 5, 19, 22, 0, 0)).toISOString();
    const routine = makeRoutine({
      lastTriggeredAt: staleTriggeredAt,
      triggers: [{ id: "t1", kind: "schedule", enabled: true, cronExpression: "0 7 * * *", timezone: "Asia/Tokyo", lastFiredAt: null }],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    // stale lastTriggeredAt used as fallback — still alerts because 3 days is way past threshold
    expect(postEmbedToChannel).toHaveBeenCalledOnce();
  });
});

describe("expectedLastFire — Tokyo TZ on a UTC server", () => {
  it("returns Tokyo 07:00 as correct UTC for a 'daily 07:00 Asia/Tokyo' cron", () => {
    // Tokyo is UTC+9. If now = 2026-06-23 07:30 Tokyo = 2026-06-22 22:30 UTC,
    // the expected last fire is 2026-06-23 07:00 Tokyo = 2026-06-22 22:00 UTC.
    const now = new Date(Date.UTC(2026, 5, 22, 22, 30, 0));
    const result = expectedLastFire("0 7 * * *", "Asia/Tokyo", now);

    expect(result).not.toBeNull();
    // Expected: 2026-06-22 22:00:00 UTC (= 2026-06-23 07:00 Tokyo)
    expect(result!.getTime()).toBe(Date.UTC(2026, 5, 22, 22, 0, 0));
  });

  it("returns yesterday's fire when now is before today's scheduled Tokyo fire", () => {
    // now = 2026-06-23 06:30 Tokyo = 2026-06-22 21:30 UTC (before 07:00 Tokyo)
    const now = new Date(Date.UTC(2026, 5, 22, 21, 30, 0));
    const result = expectedLastFire("0 7 * * *", "Asia/Tokyo", now);

    expect(result).not.toBeNull();
    // Yesterday's fire: 2026-06-22 07:00 Tokyo = 2026-06-21 22:00 UTC
    expect(result!.getTime()).toBe(Date.UTC(2026, 5, 21, 22, 0, 0));
  });

  it("returns null for an unsupported cron expression (ranges)", () => {
    const now = new Date(Date.UTC(2026, 5, 22, 22, 30, 0));
    const result = expectedLastFire("*/15 * * * *", "Asia/Tokyo", now);
    // minute field is not a simple integer — will get NaN → null
    expect(result).toBeNull();
  });

  it("returns null for an expression with wrong field count", () => {
    const now = new Date(Date.UTC(2026, 5, 22, 22, 30, 0));
    expect(expectedLastFire("0 7 * *", "Asia/Tokyo", now)).toBeNull();
  });

  it("UTC TZ: daily at 00:00 UTC resolves without offset error", () => {
    // now = 2026-06-23 00:30 UTC, expected fire = 2026-06-23 00:00 UTC
    const now = new Date(Date.UTC(2026, 5, 22, 0, 30, 0));
    const result = expectedLastFire("0 0 * * *", "UTC", now);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(Date.UTC(2026, 5, 22, 0, 0, 0));
  });
});
