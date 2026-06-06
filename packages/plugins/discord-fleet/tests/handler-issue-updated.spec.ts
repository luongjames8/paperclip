import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import type { Client } from "discord.js";
import { CoalesceBuffer } from "../src/util/coalesce.js";

vi.mock("../src/discord/rest.js", () => ({
  postToThread: vi.fn().mockResolvedValue("msg-id-1"),
  postToChannel: vi.fn().mockResolvedValue("msg-id-2"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id-3"),
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id-4"),
}));

vi.mock("../src/render/embeds.js", () => ({
  buildBlockedEmbed: vi.fn().mockReturnValue({ title: "blocked embed" }),
  buildSeedIssueEmbed: vi.fn().mockReturnValue({ title: "seed embed" }),
}));

function makeConfig(): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: "c1",
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: { "proj-1": "monitor-channel" },
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "tc1",
      },
    ],
  };
}

function makeIssueUpdatedEvent(
  payloadOverrides: Record<string, unknown> = {},
  eventOverrides: Partial<PluginEvent> = {},
): PluginEvent {
  return {
    eventId: "evt-u1",
    eventType: "issue.updated",
    occurredAt: new Date().toISOString(),
    companyId: "c1",
    entityId: "iss-1",
    entityType: "issue",
    payload: {
      identifier: "ISS-1",
      title: "My Issue",
      projectId: "proj-1",
      ...payloadOverrides,
    },
    ...eventOverrides,
  };
}

function makeMockClient(): Client {
  return {} as Client;
}

describe("handleIssueUpdated", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("status→blocked → posts ⛔ embed directly to channel (no coalescing)", async () => {
    const { handleIssueUpdated } = await import("../src/handlers/issue-updated.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const coalescer = new CoalesceBuffer(2000);

    const event = makeIssueUpdatedEvent({ status: "blocked", reason: "API is down" });
    await handleIssueUpdated(harness.ctx, event, client, config, coalescer);

    expect(postEmbedToChannel).toHaveBeenCalledWith(client, "monitor-channel", expect.anything());
    expect(postToChannel).not.toHaveBeenCalled();
  });

  it("status→done → posts ✅ plain reply to channel after flush", async () => {
    const { handleIssueUpdated } = await import("../src/handlers/issue-updated.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const coalescer = new CoalesceBuffer(2000);

    const event = makeIssueUpdatedEvent({ status: "done" });
    await handleIssueUpdated(harness.ctx, event, client, config, coalescer);

    await vi.advanceTimersByTimeAsync(2000);

    expect(postToChannel).toHaveBeenCalledTimes(1);
    const [, , text] = (postToChannel as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("done");
  });

  it("status→in_progress → posts 🔵 plain reply to channel after flush", async () => {
    const { handleIssueUpdated } = await import("../src/handlers/issue-updated.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const coalescer = new CoalesceBuffer(2000);

    const event = makeIssueUpdatedEvent({ status: "in_progress" });
    await handleIssueUpdated(harness.ctx, event, client, config, coalescer);

    await vi.advanceTimersByTimeAsync(2000);

    expect(postToChannel).toHaveBeenCalledTimes(1);
    const [, , text] = (postToChannel as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("🔵");
  });

  it("coalescing — 2nd update within 2s window replaces 1st", async () => {
    const { handleIssueUpdated } = await import("../src/handlers/issue-updated.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();
    const coalescer = new CoalesceBuffer(2000);

    const event1 = makeIssueUpdatedEvent({ status: "in_progress" });
    const event2 = makeIssueUpdatedEvent({ status: "done" });

    await handleIssueUpdated(harness.ctx, event1, client, config, coalescer);
    await handleIssueUpdated(harness.ctx, event2, client, config, coalescer);

    await vi.advanceTimersByTimeAsync(2000);

    expect(postToChannel).toHaveBeenCalledTimes(1);
    const [, , text] = (postToChannel as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("done");
  });
});
