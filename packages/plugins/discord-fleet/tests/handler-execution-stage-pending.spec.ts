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

vi.mock("../src/api/paperclip.js", () => ({
  PaperclipClient: vi.fn().mockImplementation(() => ({
    addIssueComment: vi.fn().mockResolvedValue(undefined),
  })),
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
      lastDecisionId: "d3c1d10n-0000-4000-8000-000000000000",
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
      "exs-ok:iss-1:stage-1:d3c1d10n",
      "exs-chg:iss-1:stage-1:d3c1d10n",
      "http://paperclip:3100/tc1/issues/ISS-1",
    ]);
  });

  it("missing lastDecisionId in payload → customId encodes the 'none' sentinel", async () => {
    const { handleExecutionStagePending } = await import("../src/handlers/execution-stage-pending.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    const event = makeEvent({ payload: { lastDecisionId: null } });
    await handleExecutionStagePending(harness.ctx, event, client, config);

    const [, , , components] = (postEmbedToChannel as any).mock.calls[0];
    const customIds = components[0].components.map((c: any) => c.custom_id ?? c.url);
    expect(customIds[0]).toBe("exs-ok:iss-1:stage-1:none");
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

  // codex round 10: a channel-level post failure (bad/deleted channel,
  // missing permission, archived thread) while the bot IS connected used to
  // only be logged — the review/approval stage was invisible outside plugin
  // logs. Mirrors approval-created.ts's header-card catch via the round-9
  // execution-stage delivery-fallback (addIssueComment).
  it("card post failure (bot connected, channel post rejects) → logs and posts a fallback comment on the issue", async () => {
    const { handleExecutionStagePending } = await import("../src/handlers/execution-stage-pending.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");
    (postEmbedToChannel as any).mockRejectedValueOnce(new Error("Missing Access"));
    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    await handleExecutionStagePending(harness.ctx, makeEvent(), client, config);

    const errorLog = harness.logs.find((l) => l.message === "execution-stage-pending: card post failed");
    expect(errorLog?.meta).toMatchObject({ issueId: "iss-1", companyId: "c1" });

    const paperclipInstance = (PaperclipClient as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    expect(paperclipInstance.addIssueComment).toHaveBeenCalledWith(
      "iss-1",
      expect.stringContaining("could not deliver"),
    );
  });

  it("card post failure is deduped — a second identical event does not post a second fallback comment", async () => {
    const { handleExecutionStagePending } = await import("../src/handlers/execution-stage-pending.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");
    const { PaperclipClient } = await import("../src/api/paperclip.js");
    (postEmbedToChannel as any).mockRejectedValue(new Error("Missing Access"));
    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    await handleExecutionStagePending(harness.ctx, makeEvent(), client, config);
    await handleExecutionStagePending(harness.ctx, makeEvent(), client, config);

    const paperclipInstance = (PaperclipClient as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    expect(paperclipInstance.addIssueComment).toHaveBeenCalledTimes(1);
  });
});
