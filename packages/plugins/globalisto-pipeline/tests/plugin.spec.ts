import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

describe("plugin manifest + setup", () => {
  it("manifest is valid per pluginManifestV1Schema", () => {
    expect(() => pluginManifestV1Schema.parse(manifest)).not.toThrow();
  });

  it("setup runs without throwing", async () => {
    const harness = createTestHarness({ manifest });
    // agents.invoke is not auto-mocked by harness — patch to avoid errors if called
    harness.ctx.agents.invoke = async () => ({ runId: randomUUID() });
    await expect(plugin.definition.setup(harness.ctx)).resolves.not.toThrow();
  });
});
