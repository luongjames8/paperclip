/**
 * Tests for the carousel-batch review surface: every slide rendered +
 * accept/reject buttons on the trailer message, with resume-not-repost
 * idempotency keyed on the interaction's detailsMarkdown hash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PaperclipClient, PaperclipIssue, PaperclipInteraction } from "../src/api/paperclip.js";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-1"),
  postEmbedsToChannel: vi.fn().mockResolvedValue("msg-2"),
  postToChannel: vi.fn().mockResolvedValue("msg-3"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-4"),
  postToThread: vi.fn().mockResolvedValue("msg-5"),
  editMessageInChannel: vi.fn().mockResolvedValue(undefined),
}));

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

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
    getOpenIssues: vi.fn().mockResolvedValue(issues),
    listIssueInteractions: vi.fn().mockResolvedValue(interactions),
  } as unknown as PaperclipClient;
}

const SLUGS = ["tokyo-by-car-guide", "shibuya-crossing-tips", "osaka-food-tour", "kyoto-temple-walk", "hokkaido-winter-guide", "okinawa-beach-days"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildSection(index: number, imageCount: number, slugOverride?: string): string {
  const slug = slugOverride ?? SLUGS[(index - 1) % SLUGS.length];
  const day = DAYS[(index - 1) % DAYS.length];
  const images = Array.from({ length: imageCount }, (_, i) => `![slide${i + 1}](https://r2.example.com/${slug}/${index}-slide-${i + 1}.jpg)`).join("\n");
  return `**${index}. ${slug} (${day})**\n${images}\n\nCaption for section ${index}.\n`;
}

function buildBatch(sectionSlideCounts: number[]): string {
  return sectionSlideCounts.map((count, i) => buildSection(i + 1, count)).join("\n");
}

const CONFIG = makeConfig({ c1: [{ titleRegex: "Carousel", channelId: "ch-carousel" }] });

describe("runConfirmationSweep — carousel-batch shape detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("takes the carousel-batch path (not the generic single-embed path) when detailsMarkdown has section headings", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel, postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([3, 3]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // Generic path's single postEmbedToChannel (first-image embed) must NOT fire.
    expect(postEmbedToChannel).not.toHaveBeenCalled();
    // Carousel path uses postEmbedsToChannel (slide embeds + trailer) and postToChannel (header + captions).
    expect(postEmbedsToChannel).toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalled();
  });

  it("generic (non-carousel-batch) interactions still take the OLD path unchanged", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel, postEmbedsToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const paperclip = makePaperclip([makeIssue()], [makeInteraction()]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
    expect(postEmbedsToChannel).not.toHaveBeenCalled();
  });

  // ─── THE MIGRATION PIN (codex round-3 P2, PR #27) ────────────────────────
  //
  // Deploy-day exact case: an interaction the OLD generic sweep already
  // rendered as a 1-of-N generic card (< 24h ago — so it carries a fresh
  // `posted` marker) but has NO carousel state yet (never seen by the new
  // path). Carousel-shape detection MUST run before the generic throttle
  // check consults that marker, or the interaction is stuck behind the
  // generic path for up to 24h despite being carousel-shaped.
  it("pending carousel interaction with a fresh generic 'posted' marker and NO carousel state → carousel path posts fully (deploy-day migration case)", async () => {
    const { runConfirmationSweep, CONFIRMATION_SWEEP_STATE_KEY, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel, postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([3, 3]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    // Seed: the OLD generic sweep already posted this interactionId 2h ago —
    // well within the 24h throttle window.
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CONFIRMATION_SWEEP_STATE_KEY },
      { "int-1": new Date(Date.now() - 2 * 3_600_000).toISOString() },
    );
    // No pre-existing carousel state — this is the FIRST time the new sweep
    // sees this interaction.
    const carouselStateBefore = await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    });
    expect(carouselStateBefore).toBeNull();

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // Carousel path fired fully — NOT blocked by the generic throttle.
    expect(postEmbedToChannel).not.toHaveBeenCalled();
    expect(postEmbedsToChannel).toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalled();

    const carouselStateAfter = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(carouselStateAfter["int-1"].headerPosted).toBe(true);
    expect(carouselStateAfter["int-1"].trailerPosted).toBe(true);
    expect(carouselStateAfter["int-1"].sectionsPosted).toBe(2);
  });

  it("posts a header message with week/batch title, carousel count, total image count, and paperclip link", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const calls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const header = calls[0][2] as string;
    expect(header).toContain("2 carousel");
    expect(header).toContain("4 image");
    expect(header).toContain("tc1/issues/ISS-1");
  });

  it("emits the cap-fallback warning line in the header when wasCapFallback is true", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const degradedSection = (i: number) =>
      `**${i}. ${SLUGS[i - 1]} (${DAYS[i - 1]})**\n![first](https://r2.example.com/${SLUGS[i - 1]}/slide-1.jpg)\n\nFull set: https://r2.example.com/${SLUGS[i - 1]}/slide-2.jpg\n`;
    const markdown = [degradedSection(1), degradedSection(2)].join("\n");
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const calls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const header = calls[0][2] as string;
    expect(header).toContain("20000-char cap");
    expect(header).toContain("FIRST SLIDE ONLY");
  });

  it("does NOT emit the cap-fallback warning when wasCapFallback is false", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([3, 3]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const calls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const header = calls[0][2] as string;
    expect(header).not.toContain("20000-char cap");
  });

  it("posts a trailer message with decision buttons (accept/reject action row) exactly once", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const calls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
    // Trailer call is the one WITH components (4th positional arg).
    const trailerCalls = calls.filter(([, , , components]) => components !== undefined);
    expect(trailerCalls).toHaveLength(1);
    const row = trailerCalls[0][3][0];
    const customIds = row.components.map((c: any) => c.custom_id);
    // New versioned prefixes carry a hash8 token: car-ok:<hash8>:issueId:interactionId.
    expect(customIds.some((id: string) => id.startsWith("car-ok:"))).toBe(true);
    expect(customIds.some((id: string) => id.startsWith("car-no:"))).toBe(true);
  });
});

describe("runConfirmationSweep — carousel-batch CLASS-CLOSER: no image silently dropped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // For batches of 1, 9, 10, 11, 14 sections (mixed slide counts incl. an
  // >30 outlier): sum of image embeds across all messages per section ===
  // section.slideUrls.length, OR an explicit "+N more slides not shown"
  // marker is present — never neither.
  const scenarios: Array<{ name: string; slideCounts: number[] }> = [
    { name: "1 section", slideCounts: [9] },
    { name: "9 sections", slideCounts: Array.from({ length: 9 }, (_, i) => (i % 4) + 1) },
    { name: "10 sections", slideCounts: Array.from({ length: 10 }, (_, i) => (i % 5) + 1) },
    { name: "11 sections incl. >30 outlier", slideCounts: [...Array.from({ length: 10 }, (_, i) => (i % 4) + 1), 35] },
    { name: "14 sections incl. >30 outlier", slideCounts: [...Array.from({ length: 13 }, (_, i) => (i % 6) + 1), 42] },
  ];

  for (const { name, slideCounts } of scenarios) {
    it(`${name}: every image accounted for (rendered OR elided-with-marker)`, async () => {
      const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
      const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

      const harness = createTestHarness({ manifest });
      const markdown = buildBatch(slideCounts);
      const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

      await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

      const embedCalls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
      const textCalls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;

      // Slide-embed-bearing calls are the ones WITHOUT components (trailer has components).
      const slideEmbedCalls = embedCalls.filter(([, , , components]) => components === undefined);
      const allPostedEmbeds = slideEmbedCalls.flatMap(([, , embeds]) => embeds as unknown[]);

      slideCounts.forEach((expectedCount, i) => {
        const sectionIndex = i + 1;
        const cappedExpected = Math.min(expectedCount, 30);
        // Caption message for this section carries the "+N more" marker when elided.
        const captionCall = textCalls.find(([, , msg]) => (msg as string).startsWith(`**${sectionIndex}.`));
        expect(captionCall).toBeDefined();
        const captionText = captionCall![2] as string;
        const hasElisionMarker = /\+\d+ more slides not shown/.test(captionText);

        if (expectedCount > 30) {
          expect(hasElisionMarker).toBe(true);
          const match = /\+(\d+) more slides not shown/.exec(captionText)!;
          expect(Number(match[1])).toBe(expectedCount - 30);
        } else {
          expect(hasElisionMarker).toBe(false);
        }
      });

      // Total rendered embeds across all sections === sum of capped counts.
      const totalCapped = slideCounts.reduce((sum, c) => sum + Math.min(c, 30), 0);
      expect(allPostedEmbeds.length).toBe(totalCapped);
    });
  }
});

describe("runConfirmationSweep — carousel-batch idempotent resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resumes from sectionsPosted=3 of 6 — next tick posts only sections 4-6", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2, 2, 2, 2, 2]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    // Pre-populate state: header posted, 3 of 6 sections posted, trailer not yet posted.
    // Hash matches sweep's own trim() of detailsMarkdown before hashing.
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 3,
          totalSections: 6,
          artifactHash: sha256(markdown.trim()),
          headerPosted: true,
          trailerPosted: false,
        },
      },
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // Header should NOT be re-posted (only caption text calls for sections 4-6 + trailer's embed call).
    const textCalls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const headerCalls = textCalls.filter(([, , msg]) => (msg as string).includes("Carousel batch awaiting confirmation"));
    expect(headerCalls).toHaveLength(0);

    // Only sections 4, 5, 6 caption messages posted (not 1, 2, 3).
    const captionCalls = textCalls.filter(([, , msg]) => /^\*\*\d+\./.test(msg as string));
    expect(captionCalls).toHaveLength(3);
    const postedIndices = captionCalls.map(([, , msg]) => Number(/^\*\*(\d+)\./.exec(msg as string)![1]));
    expect(postedIndices.sort()).toEqual([4, 5, 6]);

    // Trailer posted (with components).
    const embedCalls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const trailerCalls = embedCalls.filter(([, , , components]) => components !== undefined);
    expect(trailerCalls).toHaveLength(1);

    // Final state fully posted.
    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].sectionsPosted).toBe(6);
    expect(finalState["int-1"].trailerPosted).toBe(true);
  });

  it("skips entirely when fully posted AND hash unchanged", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 2,
          totalSections: 2,
          artifactHash: sha256(markdown.trim()),
          headerPosted: true,
          trailerPosted: true,
        },
      },
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).not.toHaveBeenCalled();
  });

  it("fully-posted + unchanged-hash tick performs NO parse (fast path — no wasted regex/hash/parse work)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const carouselBatchModule = await import("../src/render/carousel-batch.js");
    const parseSpy = vi.spyOn(carouselBatchModule, "parseCarouselBatchMarkdown");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 2,
          totalSections: 2,
          artifactHash: sha256(markdown.trim()),
          headerPosted: true,
          trailerPosted: true,
        },
      },
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(parseSpy).not.toHaveBeenCalled();
    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it("trailer-only resume (all sections posted, trailer missing) posts exactly one message and does NOT re-parse", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const carouselBatchModule = await import("../src/render/carousel-batch.js");
    const parseSpy = vi.spyOn(carouselBatchModule, "parseCarouselBatchMarkdown");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 2,
          totalSections: 2,
          artifactHash: sha256(markdown.trim()),
          headerPosted: true,
          trailerPosted: false,
        },
      },
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(parseSpy).not.toHaveBeenCalled();
    // Exactly one message posted: the trailer (postEmbedsToChannel call WITH components).
    expect(postToChannel).not.toHaveBeenCalled();
    const embedCalls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
    expect(embedCalls).toHaveLength(1);
    const trailerCalls = embedCalls.filter(([, , , components]) => components !== undefined);
    expect(trailerCalls).toHaveLength(1);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].trailerPosted).toBe(true);
    parseSpy.mockRestore();
  });

  it("partial failure (a section embed post throws) persists progress up to the last successful section, not beyond", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2, 2]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    // Fail on the 2nd section's embed post (2nd call to postEmbedsToChannel without components — 1st is section 1).
    let slideEmbedCallCount = 0;
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockImplementation(async (_client, _channelId, _embeds, components) => {
      if (components === undefined) {
        slideEmbedCallCount++;
        if (slideEmbedCallCount === 2) throw new Error("simulated Discord outage");
      }
      return "msg-x";
    });

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].sectionsPosted).toBe(1);
    expect(finalState["int-1"].trailerPosted).toBe(false);
  });
});

describe("runConfirmationSweep — carousel-batch artifact-hash invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("same interactionId, changed detailsMarkdown → full re-post", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
    const newMarkdown = buildBatch([3, 3, 3]); // revised batch — different section count too

    // Pre-populate state as fully posted under the OLD hash.
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 2,
          totalSections: 2,
          artifactHash: sha256(oldMarkdown.trim()),
          headerPosted: true,
          trailerPosted: true,
        },
      },
    );

    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: newMarkdown } })]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // Header re-posted.
    const textCalls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const headerCalls = textCalls.filter(([, , msg]) => (msg as string).includes("Carousel batch awaiting confirmation"));
    expect(headerCalls).toHaveLength(1);

    // All 3 sections' captions posted (full re-post, not resume from 2).
    const captionCalls = textCalls.filter(([, , msg]) => /^\*\*\d+\./.test(msg as string));
    expect(captionCalls).toHaveLength(3);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].totalSections).toBe(3);
    expect(finalState["int-1"].artifactHash).toBe(sha256(newMarkdown.trim()));
    expect(finalState["int-1"].sectionsPosted).toBe(3);
  });

  it("trailer's posted messageId is persisted in state (needed to disable it on a later re-post)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockImplementation(
      async (_client: unknown, _channelId: string, _embeds: unknown, components?: unknown) =>
        components !== undefined ? "trailer-msg-id-123" : "slide-msg-id",
    );

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].trailerMessageId).toBe("trailer-msg-id-123");
  });
});

// ─── Best-effort old-trailer disable on hashChanged re-post (FIX (b), codex round 3, PR #27) ───

describe("runConfirmationSweep — hashChanged re-post attempts to disable the PREVIOUS trailer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls editMessageInChannel for the old trailerMessageId, stripping components + annotating", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
    const newMarkdown = buildBatch([3, 3, 3]);

    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 2,
          totalSections: 2,
          artifactHash: sha256(oldMarkdown.trim()),
          headerPosted: true,
          trailerPosted: true,
          trailerMessageId: "old-trailer-msg-id",
        },
      },
    );

    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: newMarkdown } })]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, channelId, messageId, opts] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("ch-carousel");
    expect(messageId).toBe("old-trailer-msg-id");
    expect(opts.components).toEqual([]);
  });

  it("tolerates editMessageInChannel throwing (Discord API failure) — re-post proceeds to completion regardless", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel, postToChannel } = await import("../src/discord/rest.js");
    (editMessageInChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("message not found: old-trailer-msg-id"));

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
    const newMarkdown = buildBatch([3, 3, 3]);

    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 2,
          totalSections: 2,
          artifactHash: sha256(oldMarkdown.trim()),
          headerPosted: true,
          trailerPosted: true,
          trailerMessageId: "old-trailer-msg-id",
        },
      },
    );

    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: newMarkdown } })]);
    await expect(
      runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip),
    ).resolves.not.toThrow();

    // The full re-post still completes (header re-posted) despite the edit failure.
    const textCalls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const headerCalls = textCalls.filter(([, , msg]) => (msg as string).includes("Carousel batch awaiting confirmation"));
    expect(headerCalls).toHaveLength(1);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].sectionsPosted).toBe(3);
  });

  it("no trailerMessageId on the existing record (older pre-field state) → does NOT call editMessageInChannel, proceeds normally", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
    const newMarkdown = buildBatch([3, 3, 3]);

    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 2,
          totalSections: 2,
          artifactHash: sha256(oldMarkdown.trim()),
          headerPosted: true,
          trailerPosted: true,
          // no trailerMessageId
        },
      },
    );

    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: newMarkdown } })]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).not.toHaveBeenCalled();
  });
});
