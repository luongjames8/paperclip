import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "@paperclipai/db";
import type { PluginEventBus } from "../services/plugin-event-bus.js";

function makeDb(): Db {
  return {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  } as unknown as Db;
}

function makeInput(action: string, overrides: Record<string, unknown> = {}) {
  return {
    companyId: "c1",
    actorType: "agent" as const,
    actorId: "a1",
    action,
    entityType: "issue",
    entityId: "i1",
    agentId: "ag1",
    runId: "r1",
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
      runId: "r1",
      details: { foo: "bar" },
    }));

    expect(emitMock).toHaveBeenCalledTimes(2);
    // Typed event — check payload shape (redactedDetails spread + agentId + runId, no action field)
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "issue.created",
        payload: expect.objectContaining({ foo: "bar", agentId: "ag1", runId: "r1" }),
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
      runId: "run-abc",
      details: { foo: "bar", baz: 42 },
    }));

    // All spread fields + metadata must appear in payload
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "activity.logged",
        payload: expect.objectContaining({
          action: "issue.comment_added",
          agentId: "agent-xyz",
          runId: "run-abc",
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
