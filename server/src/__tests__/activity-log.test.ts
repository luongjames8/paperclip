import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "@paperclipai/db";
import type { PluginEventBus } from "../services/plugin-event-bus.js";

// makeDb's `select` chain backs resolveVerifiedRunId's single indexed
// existence lookup (heartbeat_runs.id) — runExists controls whether that
// lookup returns a row, independent of the insert-side assertions the tests
// make below.
function makeDb(opts: { runExists?: boolean } = {}): Db {
  const runExists = opts.runExists ?? true;
  return {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(runExists ? [{ id: "run-row" }] : []),
        }),
      }),
    }),
  } as unknown as Db;
}

// Valid-shaped UUID fixture (RFC 4122 v4: version nibble "4", variant nibble
// in [89ab]) — logActivity guards runId with resolveVerifiedRunId (a
// malformed OR well-formed-but-nonexistent runId is dropped to null rather
// than passed through to the Postgres uuid/FK column; see the dedicated
// "malformed runId" and "stale/unknown runId" tests below), so pass-through
// fixtures need a REAL uuid shape, not just a same-length placeholder, to
// exercise the happy path.
const VALID_RUN_ID = "11111111-1111-4111-8111-111111111111";

function makeInput(action: string, overrides: Record<string, unknown> = {}) {
  return {
    companyId: "c1",
    actorType: "agent" as const,
    actorId: "a1",
    action,
    entityType: "issue",
    entityId: "i1",
    agentId: "ag1",
    runId: VALID_RUN_ID,
    details: null,
    ...overrides,
  };
}

describe("logActivity — activity.logged catch-all emit", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../services/instance-settings.js", () => ({
      instanceSettingsService: () => ({
        getGeneral: vi.fn().mockResolvedValue({ censorUsernameInLogs: false }),
      }),
    }));
    vi.doMock("../services/live-events.js", () => ({
      publishLiveEvent: vi.fn(),
    }));
    vi.doMock("../log-redaction.js", () => ({
      redactCurrentUserValue: (v: unknown) => v,
    }));
    vi.doMock("../redaction.js", () => ({
      sanitizeRecord: (v: unknown) => v,
    }));
    vi.doMock("../middleware/logger.js", () => ({
      logger: { warn: vi.fn() },
    }));
  });

  it("emits activity.logged once for action NOT in PLUGIN_EVENT_SET", async () => {
    const { logActivity, setPluginEventBus } = await import("../services/activity-log.js");
    const emitMock = vi.fn().mockResolvedValue({ errors: [] });
    setPluginEventBus({ emit: emitMock } as unknown as PluginEventBus);

    // issue.status_changed is not in PLUGIN_EVENT_SET nor ACTIVITY_ACTION_TO_PLUGIN_EVENT
    // (unlike issue.comment_added, which normalizes to issue_comment_added and IS mapped —
    // verified against v2026.707.0's activity-log.ts; re-check this action still unmapped
    // on future paperclip upgrades).
    await logActivity(makeDb(), makeInput("issue.status_changed"));

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "activity.logged",
        payload: expect.objectContaining({ action: "issue.status_changed" }),
      }),
    );
  });

  it("emits typed event AND activity.logged for action IN PLUGIN_EVENT_SET", async () => {
    const { logActivity, setPluginEventBus } = await import("../services/activity-log.js");
    const emitMock = vi.fn().mockResolvedValue({ errors: [] });
    setPluginEventBus({ emit: emitMock } as unknown as PluginEventBus);

    await logActivity(makeDb(), makeInput("issue.created", {
      agentId: "ag1",
      runId: VALID_RUN_ID,
      details: { foo: "bar" },
    }));

    expect(emitMock).toHaveBeenCalledTimes(2);
    // Typed event — check payload shape (redactedDetails spread + agentId + runId, no action field)
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "issue.created",
        payload: expect.objectContaining({ foo: "bar", agentId: "ag1", runId: VALID_RUN_ID }),
      }),
    );
    // Catch-all event
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "activity.logged",
        payload: expect.objectContaining({ action: "issue.created", foo: "bar" }),
      }),
    );
  });

  it("no throw and no emit when no bus is set", async () => {
    const { logActivity, setPluginEventBus } = await import("../services/activity-log.js");
    const emitMock = vi.fn().mockResolvedValue({ errors: [] });
    // Register the bus, then clear it — proves the null guard actually prevents emission
    setPluginEventBus({ emit: emitMock } as unknown as PluginEventBus);
    setPluginEventBus(null as unknown as PluginEventBus);
    await expect(logActivity(makeDb(), makeInput("issue.created"))).resolves.toBeUndefined();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("activity.logged payload spreads redactedDetails and omits raw details key", async () => {
    const { logActivity, setPluginEventBus } = await import("../services/activity-log.js");
    const emitMock = vi.fn().mockResolvedValue({ errors: [] });
    setPluginEventBus({ emit: emitMock } as unknown as PluginEventBus);

    await logActivity(makeDb(), makeInput("issue.comment_added", {
      agentId: "agent-xyz",
      runId: VALID_RUN_ID,
      details: { foo: "bar", baz: 42 },
    }));

    // All spread fields + metadata must appear in payload
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "activity.logged",
        payload: expect.objectContaining({
          action: "issue.comment_added",
          agentId: "agent-xyz",
          runId: VALID_RUN_ID,
          foo: "bar",
          baz: 42,
        }),
      }),
    );
    // Raw input.details must NOT appear as a nested key in payload
    const catchAllCall = emitMock.mock.calls.find(
      (call) => (call[0] as { eventType: string }).eventType === "activity.logged",
    );
    const payload = (catchAllCall![0] as { payload: Record<string, unknown> }).payload;
    expect(payload).not.toHaveProperty("details");
  });

  it("action in payload is not overwritten by a matching key in input.details", async () => {
    const { logActivity, setPluginEventBus } = await import("../services/activity-log.js");
    const emitMock = vi.fn().mockResolvedValue({ errors: [] });
    setPluginEventBus({ emit: emitMock } as unknown as PluginEventBus);

    // Use an action IN PLUGIN_EVENT_SET so both typed and catch-all paths fire
    await logActivity(makeDb(), makeInput("issue.created", {
      details: { action: "fake.evil.action" },
    }));

    // Typed-event path
    const typedCall = emitMock.mock.calls.find(
      (call) => (call[0] as { eventType: string }).eventType === "issue.created",
    );
    expect((typedCall![0] as { payload: Record<string, unknown> }).payload.action).toBe("issue.created");

    // Catch-all path
    const catchAllCall = emitMock.mock.calls.find(
      (call) => (call[0] as { eventType: string }).eventType === "activity.logged",
    );
    expect((catchAllCall![0] as { payload: Record<string, unknown> }).payload.action).toBe("issue.created");
  });
});

// ─── Malformed / stale runId guard (2026-07-11 live incident, failure 4;
// widened codex round 4) ─────────────────────────────────────────────────
//
// activityLog.runId is a Postgres uuid column AND a foreign key into
// heartbeat_runs. Before this fix, logActivity passed input.runId straight
// through to the INSERT with zero validation — input.runId traces back to
// the caller-supplied X-Paperclip-Run-Id request header (an agent sets this
// on every mutating call per AGENTS.md), so EITHER a malformed/non-uuid
// header value (throws "invalid input syntax for type uuid") OR a
// well-formed-but-stale/nonexistent uuid (throws a foreign key violation)
// crashed the ENTIRE mutation (issue create, comment post, etc.) with a bare
// HTTP 500. Both classes must now be dropped to null (with a warning), never
// crash the mutation — resolveVerifiedRunId (run-id-trust.ts) is the single
// primitive that does the indexed existence check backing this.

describe("logActivity — malformed/stale runId guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../services/instance-settings.js", () => ({
      instanceSettingsService: () => ({
        getGeneral: vi.fn().mockResolvedValue({ censorUsernameInLogs: false }),
      }),
    }));
    vi.doMock("../services/live-events.js", () => ({
      publishLiveEvent: vi.fn(),
    }));
    vi.doMock("../log-redaction.js", () => ({
      redactCurrentUserValue: (v: unknown) => v,
    }));
    vi.doMock("../redaction.js", () => ({
      sanitizeRecord: (v: unknown) => v,
    }));
  });

  it("a non-uuid runId (e.g. an agent-supplied X-Paperclip-Run-Id that isn't a UUID) is dropped to null in the DB insert, not passed through to crash the uuid column", async () => {
    const warnMock = vi.fn();
    vi.doMock("../middleware/logger.js", () => ({ logger: { warn: warnMock } }));
    const { logActivity } = await import("../services/activity-log.js");

    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const db = { ...makeDb(), insert: vi.fn().mockReturnValue({ values: valuesMock }) } as unknown as Db;

    await expect(logActivity(db, makeInput("issue.created", { runId: "not-a-uuid" }))).resolves.toBeUndefined();

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ runId: null }));
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "not-a-uuid" }),
      expect.stringMatching(/not a valid.*uuid|not a valid\/known/i),
    );
  });

  it("a well-formed but STALE/nonexistent runId (no matching heartbeat_runs row) is ALSO dropped to null in the DB insert, not passed through to violate the foreign key", async () => {
    const warnMock = vi.fn();
    vi.doMock("../middleware/logger.js", () => ({ logger: { warn: warnMock } }));
    const { logActivity } = await import("../services/activity-log.js");

    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const db = { ...makeDb({ runExists: false }), insert: vi.fn().mockReturnValue({ values: valuesMock }) } as unknown as Db;

    await expect(logActivity(db, makeInput("issue.created", { runId: VALID_RUN_ID }))).resolves.toBeUndefined();

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ runId: null }));
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: VALID_RUN_ID }),
      expect.stringMatching(/not a valid.*uuid|not a valid\/known/i),
    );
  });

  it("an empty-string runId is treated as absent (dropped to null, no warning noise for the common 'no run' case)", async () => {
    const warnMock = vi.fn();
    vi.doMock("../middleware/logger.js", () => ({ logger: { warn: warnMock } }));
    const { logActivity } = await import("../services/activity-log.js");

    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const db = { ...makeDb(), insert: vi.fn().mockReturnValue({ values: valuesMock }) } as unknown as Db;

    await logActivity(db, makeInput("issue.created", { runId: "" }));

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ runId: null }));
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("null/undefined runId passes through as null unchanged (no warning — this is the normal no-run-context case)", async () => {
    const warnMock = vi.fn();
    vi.doMock("../middleware/logger.js", () => ({ logger: { warn: warnMock } }));
    const { logActivity } = await import("../services/activity-log.js");

    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const db = { ...makeDb(), insert: vi.fn().mockReturnValue({ values: valuesMock }) } as unknown as Db;

    await logActivity(db, makeInput("issue.created", { runId: null }));

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ runId: null }));
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("a valid-shaped uuid runId that DOES match a real heartbeat_runs row passes through unchanged", async () => {
    const warnMock = vi.fn();
    vi.doMock("../middleware/logger.js", () => ({ logger: { warn: warnMock } }));
    const { logActivity } = await import("../services/activity-log.js");

    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const db = { ...makeDb({ runExists: true }), insert: vi.fn().mockReturnValue({ values: valuesMock }) } as unknown as Db;

    await logActivity(db, makeInput("issue.created", { runId: VALID_RUN_ID }));

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ runId: VALID_RUN_ID }));
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("the malformed runId is ALSO scrubbed from the live-event and typed plugin-event payloads (consistent null everywhere, not just the DB insert)", async () => {
    vi.doMock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));
    const { logActivity, setPluginEventBus } = await import("../services/activity-log.js");
    const emitMock = vi.fn().mockResolvedValue({ errors: [] });
    setPluginEventBus({ emit: emitMock } as unknown as PluginEventBus);

    const db = { ...makeDb(), insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) } as unknown as Db;
    await logActivity(db, makeInput("issue.created", { runId: "not-a-uuid" }));

    const typedCall = emitMock.mock.calls.find((call) => (call[0] as { eventType: string }).eventType === "issue.created");
    expect((typedCall![0] as { payload: Record<string, unknown> }).payload.runId).toBeNull();

    const catchAllCall = emitMock.mock.calls.find((call) => (call[0] as { eventType: string }).eventType === "activity.logged");
    expect((catchAllCall![0] as { payload: Record<string, unknown> }).payload.runId).toBeNull();
  });

  it("the stale-valid-uuid runId is ALSO scrubbed from the live-event and typed plugin-event payloads (consistent null everywhere, not just the DB insert)", async () => {
    vi.doMock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));
    const { logActivity, setPluginEventBus } = await import("../services/activity-log.js");
    const emitMock = vi.fn().mockResolvedValue({ errors: [] });
    setPluginEventBus({ emit: emitMock } as unknown as PluginEventBus);

    const db = { ...makeDb({ runExists: false }), insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) } as unknown as Db;
    await logActivity(db, makeInput("issue.created", { runId: VALID_RUN_ID }));

    const typedCall = emitMock.mock.calls.find((call) => (call[0] as { eventType: string }).eventType === "issue.created");
    expect((typedCall![0] as { payload: Record<string, unknown> }).payload.runId).toBeNull();

    const catchAllCall = emitMock.mock.calls.find((call) => (call[0] as { eventType: string }).eventType === "activity.logged");
    expect((catchAllCall![0] as { payload: Record<string, unknown> }).payload.runId).toBeNull();
  });
});
