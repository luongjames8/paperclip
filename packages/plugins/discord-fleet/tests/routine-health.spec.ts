/**
 * Tests for routine-health.ts
 *
 * Rule: for each active routine's enabled schedule trigger,
 *   - nextRunAt in the future → no alert (not yet due)
 *   - nextRunAt in the past within GRACE_MS (1h) → no alert (catching up)
 *   - nextRunAt in the past beyond GRACE_MS → alert (scheduler missed planned fire)
 *   - nextRunAt missing/invalid on enabled schedule trigger → misconfigured alert
 *   - schedule-triggered routine with no assignee → misconfigured alert
 *     (dispatch throws before a run row exists; nextRunAt alone never shows it)
 *   - lastRun.status === "failed" → run-failed alert, once per run id
 *   - every alert key re-alerts at most once per 24h (ctx.state dedup)
 *   - disabled trigger → ignored
 *   - webhook-kind trigger → ignored
 *   - routine status !== "active" → ignored
 *   - getRoutines failure for one company → skip that company, still process others
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PaperclipClient, PaperclipRoutine, PaperclipRoutineTrigger } from "../src/api/paperclip.js";
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

// Canonical full-shape trigger mirroring the server serializer
// (server/src/services/routines.ts list()): every field the API emits is
// present, so a test override drops nothing silently.
function makeTrigger(overrides: Partial<PaperclipRoutineTrigger> = {}): PaperclipRoutineTrigger {
  return {
    id: "t1",
    kind: "schedule",
    label: null,
    enabled: true,
    cronExpression: "0 7 * * *",
    timezone: "Asia/Tokyo",
    nextRunAt: new Date(Date.now() + 12 * 3600_000).toISOString(), // future by default
    lastFiredAt: null,
    ...overrides,
  };
}

function makeRoutine(overrides: Partial<PaperclipRoutine> = {}): PaperclipRoutine {
  return {
    id: "r1",
    title: "Daily digest routine",
    status: "active",
    assigneeAgentId: "agent-1",
    lastTriggeredAt: null,
    triggers: [makeTrigger()],
    lastRun: null,
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
      triggers: [makeTrigger({ nextRunAt: new Date(Date.now() + 2 * 3600_000).toISOString() })], // 2h from now
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
      triggers: [makeTrigger({ nextRunAt: new Date(Date.now() - 30 * 60_000).toISOString() })], // 30 min ago — within 1h grace
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
      triggers: [makeTrigger({ nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString() })], // 3h ago — well past grace
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
      triggers: [makeTrigger({ nextRunAt: null })],
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
      triggers: [makeTrigger({ nextRunAt: undefined })],
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
      triggers: [makeTrigger({ nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString() })], // past grace, but inactive
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
      triggers: [makeTrigger({ enabled: false, nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString() })], // past grace, but disabled
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
      triggers: [makeTrigger({ kind: "webhook", nextRunAt: null })],
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
      triggers: [makeTrigger({ nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString() })], // past grace → alert
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

describe("runRoutineHealth — invisible-miss detection (no assignee, failed run)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("alerts as misconfigured when a schedule-triggered routine has no assignee", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    // nextRunAt healthy (future) — the ONLY problem is the missing assignee,
    // which the scheduler's nextRunAt can never expose (dispatch throws
    // before a run row exists, after nextRunAt was already advanced).
    const routine = makeRoutine({ assigneeAgentId: null });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).toHaveBeenCalledOnce();
    const embed = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(embed.color).toBe(0xff0000);
    expect(embed.description).toContain("no assignee");
  });

  it("no-assignee-alerts a webhook-triggered routine too (webhook dispatch also throws pre-run)", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({ assigneeAgentId: null, triggers: [makeTrigger({ kind: "webhook", nextRunAt: null })] });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).toHaveBeenCalledOnce();
    const embed = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(embed.description).toContain("no assignee");
  });

  it("does NOT no-assignee-alert a routine with no enabled triggers (manual-only — dispatch errors surface to the caller)", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({ assigneeAgentId: null, triggers: [makeTrigger({ enabled: false })] });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("alerts when the most recent run failed, once per run id across sweeps", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      lastRun: { id: "run-9", status: "failed", failureReason: "boom" },
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);
    expect(postEmbedToChannel).toHaveBeenCalledOnce();
    const embed = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(embed.title).toContain("run failed");
    expect(embed.description).toContain("boom");

    // Second sweep, same failed run id → deduped, no second embed.
    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);
    expect(postEmbedToChannel).toHaveBeenCalledOnce();
  });

  it("does NOT alert when the most recent run succeeded", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      lastRun: { id: "run-10", status: "issue_created", failureReason: null },
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });
});

describe("runRoutineHealth — 24h dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("suppresses a repeat missed-fire alert within the rethreshold", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [makeTrigger({ nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString() })], // past grace
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);
    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    // Two sweeps, one embed — the 30-min job cadence must not spam 48/day.
    expect(postEmbedToChannel).toHaveBeenCalledOnce();
  });

  it("does NOT mark the dedup key when the Discord post fails (retries next sweep)", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [makeTrigger({ nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString() })],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    (postEmbedToChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("discord down"));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);
    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    // First sweep's post failed → key not marked → second sweep retries and succeeds.
    expect(postEmbedToChannel).toHaveBeenCalledTimes(2);
  });

  it("re-alerts after the rethreshold expires (stale dedup keys are pruned, state stays bounded)", async () => {
    const { runRoutineHealth, ROUTINE_HEALTH_STATE_KEY } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [makeTrigger({ id: "t-stale", nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString() })],
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    // Seed a dedup mark 25h old — past the 24h rethreshold.
    const stateKey = { scopeKind: "company" as const, scopeId: "c1", stateKey: ROUTINE_HEALTH_STATE_KEY };
    await harness.ctx.state.set(stateKey, {
      "missed:t-stale": new Date(Date.now() - 25 * 3600_000).toISOString(),
      "failed-run:ancient": new Date(Date.now() - 48 * 3600_000).toISOString(),
    });

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    // Expired key no longer suppresses; the alert fires again.
    expect(postEmbedToChannel).toHaveBeenCalledOnce();
    // And the pruner dropped the unrelated ancient key from durable state.
    const persisted = (await harness.ctx.state.get(stateKey)) as Record<string, string>;
    expect(persisted["failed-run:ancient"]).toBeUndefined();
    expect(persisted["missed:t-stale"]).toBeDefined();
  });

  it("alerts distinct keys independently (missed trigger + failed run in one sweep)", async () => {
    const { runRoutineHealth } = await import("../src/jobs/routine-health.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const routine = makeRoutine({
      triggers: [makeTrigger({ nextRunAt: new Date(Date.now() - 3 * 3600_000).toISOString() })],
      lastRun: { id: "run-11", status: "failed", failureReason: "kaput" },
    });
    const factory = vi.fn().mockResolvedValue(makeMockPaperclip([routine]));

    await runRoutineHealth(harness.ctx, () => makeMockClient(), config, factory);

    expect(postEmbedToChannel).toHaveBeenCalledTimes(2);
  });
});
