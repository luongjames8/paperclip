import { describe, it, expect, vi } from "vitest";
import { RoutineFiredHandler } from "../src/handlers/routine-fired.js";
import type { PluginConfig } from "../src/config/schema.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";

function makeCtx(): Pick<PluginContext, "logger" | "issues" | "secrets"> {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    issues: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      listComments: vi.fn(),
      createComment: vi.fn().mockResolvedValue({}),
      documents: {
        list: vi.fn(),
        get: vi.fn(),
        upsert: vi.fn().mockResolvedValue({}),
        delete: vi.fn(),
      },
    } as unknown as PluginContext["issues"],
    secrets: { resolve: vi.fn(async (ref: string) => `secret-${ref}`) },
  };
}

function makeEvent(routineId: string, issueId = "iss-1", runId = "run-uuid"): PluginEvent {
  return {
    eventId: "evt-1",
    eventType: "issue.created",
    occurredAt: new Date().toISOString(),
    actorId: "system",
    actorType: "system",
    entityId: issueId,
    entityType: "issue",
    companyId: "co-1",
    payload: {
      originKind: "routine_execution",
      originId: routineId,
      originRunId: runId,
      identifier: "HIN-1",
    },
  };
}

function makeConfig(overrides: Partial<PluginConfig["helpers"][0]> = {}): PluginConfig {
  return {
    helpers: [
      {
        name: "test-helper",
        trigger: { kind: "routine", routineId: "r-uuid" },
        exec: { command: "/bin/false", timeoutSec: 5 },
        output: { documentKey: "out", comment: true },
        errorHandling: { onFailure: "noop", onTimeout: "noop" },
        ...overrides,
      },
    ],
  };
}

describe("error handling — onFailure policies", () => {
  it("block_issue: patches status to blocked on non-zero exit", async () => {
    const ctx = makeCtx();
    const config = makeConfig({ errorHandling: { onFailure: "block_issue", onTimeout: "noop" } });
    const handler = new RoutineFiredHandler(() => config, ctx);
    handler.rebuildSemaphores();
    await handler.handle(makeEvent("r-uuid"));
    const updateMock = ctx.issues.update as ReturnType<typeof vi.fn>;
    const patchCall = updateMock.mock.calls.find((args: unknown[]) => (args[1] as { status?: string })?.status === "blocked");
    expect(patchCall).toBeDefined();
  });

  it("cancel_issue: patches status to cancelled on non-zero exit", async () => {
    const ctx = makeCtx();
    const config = makeConfig({ errorHandling: { onFailure: "cancel_issue", onTimeout: "noop" } });
    const handler = new RoutineFiredHandler(() => config, ctx);
    handler.rebuildSemaphores();
    await handler.handle(makeEvent("r-uuid"));
    const updateMock = ctx.issues.update as ReturnType<typeof vi.fn>;
    const patchCall = updateMock.mock.calls.find((args: unknown[]) => (args[1] as { status?: string })?.status === "cancelled");
    expect(patchCall).toBeDefined();
  });

  it("noop: does not patch status on non-zero exit, but still writes error doc", async () => {
    const ctx = makeCtx();
    const config = makeConfig({ errorHandling: { onFailure: "noop", onTimeout: "noop" } });
    const handler = new RoutineFiredHandler(() => config, ctx);
    handler.rebuildSemaphores();
    await handler.handle(makeEvent("r-uuid"));
    const updateMock = ctx.issues.update as ReturnType<typeof vi.fn>;
    const patchCall = updateMock.mock.calls.find((args: unknown[]) => {
      const s = (args[1] as { status?: string })?.status;
      return s === "blocked" || s === "cancelled";
    });
    expect(patchCall).toBeUndefined();
    // Error doc MUST still be written even when policy is noop
    const upsertMock = ctx.issues.documents.upsert as ReturnType<typeof vi.fn>;
    const errorDocCall = upsertMock.mock.calls.find((args: unknown[]) => ((args[0] as { key?: string })?.key ?? "").includes("-error"));
    expect(errorDocCall).toBeDefined();
  });
});

describe("error handling — onTimeout policies", () => {
  it("block_issue: patches status to blocked on timeout", async () => {
    const ctx = makeCtx();
    const config = makeConfig({
      exec: { command: "/bin/sleep", args: ["60"], timeoutSec: 1 },
      errorHandling: { onFailure: "noop", onTimeout: "block_issue" },
    });
    const handler = new RoutineFiredHandler(() => config, ctx);
    handler.rebuildSemaphores();
    await handler.handle(makeEvent("r-uuid"));
    const updateMock = ctx.issues.update as ReturnType<typeof vi.fn>;
    const patchCall = updateMock.mock.calls.find((args: unknown[]) => (args[1] as { status?: string })?.status === "blocked");
    expect(patchCall).toBeDefined();
  }, 10000);

  it("cancel_issue: patches status to cancelled on timeout", async () => {
    const ctx = makeCtx();
    const config = makeConfig({
      exec: { command: "/bin/sleep", args: ["60"], timeoutSec: 1 },
      errorHandling: { onFailure: "noop", onTimeout: "cancel_issue" },
    });
    const handler = new RoutineFiredHandler(() => config, ctx);
    handler.rebuildSemaphores();
    await handler.handle(makeEvent("r-uuid"));
    const updateMock = ctx.issues.update as ReturnType<typeof vi.fn>;
    const patchCall = updateMock.mock.calls.find((args: unknown[]) => (args[1] as { status?: string })?.status === "cancelled");
    expect(patchCall).toBeDefined();
  }, 10000);

  it("noop: does not patch status on timeout, but still writes error doc", async () => {
    const ctx = makeCtx();
    const config = makeConfig({
      exec: { command: "/bin/sleep", args: ["60"], timeoutSec: 1 },
      errorHandling: { onFailure: "noop", onTimeout: "noop" },
    });
    const handler = new RoutineFiredHandler(() => config, ctx);
    handler.rebuildSemaphores();
    await handler.handle(makeEvent("r-uuid"));
    const updateMock = ctx.issues.update as ReturnType<typeof vi.fn>;
    const patchCall = updateMock.mock.calls.find((args: unknown[]) => {
      const s = (args[1] as { status?: string })?.status;
      return s === "blocked" || s === "cancelled";
    });
    expect(patchCall).toBeUndefined();
    // Error doc MUST still be written even when policy is noop
    const upsertMock = ctx.issues.documents.upsert as ReturnType<typeof vi.fn>;
    const errorDocCall = upsertMock.mock.calls.find((args: unknown[]) => ((args[0] as { key?: string })?.key ?? "").includes("-error"));
    expect(errorDocCall).toBeDefined();
  }, 10000);
});
