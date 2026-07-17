/**
 * Coverage: handleExecutionStagePending (fleet issue #631 / PR-0) — renders
 * an executionPolicy review/approval stage as a clickable Discord card, but
 * ONLY for "user" participants (agent participants are woken natively via
 * heartbeat and never need a Discord card).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id-1"),
}));

function makeConfig(overrides: Partial<DiscordFleetConfig> = {}): DiscordFleetConfig {
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
        paperclipApiUrl: "http://paperclip:3100",
        companyPrefix: "tc1",
      },
    ],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<PluginEvent> & { payload?: Record<string, unknown> } = {}): PluginEvent {
  const { payload: payloadOverride, ...rest } = overrides;
  return {
    eventId: "evt-1",
    eventType: "issue.execution_stage.pending",
    occurredAt: new Date().toISOString(),
    companyId: "c1",
    entityId: "iss-1",
    entityType: "issue",
    payload: {
      issueId: "iss-1",
      identifier: "ISS-1",
      title: "Carousel batch review",
      projectId: "proj-1",
      stageId: "stage-1",
      stageType: "review",
      participant: { type: "user", userId: "pc-user-alice", agentId: null },
      ...payloadOverride,
    },
    ...rest,
  };
}

function makeMockClient(): Client {
  return {} as Client;
}

describe("handleExecutionStagePending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("user participant → posts embed with Approve/Request-changes/View buttons to the routed channel", async () => {
    const { handleExecutionStagePending } = await import("../src/handlers/execution-stage-pending.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    await handleExecutionStagePending(harness.ctx, makeEvent(), client, config);

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
    const [calledClient, channelId, embed, components] = (postEmbedToChannel as any).mock.calls[0];
    expect(calledClient).toBe(client);
    expect(channelId).toBe("monitor-channel");
    expect(embed.title).toContain("Carousel batch review");
    expect(embed.description).toContain("ISS-1");
    expect(components).toHaveLength(1);
    const customIds = components[0].components.map((c: any) => c.custom_id ?? c.url);
    expect(customIds).toEqual([
      "execstage-approve:iss-1:stage-1",
      "execstage-changes:iss-1:stage-1",
      "http://paperclip:3100/tc1/issues/ISS-1",
    ]);
  });

  it("missing stageId in payload → does NOT post a card (can't render a stale-safe button)", async () => {
    const { handleExecutionStagePending } = await import("../src/handlers/execution-stage-pending.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    const event = makeEvent({ payload: { stageId: undefined } });
    await handleExecutionStagePending(harness.ctx, event, client, config);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("agent participant → does NOT post a card (handled natively via heartbeat wake)", async () => {
    const { handleExecutionStagePending } = await import("../src/handlers/execution-stage-pending.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    const event = makeEvent({ payload: { participant: { type: "agent", agentId: "agent-1", userId: null } } });
    await handleExecutionStagePending(harness.ctx, event, client, config);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("unknown company → no-op", async () => {
    const { handleExecutionStagePending } = await import("../src/handlers/execution-stage-pending.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    const event = makeEvent({ companyId: "unknown-co" });
    await handleExecutionStagePending(harness.ctx, event, client, config);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("executionStageChannelsByType match wins over projectRouting", async () => {
    const { handleExecutionStagePending } = await import("../src/handlers/execution-stage-pending.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      executionStageChannelsByType: { c1: [["[Cc]arousel", "carousel-review-thread"]] },
    });
    const client = makeMockClient();

    await handleExecutionStagePending(harness.ctx, makeEvent(), client, config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(
      client,
      "carousel-review-thread",
      expect.anything(),
      expect.anything(),
    );
  });

  it("no executionStageChannelsByType match → falls back to projectRouting", async () => {
    const { handleExecutionStagePending } = await import("../src/handlers/execution-stage-pending.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      executionStageChannelsByType: { c1: [["unrelated-pattern", "other-thread"]] },
    });
    const client = makeMockClient();

    await handleExecutionStagePending(harness.ctx, makeEvent(), client, config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(client, "monitor-channel", expect.anything(), expect.anything());
  });
});
