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

function makeConfig(): PluginConfig {
  return {
    helpers: [
      {
        name: "helper-a",
        trigger: { kind: "routine", routineId: "routine-a" },
        exec: { command: "/bin/echo", args: ["matched"] },
      },
    ],
  };
}

function makeEvent(opts: {
  originKind?: string;
  originId?: string;
  entityId?: string;
  identifier?: string;
  originRunId?: string;
  companyId?: string;
}): PluginEvent {
  return {
    eventId: "evt-1",
    eventType: "issue.created",
    occurredAt: new Date().toISOString(),
    actorId: "system",
    actorType: "system",
    entityId: opts.entityId ?? "iss-1",
    entityType: "issue",
    companyId: opts.companyId ?? "co-1",
    payload: {
      ...(opts.originKind !== undefined ? { originKind: opts.originKind } : {}),
      ...(opts.originId !== undefined ? { originId: opts.originId } : {}),
      ...(opts.identifier !== undefined ? { identifier: opts.identifier } : {}),
      ...(opts.originRunId !== undefined ? { originRunId: opts.originRunId } : {}),
    },
  };
}

describe("RoutineFiredHandler routing", () => {
  it("handles matching routineId", async () => {
    const ctx = makeCtx();
    const handler = new RoutineFiredHandler(() => makeConfig(), ctx);
    handler.rebuildSemaphores();
    await handler.handle(makeEvent({ originKind: "routine_execution", originId: "routine-a", identifier: "HIN-1", originRunId: "run-1" }));
    expect((ctx.issues.documents.upsert as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it("skips event with wrong originKind", async () => {
    const ctx = makeCtx();
    const handler = new RoutineFiredHandler(() => makeConfig(), ctx);
    handler.rebuildSemaphores();
    await handler.handle(makeEvent({ originKind: "manual", originId: "routine-a" }));
    expect((ctx.issues.documents.upsert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("skips event with unmatched routineId", async () => {
    const ctx = makeCtx();
    const handler = new RoutineFiredHandler(() => makeConfig(), ctx);
    handler.rebuildSemaphores();
    await handler.handle(makeEvent({ originKind: "routine_execution", originId: "routine-unknown" }));
    expect((ctx.issues.documents.upsert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("skips event missing originId in payload", async () => {
    const ctx = makeCtx();
    const handler = new RoutineFiredHandler(() => makeConfig(), ctx);
    handler.rebuildSemaphores();
    await handler.handle(makeEvent({ originKind: "routine_execution" }));
    expect((ctx.issues.documents.upsert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("skips event missing entityId (no issue to operate on)", async () => {
    const ctx = makeCtx();
    const handler = new RoutineFiredHandler(() => makeConfig(), ctx);
    handler.rebuildSemaphores();
    const event = makeEvent({ originKind: "routine_execution", originId: "routine-a" });
    (event as unknown as Record<string, unknown>).entityId = undefined;
    await handler.handle(event);
    expect((ctx.issues.documents.upsert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
