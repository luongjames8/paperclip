import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { Client } from "discord.js";
import type { PaperclipClient } from "../src/api/paperclip.js";
import { validateConfig } from "../src/config/validate.js";

vi.mock("../src/discord/rest.js", () => ({
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id"),
  postToChannel: vi.fn().mockResolvedValue("msg-id"),
  postToThread: vi.fn().mockResolvedValue("msg-id"),
}));

function makeConfig(stuckIssueThresholdHours: number): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: "c1",
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "tc1",
      },
    ],
  };
}

function makeMockClient(): Client {
  return {} as Client;
}

describe("stuck-detector threshold guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips company and makes no posts when stuckIssueThresholdHours is 0", async () => {
    const { runStuckDetector } = await import("../src/jobs/stuck-detector.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(0);
    const factory = vi.fn().mockResolvedValue({} as PaperclipClient);

    await runStuckDetector(harness.ctx, makeMockClient(), config, factory);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
    // Factory should not be called — we bail before hitting the API
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("validateConfig — stuckIssueThresholdHours enforcement", () => {
  it("throws when stuckIssueThresholdHours is 0", () => {
    const config = makeConfig(0);
    expect(() => validateConfig(config)).toThrow(/stuckIssueThresholdHours/);
  });

  it("accepts stuckIssueThresholdHours = 1", () => {
    const config = makeConfig(1);
    expect(() => validateConfig(config)).not.toThrow();
  });
});
