import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postToThread: vi.fn().mockResolvedValue("msg-id-1"),
  postToChannel: vi.fn().mockResolvedValue("msg-id-2"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id-3"),
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id-4"),
}));

vi.mock("../src/render/embeds.js", () => ({
  buildSeedIssueEmbed: vi.fn().mockReturnValue({ title: "mock embed" }),
  buildBlockedEmbed: vi.fn().mockReturnValue({ title: "blocked embed" }),
  buildApprovalEmbed: vi.fn().mockReturnValue({ title: "approval embed" }),
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

function makeIssueCreatedEvent(
  overrides: Partial<PluginEvent> & { payload?: Record<string, unknown> } = {},
): PluginEvent {
  const { payload: payloadOverride, ...rest } = overrides;
  return {
    eventId: "evt-1",
    eventType: "issue.created",
    occurredAt: new Date().toISOString(),
    companyId: "c1",
    entityId: "iss-1",
    entityType: "issue",
    payload: {
      identifier: "ISS-1",
      title: "Build homepage",
      status: "todo",
      projectId: "proj-1",
      originKind: "routine_execution",
      ...payloadOverride,
    },
    ...rest,
  };
}

function makeMockClient(): Client {
  return {} as Client;
}

describe("handleIssueCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seed issue (originKind=routine_execution) → posts embed to routed channel", async () => {
    const { handleIssueCreated } = await import("../src/handlers/issue-created.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    const event = makeIssueCreatedEvent();
    await handleIssueCreated(harness.ctx, event, client, config);

    expect(postEmbedToChannel).toHaveBeenCalledWith(
      client,
      "monitor-channel",
      expect.anything(),
    );
  });

  it("child issue (parentId set) → posts to routed channel", async () => {
    const { handleIssueCreated } = await import("../src/handlers/issue-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    const event = makeIssueCreatedEvent({
      entityId: "iss-2",
      payload: {
        identifier: "ISS-2",
        title: "Child task",
        status: "todo",
        projectId: "proj-1",
        originKind: "task",
        parentId: "parent-1",
        ancestorIds: ["parent-1"],
      },
    });

    await handleIssueCreated(harness.ctx, event, client, config);

    expect(postToChannel).toHaveBeenCalledWith(
      client,
      "monitor-channel",
      expect.stringContaining("ISS-2"),
    );
  });

  it("child with unrouted project → posts to orphan channel", async () => {
    const { handleIssueCreated } = await import("../src/handlers/issue-created.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig();
    const client = makeMockClient();

    const event = makeIssueCreatedEvent({
      entityId: "iss-3",
      payload: {
        identifier: "ISS-3",
        title: "Orphan child",
        status: "todo",
        projectId: undefined,
        originKind: "task",
        parentId: "unknown-parent",
        ancestorIds: ["unknown-parent"],
      },
    });

    await handleIssueCreated(harness.ctx, event, client, config);

    expect(postToChannel).toHaveBeenCalledWith(
      client,
      "o1",
      expect.stringContaining("ISS-3"),
    );
  });
});
