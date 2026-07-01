/**
 * Tests for CHANGE 4: confirmation-sweep job.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PaperclipClient, PaperclipIssue, PaperclipInteraction } from "../src/api/paperclip.js";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-1"),
  postToChannel: vi.fn().mockResolvedValue("msg-2"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-3"),
  postToThread: vi.fn().mockResolvedValue("msg-4"),
}));

function makeConfig(confirmationSweep?: DiscordFleetConfig["confirmationSweep"]): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: "c1",
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "tc1",
      },
    ],
    confirmationSweep,
  };
}

function makeIssue(overrides: Partial<PaperclipIssue> = {}): PaperclipIssue {
  return {
    id: "iss-1",
    identifier: "ISS-1",
    title: "Carousel week 27 draft",
    status: "backlog",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInteraction(overrides: Partial<PaperclipInteraction> = {}): PaperclipInteraction {
  return {
    id: "int-1",
    kind: "request_confirmation",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    payload: { detailsMarkdown: "Please review the carousel before publishing." },
    ...overrides,
  };
}

function makePaperclip(issues: PaperclipIssue[], interactions: PaperclipInteraction[]): PaperclipClient {
  return {
    getBacklogAndTodoIssues: vi.fn().mockResolvedValue(issues),
    listIssueInteractions: vi.fn().mockResolvedValue(interactions),
  } as unknown as PaperclipClient;
}

describe("runConfirmationSweep — CHANGE 4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts an embed to the configured channelId for a matching pending confirmation", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      c1: [{ titleRegex: "Carousel", channelId: "ch-carousel" }],
    });
    const paperclip = makePaperclip([makeIssue()], [makeInteraction()]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    expect(postEmbedToChannel).toHaveBeenCalledWith(
      {},
      "ch-carousel",
      expect.objectContaining({ title: expect.stringContaining("Awaiting confirmation") }),
    );
  });

  it("posts detailsMarkdown body text (minus image lines) after the embed", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      c1: [{ titleRegex: "Carousel", channelId: "ch-carousel" }],
    });
    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({
        payload: {
          detailsMarkdown: "![preview](https://example.com/img.png)\n\nPlease review the carousel content.",
        },
      })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const calls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    // postToChannel signature: (client, channelId, msg)
    expect(calls.some(([, , msg]) => (msg as string).includes("Please review the carousel content."))).toBe(true);
    // Image line itself should NOT appear in body text
    expect(calls.some(([, , msg]) => (msg as string).includes("![preview]"))).toBe(false);
  });

  it("sets the embed image from the first ![...](url) in detailsMarkdown", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      c1: [{ titleRegex: "Carousel", channelId: "ch-carousel" }],
    });
    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({
        payload: { detailsMarkdown: "![slide1](https://r2.example.com/slide1.jpg)\n\nBody text here." },
      })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const calls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][2].image?.url).toBe("https://r2.example.com/slide1.jpg");
  });

  it("does NOT post for a non-pending (accepted) interaction", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      c1: [{ titleRegex: "Carousel", channelId: "ch-carousel" }],
    });
    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "accepted" })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("does NOT post for an interaction whose kind is not request_confirmation", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      c1: [{ titleRegex: "Carousel", channelId: "ch-carousel" }],
    });
    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ kind: "suggest_tasks" })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("does NOT re-post within 24h per interaction", async () => {
    const { runConfirmationSweep, CONFIRMATION_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      c1: [{ titleRegex: "Carousel", channelId: "ch-carousel" }],
    });
    const paperclip = makePaperclip([makeIssue()], [makeInteraction()]);

    // Seed: posted 2h ago
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CONFIRMATION_SWEEP_STATE_KEY },
      { "int-1": new Date(Date.now() - 2 * 3_600_000).toISOString() },
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("re-posts after 24h has elapsed", async () => {
    const { runConfirmationSweep, CONFIRMATION_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      c1: [{ titleRegex: "Carousel", channelId: "ch-carousel" }],
    });
    const paperclip = makePaperclip([makeIssue()], [makeInteraction()]);

    // Seed: posted 25h ago (>24h)
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CONFIRMATION_SWEEP_STATE_KEY },
      { "int-1": new Date(Date.now() - 25 * 3_600_000).toISOString() },
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
  });

  it("does NOT post when issue title does not match titleRegex", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      c1: [{ titleRegex: "Carousel", channelId: "ch-carousel" }],
    });
    const paperclip = makePaperclip(
      [makeIssue({ title: "Budget proposal Q3" })],
      [makeInteraction()],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("is a no-op when confirmationSweep config is absent", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig(undefined);  // no confirmationSweep
    const paperclip = makePaperclip([makeIssue()], [makeInteraction()]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    expect(postEmbedToChannel).not.toHaveBeenCalled();
  });

  it("persists the posted timestamp in state after posting", async () => {
    const { runConfirmationSweep, CONFIRMATION_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");

    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      c1: [{ titleRegex: "Carousel", channelId: "ch-carousel" }],
    });
    const paperclip = makePaperclip([makeIssue()], [makeInteraction()]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    const state = await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CONFIRMATION_SWEEP_STATE_KEY,
    }) as Record<string, string>;
    expect(state["int-1"]).toBeDefined();
    expect(new Date(state["int-1"]).getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
