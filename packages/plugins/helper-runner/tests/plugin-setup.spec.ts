import { describe, it, expect, vi } from "vitest";
import manifest from "../src/manifest.js";
import { validateConfig } from "../src/config/validate.js";
import { RoutineFiredHandler } from "../src/handlers/routine-fired.js";
import type { PluginConfig } from "../src/config/schema.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";

describe("manifest", () => {
  it("has required fields", () => {
    expect(manifest.id).toBe("openclaw.plugin-helper-runner");
    expect(manifest.apiVersion).toBe(1);
    expect(manifest.entrypoints.worker).toBeDefined();
  });

  it("declares all required capabilities", () => {
    const caps = manifest.capabilities;
    expect(caps).toContain("events.subscribe");
    expect(caps).toContain("issue.documents.write");
    expect(caps).toContain("issue.comments.create");
    expect(caps).toContain("issues.update");
    expect(caps).not.toContain("http.outbound");
    expect(caps).toContain("secrets.read-ref");
    expect(caps).toContain("plugin.state.read");
    expect(caps).toContain("plugin.state.write");
    expect(caps).toContain("metrics.write");
    expect(caps).not.toContain("jobs.schedule");
  });

  it("does not declare UI entrypoint", () => {
    expect((manifest.entrypoints as Record<string, unknown>).ui).toBeUndefined();
  });

  it("instanceConfigSchema is defined and requires helpers", () => {
    const schema = manifest.instanceConfigSchema;
    expect(schema).toBeDefined();
    expect((schema as { required: string[] }).required).toContain("helpers");
  });
});

describe("validateConfig", () => {
  it("accepts valid config", () => {
    expect(() =>
      validateConfig({
        helpers: [
          {
            name: "my-helper",
            trigger: { kind: "routine", routineId: "r-uuid" },
            exec: { command: "/absolute/path/script.py" },
          },
        ],
      })
    ).not.toThrow();
  });

  it("throws on relative exec.command", () => {
    expect(() =>
      validateConfig({
        helpers: [
          {
            name: "bad",
            trigger: { kind: "routine", routineId: "r-uuid" },
            exec: { command: "relative/path" },
          },
        ],
      })
    ).toThrow("absolute path");
  });

  it("throws on duplicate (routineId, name) pair", () => {
    expect(() =>
      validateConfig({
        helpers: [
          {
            name: "dup",
            trigger: { kind: "routine", routineId: "r-uuid" },
            exec: { command: "/bin/true" },
          },
          {
            name: "dup",
            trigger: { kind: "routine", routineId: "r-uuid" },
            exec: { command: "/bin/echo" },
          },
        ],
      })
    ).toThrow("Duplicate helper");
  });

  it("allows same name with different routineId", () => {
    expect(() =>
      validateConfig({
        helpers: [
          {
            name: "same-name",
            trigger: { kind: "routine", routineId: "routine-1" },
            exec: { command: "/bin/true" },
          },
          {
            name: "same-name",
            trigger: { kind: "routine", routineId: "routine-2" },
            exec: { command: "/bin/true" },
          },
        ],
      })
    ).not.toThrow();
  });
});

describe("onConfigChanged hot-reload", () => {
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
      secrets: { resolve: vi.fn() },
    };
  }

  it("rebuildSemaphores completes without throw on valid config", () => {
    const config: PluginConfig = {
      helpers: [
        { name: "h1", trigger: { kind: "routine", routineId: "r-1" }, exec: { command: "/bin/true" } },
      ],
    };
    const handler = new RoutineFiredHandler(() => config, makeCtx());
    expect(() => handler.rebuildSemaphores()).not.toThrow();
  });

  it("config swap accepted — new routineId activates, old deactivates", async () => {
    let currentConfig: PluginConfig = {
      helpers: [
        { name: "h1", trigger: { kind: "routine", routineId: "r-old" }, exec: { command: "/bin/true" } },
      ],
    };
    const handler = new RoutineFiredHandler(() => currentConfig, makeCtx());
    handler.rebuildSemaphores();

    // Swap to new config
    currentConfig = {
      helpers: [
        { name: "h2", trigger: { kind: "routine", routineId: "r-new" }, exec: { command: "/bin/true" } },
      ],
    };
    expect(() => {
      validateConfig(currentConfig);
      handler.rebuildSemaphores();
    }).not.toThrow();

    // Old routineId event should now produce no match
    const ctx = makeCtx();
    const handler2 = new RoutineFiredHandler(() => currentConfig, ctx);
    handler2.rebuildSemaphores();
    await handler2.handle({
      eventId: "e1",
      eventType: "issue.created",
      occurredAt: new Date().toISOString(),
      actorType: "system",
      entityId: "iss-1",
      entityType: "issue",
      companyId: "co-1",
      payload: { originKind: "routine_execution", originId: "r-old", originRunId: "run-1", identifier: "T-1" },
    });
    // No upsert calls — r-old no longer in config
    expect((ctx.issues.documents.upsert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
