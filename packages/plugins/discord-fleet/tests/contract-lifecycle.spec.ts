/**
 * Layer: contract
 * Assertion type: lifecycle invariant — plugin must not silently drop events after onConfigChanged
 *
 * AC coverage: AC4 (onConfigChanged must not leave plugin in dead state)
 *
 * P2-1 defect: onConfigChanged destroys discordClient (sets to null) but does NOT reconnect.
 * All event handlers check `if (!discordClient) return` — after config change, every event is
 * silently dropped. onHealth reports "degraded" but no alert fires and no error is thrown.
 *
 * This test will be RED until builder implements reconnection in onConfigChanged.
 */

import { describe, it, expect, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";

vi.mock("../src/discord/client.js", () => ({
  createDiscordClient: vi.fn(() => ({
    user: null,
    on: vi.fn(),
    once: vi.fn(),
    destroy: vi.fn(),
    login: vi.fn(),
  })),
  connectDiscordClient: vi.fn().mockResolvedValue(undefined),
  destroyDiscordClient: vi.fn(),
}));

vi.mock("../src/discord/slash.js", () => ({
  registerSlashCommands: vi.fn().mockResolvedValue(undefined),
  setupInteractionHandler: vi.fn(),
}));

vi.mock("../src/render/embeds.js", () => ({
  buildSeedIssueEmbed: vi.fn().mockReturnValue({ title: "seed embed" }),
  buildBlockedEmbed: vi.fn().mockReturnValue({ title: "blocked embed" }),
  buildStuckIssueEmbed: vi.fn().mockReturnValue({ title: "stuck embed" }),
  buildApprovalEmbed: vi.fn().mockReturnValue({ title: "approval embed" }),
}));

vi.mock("../src/discord/rest.js", () => ({
  postToThread: vi.fn().mockResolvedValue("msg-id-1"),
  postToChannel: vi.fn().mockResolvedValue("msg-id-2"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id-3"),
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id-4"),
}));

function makeConfig(): DiscordFleetConfig {
  return {
    botTokenSecretRef: "discord/bot-token",
    companies: [
      {
        companyId: "company-1",
        companyPrefix: "TC1",
        guildId: "guild-1",
        channels: { digest: "ch-digest", errors: "ch-errors", orphan: "ch-orphan" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "paperclip/api-key",
        paperclipApiUrl: "http://100.98.95.12:3100",
      },
    ],
  };
}

describe("plugin lifecycle — onConfigChanged must not silence event handlers (AC4)", () => {
  it("issue.created events emitted after onConfigChanged are still processed by handlers (AC4)", async () => {
    /**
     * Layer: contract
     * Assertion type: lifecycle invariant — events must not be silently dropped after config update
     * Call site pinned: src/worker.ts:111-130 (onConfigChanged body — destroys client, no reconnect)
     * Mutation result (current code IS broken): onConfigChanged sets discordClient = null;
     *   event handler at worker.ts:60 checks `if (!discordClient) return` → silently returns
     *   → buildSeedIssueEmbed never called → expect(...).toHaveBeenCalled() fails → RED
     *
     * Fix required: onConfigChanged must reconnect discordClient (or equivalent) before returning
     *   so that event handlers registered during setup continue to fire.
     *
     * P2-1 severity: plugin is functionally dead after ANY operator config change.
     *   onHealth reports "degraded" but no alert fires and events pass through silently.
     */
    const { buildSeedIssueEmbed } = await import("../src/render/embeds.js");
    const plugin = (await import("../src/worker.js")).default;

    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities, "jobs.schedule"],
      config: makeConfig() as unknown as Record<string, unknown>,
    });

    // Phase 1: normal startup — plugin connects, event handlers registered
    await plugin.definition.setup(harness.ctx);

    // Phase 2: operator updates config at runtime (e.g. rotates API key)
    await plugin.definition.onConfigChanged?.(makeConfig() as unknown as Record<string, unknown>);

    // Phase 3: a Paperclip event arrives after the config change
    await harness.emit(
      "issue.created",
      {
        identifier: "TC1-42",
        title: "Post-config-change issue",
        status: "todo",
        originKind: "routine_execution",
      },
      {
        companyId: "company-1",
        entityId: "iss-post-config",
        entityType: "issue",
      },
    );

    // Plugin MUST remain operational after config change
    // Currently RED: discordClient = null → handler at worker.ts:60 returns early
    expect(
      buildSeedIssueEmbed,
      "buildSeedIssueEmbed must be called — event must not be silently dropped after onConfigChanged",
    ).toHaveBeenCalled();
  });
});
