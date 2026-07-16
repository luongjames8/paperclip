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
import type { CarouselBatchPayload } from "../src/render/carousel-batch.js";

vi.mock("../src/discord/rest.js", () => ({
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-1"),
  postEmbedsToChannel: vi.fn().mockResolvedValue("msg-2"),
  postToChannel: vi.fn().mockResolvedValue("msg-3"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-4"),
  postToThread: vi.fn().mockResolvedValue("msg-5"),
  editMessageInChannel: vi.fn().mockResolvedValue(undefined),
  findRecentMessageWithCustomId: vi.fn().mockResolvedValue(null),
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

  // ─── STALENESS GATE (finding 5): a cheap interaction.updatedAt comparison
  // short-circuits the ENTIRE parse+hash path — not just the parse, but also
  // JSON.stringify(structuredPayload)/sha256 — for a fully-posted record when
  // nothing changed server-side between ticks ─────────────────────────────
  it("second tick with UNCHANGED interaction.updatedAt on a fully-posted record performs NO re-post and NO parse work (staleness gate)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    const carouselBatchModule = await import("../src/render/carousel-batch.js");
    const parseMarkdownSpy = vi.spyOn(carouselBatchModule, "parseCarouselBatchMarkdown");
    const parsePayloadSpy = vi.spyOn(carouselBatchModule, "parseCarouselBatchPayload");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const fixedUpdatedAt = "2026-07-11T00:00:00.000Z";
    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ updatedAt: fixedUpdatedAt, payload: { detailsMarkdown: markdown } })],
    );

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
          lastSeenUpdatedAt: fixedUpdatedAt,
        },
      },
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // The staleness gate fires BEFORE detection even runs — neither parser is
    // ever invoked (proxy evidence that the JSON.stringify+sha256 work that
    // would otherwise follow parsing never runs either).
    expect(parseMarkdownSpy).not.toHaveBeenCalled();
    expect(parsePayloadSpy).not.toHaveBeenCalled();
    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).not.toHaveBeenCalled();

    parseMarkdownSpy.mockRestore();
    parsePayloadSpy.mockRestore();
  });

  it("second tick with a CHANGED interaction.updatedAt on a fully-posted record still enters postCarouselBatch (outer gate does not skip), refreshing lastSeenUpdatedAt without re-posting", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ updatedAt: "2026-07-11T05:00:00.000Z", payload: { detailsMarkdown: markdown } })],
    );

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
          lastSeenUpdatedAt: "2026-07-11T00:00:00.000Z", // stale — different from interaction.updatedAt
        },
      },
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // updatedAt moved → the OUTER staleness gate does not skip; control
    // reaches postCarouselBatch, whose OWN hash-based fast path (artifact
    // content unchanged) still avoids any re-post — but it now stamps the
    // fresh updatedAt onto the record so a THIRD tick with this same
    // updatedAt would be gated again.
    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).not.toHaveBeenCalled();

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].lastSeenUpdatedAt).toBe("2026-07-11T05:00:00.000Z");
  });

  it("first tick ever (no existing record) always runs the full path regardless of updatedAt", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(postEmbedsToChannel).toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalled();

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].lastSeenUpdatedAt).toBeDefined();
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

// ─── STRUCTURED PAYLOAD CONTRACT (kills the "regex-on-LLM-prose" failure
// class — 2026-07-11 live incident: the publisher wrote `## akihabara (Sat)`
// instead of `**1. akihabara (Sat)**`, SECTION_HEADING_RE missed it, and the
// sweep fell to the generic image-stripping path) ───────────────────────────

function buildStructuredPayload(overrides: Partial<CarouselBatchPayload> = {}): CarouselBatchPayload {
  return {
    version: 1,
    weekOf: "2026-07-13",
    cadence: { days: ["Sat", "Sun"], held: 0, strays: 0 },
    items: [
      { slug: "akihabara", day: "Sat", caption: "Electric town.", slides: ["https://r2.example.com/akihabara/1.jpg", "https://r2.example.com/akihabara/2.jpg"] },
      { slug: "shibuya", day: "Sun", caption: "Crossing.", slides: ["https://r2.example.com/shibuya/1.jpg"] },
    ],
    ...overrides,
  };
}

describe("runConfirmationSweep — STRUCTURED PAYLOAD CONTRACT (version 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("payload.carouselBatch.version===1 renders from DATA — never touches detailsMarkdown's regex shape at all", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const payload = buildStructuredPayload();
    // detailsMarkdown deliberately uses the WRONG (unnumbered `##`) heading
    // shape that broke detection live — proves detection never depends on it
    // when the structured field is present.
    const interaction = makeInteraction({
      payload: {
        detailsMarkdown: "## akihabara (Sat)\n![x](https://r2.example.com/akihabara/1.jpg)\n\nElectric town.",
        carouselBatch: payload,
      },
    });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(postEmbedsToChannel).toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalled();
    const textCalls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const header = textCalls.find(([, , msg]) => (msg as string).includes("Carousel batch awaiting confirmation"))?.[2] as string;
    expect(header).toContain("2 carousel");
    expect(header).toContain("3 image"); // 2 + 1 slides across the two items
    // Every slide URL from BOTH items rendered as an embed (nothing dropped).
    const embedCalls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const slideEmbedCalls = embedCalls.filter(([, , , components]) => components === undefined);
    const allImageUrls = slideEmbedCalls.flatMap(([, , embeds]) => (embeds as any[]).map((e) => e.image?.url));
    expect(allImageUrls).toEqual(
      expect.arrayContaining(["https://r2.example.com/akihabara/1.jpg", "https://r2.example.com/akihabara/2.jpg", "https://r2.example.com/shibuya/1.jpg"]),
    );
  });

  it("structured payload takes priority over a legacy-shaped detailsMarkdown (both present) — structured wins", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    // Legacy-shaped markdown would parse to a DIFFERENT single-item batch —
    // if structured detection didn't take priority, this test would see 1
    // section (from markdown) instead of 2 (from the structured payload).
    const legacyMarkdown = buildBatch([4]);
    const payload = buildStructuredPayload();
    const interaction = makeInteraction({ payload: { detailsMarkdown: legacyMarkdown, carouselBatch: payload } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const embedCalls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const slideEmbedCalls = embedCalls.filter(([, , , components]) => components === undefined);
    const allImageUrls = slideEmbedCalls.flatMap(([, , embeds]) => (embeds as any[]).map((e) => e.image?.url));
    // Structured payload's 3 slides, not legacy's 4.
    expect(allImageUrls).toHaveLength(3);
  });

  it("trailer buttons carry the structured-payload's hash — accept/reject action row present exactly once", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: buildStructuredPayload() } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const calls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const trailerCalls = calls.filter(([, , , components]) => components !== undefined);
    expect(trailerCalls).toHaveLength(1);
    const row = trailerCalls[0][3][0];
    const customIds = row.components.map((c: any) => c.custom_id);
    expect(customIds.some((id: string) => id.startsWith("car-ok:"))).toBe(true);
    expect(customIds.some((id: string) => id.startsWith("car-no:"))).toBe(true);
  });

  it("anchor embed shows the 🟡 awaiting-decision status line (shared buildCarouselAnchorEmbed contract)", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: buildStructuredPayload() } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const calls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const trailerCall = calls.find(([, , , components]) => components !== undefined);
    const anchorEmbed = trailerCall![2][0];
    expect(anchorEmbed.description).toMatch(/🟡 awaiting decision/);
  });

  it("0-item structured payload (batch held everything over) → skips posting entirely, no header/trailer, interaction stays pending", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).not.toHaveBeenCalled();
    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].totalSections).toBe(0);
    expect(finalState["int-1"].headerPosted).toBe(false);
  });

  it("malformed carouselBatch (wrong version, missing fields) degrades to null — falls through to legacy/generic detection, never throws", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const interaction = makeInteraction({
      payload: { detailsMarkdown: "Please review.", carouselBatch: { version: 2, items: "not-an-array" } },
    });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    await expect(runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip)).resolves.not.toThrow();
    // Falls through to the generic path (detailsMarkdown has no carousel shape).
    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
  });
});

// ─── UNSTRUCTURED DEGRADE (kills failure 2's blind spot): neither the
// structured contract NOR the legacy heading regex matched, but the MATCHING
// rule is flagged carouselBatch:true → render with images intact + a loud
// warning, NEVER the generic stripImageLines path ───────────────────────────

function makeCarouselTitledIssue(overrides: Partial<PaperclipIssue> = {}): PaperclipIssue {
  return makeIssue({ title: "Publisher (Carousel) — wk-2026-07-13", ...overrides });
}

const CAROUSEL_TITLE_CONFIG = makeConfig({ c1: [{ titleRegex: "Publisher \\(Carousel\\)", channelId: "ch-carousel", carouselBatch: true }] });

describe("runConfirmationSweep — unstructured-degrade (carousel-titled issue, unparseable shape)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("LLM wrote `## slug (Day)` instead of `**N. slug (Day)**` — degrades to images-intact render with a loud warning, NEVER stripImageLines", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const brokenMarkdown = [
      "## akihabara (Sat)",
      "![slide-01](https://pub-example.r2.dev/akihabara/1.jpg)",
      "![slide-02](https://pub-example.r2.dev/akihabara/2.jpg)",
      "",
      "Electric town vibes.",
      "",
      "Key: slug=akihabara weekOf=2026-07-13 plannedDay=Sat",
      "Cadence: Sat+Sun (2 slots) | Strays: 0 | Held: 0",
    ].join("\n");
    const interaction = makeInteraction({ payload: { detailsMarkdown: brokenMarkdown } });
    const paperclip = makePaperclip([makeCarouselTitledIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CAROUSEL_TITLE_CONFIG, async () => paperclip);

    // NEVER the generic (image-stripping) path.
    expect(postEmbedToChannel).not.toHaveBeenCalled();
    // Both slide images rendered as embeds — nothing dropped.
    expect(postEmbedsToChannel).toHaveBeenCalled();
    const embedCalls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const slideEmbedCalls = embedCalls.filter(([, , , components]) => components === undefined);
    const allImageUrls = slideEmbedCalls.flatMap(([, , embeds]) => (embeds as any[]).map((e) => e.image?.url));
    expect(allImageUrls).toEqual(
      expect.arrayContaining(["https://pub-example.r2.dev/akihabara/1.jpg", "https://pub-example.r2.dev/akihabara/2.jpg"]),
    );
    // Loud warning present in the caption text.
    const textCalls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const captionCall = textCalls.find(([, , msg]) => (msg as string).includes("unstructured artifact"));
    expect(captionCall).toBeDefined();
    expect(captionCall![2] as string).toMatch(/⚠ unstructured artifact/);
    // Non-image text (key/cadence lines, caption) preserved, not dropped.
    expect(captionCall![2] as string).toContain("Electric town vibes.");
  });

  it("still posts a trailer with accept/reject buttons — a contract miss doesn't remove the operator's ability to decide", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const brokenMarkdown = "## akihabara (Sat)\n![x](https://r2.example.com/1.jpg)\n\nCaption.";
    const interaction = makeInteraction({ payload: { detailsMarkdown: brokenMarkdown } });
    const paperclip = makePaperclip([makeCarouselTitledIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CAROUSEL_TITLE_CONFIG, async () => paperclip);

    const calls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const trailerCalls = calls.filter(([, , , components]) => components !== undefined);
    expect(trailerCalls).toHaveLength(1);
    const row = trailerCalls[0][3][0];
    const customIds = row.components.map((c: any) => c.custom_id);
    expect(customIds.some((id: string) => id.startsWith("car-ok:"))).toBe(true);
    expect(customIds.some((id: string) => id.startsWith("car-no:"))).toBe(true);
  });

  it("a NON-carousel-titled issue with the same broken markdown shape falls to the generic (image-stripping) path unchanged — degrade is scoped to carousel-titled issues only", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel, postEmbedsToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const brokenMarkdown = "## akihabara (Sat)\n![x](https://r2.example.com/1.jpg)\n\nCaption.";
    const nonCarouselConfig = makeConfig({ c1: [{ titleRegex: ".*", channelId: "ch-generic" }] });
    const interaction = makeInteraction({ payload: { detailsMarkdown: brokenMarkdown } });
    const paperclip = makePaperclip([makeIssue({ title: "Some other confirmation" })], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), nonCarouselConfig, async () => paperclip);

    expect(postEmbedToChannel).toHaveBeenCalledTimes(1);
    expect(postEmbedsToChannel).not.toHaveBeenCalled();
  });

  it("idempotent resume: a partial degrade-render failure persists progress and resumes next sweep (reuses postCarouselBatch's existing resume machinery)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("simulated Discord outage"));

    const harness = createTestHarness({ manifest });
    const brokenMarkdown = "## akihabara (Sat)\n![x](https://r2.example.com/1.jpg)\n\nCaption.";
    const interaction = makeInteraction({ payload: { detailsMarkdown: brokenMarkdown } });
    const paperclip = makePaperclip([makeCarouselTitledIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CAROUSEL_TITLE_CONFIG, async () => paperclip);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    // Header posted, section embed failed — sectionsPosted stays 0, trailer not posted.
    expect(finalState["int-1"].headerPosted).toBe(true);
    expect(finalState["int-1"].sectionsPosted).toBe(0);
    expect(finalState["int-1"].trailerPosted).toBe(false);
  });

  it("previously-structured card revised to garbage markdown + no structured payload → degrade render posted, old anchor superseded (codex P2, confirmation-sweep.ts:691)", async () => {
    // Regression for: knownCarousel forced the legacy parser even when the
    // CURRENT detailsMarkdown no longer matches SECTION_HEADING_RE. Before
    // the fix, this revision would parse zero legacy sections, postCarouselBatch
    // would skip posting, and the operator would see nothing — the
    // unstructured-degrade path below was never reached despite
    // rule.carouselBatch being true.
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel, postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);

    // Prior generation: a fully-posted STRUCTURED carousel (knownCarousel === true).
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
          trailerMessageId: "old-anchor-id",
          anchorMessageId: "old-anchor-id",
          lastRenderedStatus: "awaiting",
        },
      },
    );

    // Revision REMOVES the structured payload entirely and rewrites
    // detailsMarkdown to a shape that no longer matches SECTION_HEADING_RE.
    const brokenMarkdown = "## akihabara (Sat)\n![x](https://r2.example.com/1.jpg)\n\nCaption.";
    const interaction = makeInteraction({ payload: { detailsMarkdown: brokenMarkdown } });
    const paperclip = makePaperclip([makeCarouselTitledIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CAROUSEL_TITLE_CONFIG, async () => paperclip);

    // The old anchor is superseded, not left dangling with live buttons.
    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, channelId, messageId, opts] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("ch-carousel");
    expect(messageId).toBe("old-anchor-id");
    expect(opts.embeds[0].description).toMatch(/⏰ superseded/);

    // The degrade render actually posts — images intact, loud warning present —
    // instead of silently skipping (the zero-legacy-sections bug this test guards).
    expect(postEmbedsToChannel).toHaveBeenCalled();
    const textCalls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const captionCall = textCalls.find(([, , msg]) => (msg as string).includes("unstructured artifact"));
    expect(captionCall).toBeDefined();

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].headerPosted).toBe(true);
    expect(finalState["int-1"].totalSections).toBe(1);
  });
});

// ─── ANCHOR STATUS TRANSITIONS (kills "stacked generations" — 2026-07-11 live
// incident: partial + full renders of the same week both sitting in the
// channel with nothing marking which was current) ───────────────────────────

describe("runConfirmationSweep — anchor status transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("superseded edit uses the SHARED anchor embed contract (buildCarouselAnchorEmbed) — same shape as accepted/rejected", async () => {
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
          trailerMessageId: "old-anchor-id",
          anchorMessageId: "old-anchor-id",
          lastRenderedStatus: "awaiting",
        },
      },
    );

    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: newMarkdown } })]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, , messageId, opts] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(messageId).toBe("old-anchor-id");
    expect(opts.embeds[0].description).toMatch(/⏰ superseded/);
    expect(opts.components).toEqual([]);
  });

  it("falls back to trailerMessageId when anchorMessageId is absent (pre-migration record)", async () => {
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
          trailerMessageId: "legacy-trailer-id",
          // no anchorMessageId — pre-migration record
        },
      },
    );

    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: newMarkdown } })]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, , messageId] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(messageId).toBe("legacy-trailer-id");
  });

  it("new trailer post sets BOTH trailerMessageId and anchorMessageId to the same value, and lastRenderedStatus to 'awaiting'", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ payload: { detailsMarkdown: markdown } })]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].anchorMessageId).toBeDefined();
    expect(finalState["int-1"].anchorMessageId).toBe(finalState["int-1"].trailerMessageId);
    expect(finalState["int-1"].lastRenderedStatus).toBe("awaiting");
  });
});

// ─── ZERO-ITEM REVISION SUPERSEDE (codex P2): a previously-posted (non-empty)
// carousel-batch generation revised down to items: [] must supersede its OLD
// anchor before taking the zero-section early return — otherwise the anchor
// is left showing "🟡 awaiting decision" with live buttons for a generation
// that no longer exists ───────────────────────────────────────────────────

describe("runConfirmationSweep — zero-item revision supersedes the previous anchor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previously-posted card revised to items:[] → old anchor edited to superseded exactly once, buttons stripped, no re-post", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel, postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);

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
          trailerMessageId: "old-anchor-id",
          anchorMessageId: "old-anchor-id",
          lastRenderedStatus: "awaiting",
        },
      },
    );

    // Revised down to zero items via the structured payload.
    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // Old anchor superseded — no re-post of header/sections/trailer.
    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, channelId, messageId, opts] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("ch-carousel");
    expect(messageId).toBe("old-anchor-id");
    expect(opts.embeds[0].description).toMatch(/⏰ superseded/);
    expect(opts.components).toEqual([]);
    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    expect(postToChannel).not.toHaveBeenCalled();

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].totalSections).toBe(0);
    expect(finalState["int-1"].headerPosted).toBe(false);
    // The successor record carries NO anchor pointer — a zero-item generation
    // posts nothing, so it HAS no current anchor. The retired old card must
    // never be reachable by the resolved-reconcile pass (codex round-6 P2:
    // it used to be repainted accepted/rejected, undoing the superseded
    // marker on an obsolete batch).
    expect(finalState["int-1"].anchorMessageId).toBeUndefined();
    expect(finalState["int-1"].trailerMessageId).toBeUndefined();
    expect(finalState["int-1"].lastRenderedStatus).toBeUndefined();
    // Edit landed — nothing parked for retry.
    expect(finalState["int-1"].staleAnchors).toBeUndefined();
  });

  it("second tick (same zero-item hash) is a no-op — does NOT re-edit the anchor", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const { carouselArtifactHash } = await import("../src/render/carousel-batch.js");
    const harness = createTestHarness({ manifest });
    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });
    const zeroHash = carouselArtifactHash(interaction);

    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 0,
          totalSections: 0,
          artifactHash: zeroHash,
          headerPosted: false,
          trailerPosted: false,
          anchorMessageId: "old-anchor-id",
          lastRenderedStatus: "superseded",
        },
      },
    );

    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).not.toHaveBeenCalled();
  });

  it("edit failure on the zero-item supersede path is tolerated (logged, not thrown) — zero-item state stamped AND the failed supersede PARKED in staleAnchors for retry", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");
    (editMessageInChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("message not found: old-anchor-id"));

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);

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
          trailerMessageId: "old-anchor-id",
          anchorMessageId: "old-anchor-id",
          lastRenderedStatus: "awaiting",
        },
      },
    );

    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    await expect(
      runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip),
    ).resolves.not.toThrow();

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].totalSections).toBe(0);
    expect(finalState["int-1"].headerPosted).toBe(false);
    // Edit failed — the old anchor is PARKED for retry (codex round-6 P2:
    // the old code stamped the new hash with the retry gated off forever),
    // and the successor record carries no current-anchor pointer.
    expect(finalState["int-1"].anchorMessageId).toBeUndefined();
    expect(finalState["int-1"].lastRenderedStatus).toBeUndefined();
    expect(finalState["int-1"].staleAnchors).toEqual([{ messageId: "old-anchor-id", channelId: "ch-carousel" }]);
  });

  it("no existing anchor (first-ever tick, zero items from the start) → does NOT call editMessageInChannel", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).not.toHaveBeenCalled();
    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].anchorMessageId).toBeUndefined();
    expect(finalState["int-1"].lastRenderedStatus).toBeUndefined();
  });
});

// ─── RESOLVED-RECONCILE: wires every dead terminal anchor status (expired,
// and — codex round 4 — accepted/rejected/cancelled decided from the
// Paperclip web UI/API rather than a Discord button click). The main sweep
// loop only ever considers status==="pending" interactions, so an
// interaction that leaves "pending" WITHOUT a Discord click would otherwise
// sit with its anchor stuck on "🟡 awaiting decision" WITH LIVE BUTTONS
// forever ───────────────────────────────────────────────────────────────

describe("runConfirmationSweep — resolved-reconcile (non-pending terminal statuses)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("interaction now status='expired' with a posted anchor (lastRenderedStatus='awaiting') → edits the anchor to 'expired' and strips components", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);

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
          trailerMessageId: "anchor-msg-1",
          anchorMessageId: "anchor-msg-1",
          lastRenderedStatus: "awaiting",
        },
      },
    );

    // The interaction now reports status="expired" (paperclip-side expiry) —
    // never went through pendingConfirmations again.
    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "expired", payload: { detailsMarkdown: markdown } })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, channelId, messageId, opts] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("ch-carousel");
    expect(messageId).toBe("anchor-msg-1");
    expect(opts.embeds[0].title).toBe("Expired — no decision in time");
    expect(opts.embeds[0].description).toMatch(/⏰ expired/);
    expect(opts.components).toEqual([]);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].lastRenderedStatus).toBe("expired");
  });

  it("does NOT re-edit the anchor on a second sweep tick once lastRenderedStatus is already 'expired' (idempotent)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);

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
          trailerMessageId: "anchor-msg-1",
          anchorMessageId: "anchor-msg-1",
          lastRenderedStatus: "expired",
        },
      },
    );

    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "expired", payload: { detailsMarkdown: markdown } })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).not.toHaveBeenCalled();
  });

  it("interaction expired but NO carousel-batch record exists for it (never rendered by this sweep) → no-op, no throw", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const paperclip = makePaperclip([makeIssue()], [makeInteraction({ status: "expired" })]);

    await expect(
      runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip),
    ).resolves.not.toThrow();
    expect(editMessageInChannel).not.toHaveBeenCalled();
  });

  // A decision made from the Paperclip web UI/API (not a Discord button
  // click) leaves interaction.status accepted/rejected/cancelled but NEVER
  // touches the Discord anchor — the button handler only renders its own
  // interaction.message reference when the click itself happens in Discord.
  // Without this pass, that anchor sits showing "🟡 awaiting decision" WITH
  // LIVE BUTTONS forever despite the decision already being made elsewhere.
  it("web-accepted interaction → edits the anchor to 'accepted' and strips components", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);

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
          trailerMessageId: "anchor-msg-1",
          anchorMessageId: "anchor-msg-1",
          lastRenderedStatus: "awaiting",
        },
      },
    );

    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "accepted", payload: { detailsMarkdown: markdown } })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, channelId, messageId, opts] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("ch-carousel");
    expect(messageId).toBe("anchor-msg-1");
    expect(opts.embeds[0].title).toBe("Decision: accepted");
    expect(opts.embeds[0].description).toMatch(/✅ accepted/);
    expect(opts.components).toEqual([]);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].lastRenderedStatus).toBe("accepted");
  });

  it("does NOT re-edit the anchor on a second sweep tick once lastRenderedStatus is already 'accepted' (idempotent)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);

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
          trailerMessageId: "anchor-msg-1",
          anchorMessageId: "anchor-msg-1",
          lastRenderedStatus: "accepted",
        },
      },
    );

    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "accepted", payload: { detailsMarkdown: markdown } })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).not.toHaveBeenCalled();
  });

  it("web-rejected interaction → edits the anchor to 'rejected' and strips components", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);

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
          trailerMessageId: "anchor-msg-1",
          anchorMessageId: "anchor-msg-1",
          lastRenderedStatus: "awaiting",
        },
      },
    );

    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "rejected", payload: { detailsMarkdown: markdown } })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, channelId, messageId, opts] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("ch-carousel");
    expect(messageId).toBe("anchor-msg-1");
    expect(opts.embeds[0].title).toBe("Decision: rejected");
    expect(opts.embeds[0].description).toMatch(/❌ rejected/);
    expect(opts.components).toEqual([]);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].lastRenderedStatus).toBe("rejected");
  });

  it("does NOT re-edit the anchor on a second sweep tick once lastRenderedStatus is already 'rejected' (idempotent)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);

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
          trailerMessageId: "anchor-msg-1",
          anchorMessageId: "anchor-msg-1",
          lastRenderedStatus: "rejected",
        },
      },
    );

    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "rejected", payload: { detailsMarkdown: markdown } })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).not.toHaveBeenCalled();
  });

  it("cancelled interaction → edits the anchor to 'cancelled' and strips components", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);

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
          trailerMessageId: "anchor-msg-1",
          anchorMessageId: "anchor-msg-1",
          lastRenderedStatus: "awaiting",
        },
      },
    );

    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "cancelled", payload: { detailsMarkdown: markdown } })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, channelId, messageId, opts] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("ch-carousel");
    expect(messageId).toBe("anchor-msg-1");
    expect(opts.embeds[0].title).toBe("Cancelled");
    expect(opts.embeds[0].description).toMatch(/🚫 cancelled/);
    expect(opts.components).toEqual([]);

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(finalState["int-1"].lastRenderedStatus).toBe("cancelled");
  });

  it("does NOT re-edit the anchor on a second sweep tick once lastRenderedStatus is already 'cancelled' (idempotent)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);

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
          trailerMessageId: "anchor-msg-1",
          anchorMessageId: "anchor-msg-1",
          lastRenderedStatus: "cancelled",
        },
      },
    );

    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "cancelled", payload: { detailsMarkdown: markdown } })],
    );

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).not.toHaveBeenCalled();
  });

  it("editMessageInChannel throwing is tolerated — logged and retried next sweep, does not throw", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");
    (editMessageInChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("message not found"));

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);

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
          trailerMessageId: "anchor-msg-1",
          anchorMessageId: "anchor-msg-1",
          lastRenderedStatus: "awaiting",
        },
      },
    );

    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "expired", payload: { detailsMarkdown: markdown } })],
    );

    await expect(
      runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip),
    ).resolves.not.toThrow();

    const finalState = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    // Not marked expired since the edit failed — next sweep retries.
    expect(finalState["int-1"].lastRenderedStatus).toBe("awaiting");
  });
});

// ─── RETIREMENT QUEUE + ADOPT-DON'T-DUPLICATE (codex round-6 class-closer):
// anchorMessageId only ever points at the CURRENT generation's anchor;
// retired anchors move to staleAnchors and are retried until their
// "superseded" edit lands; ambiguous trailer sends probe-adopt instead of
// double-posting ─────────────────────────────────────────────────────────

describe("runConfirmationSweep — retirement queue (staleAnchors) retried until success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function fullyPostedRecord(markdown: string, overrides: Record<string, unknown> = {}) {
    return {
      postedAt: new Date().toISOString(),
      sectionsPosted: 2,
      totalSections: 2,
      artifactHash: sha256(markdown.trim()),
      headerPosted: true,
      trailerPosted: true,
      trailerMessageId: "old-anchor-id",
      anchorMessageId: "old-anchor-id",
      lastRenderedStatus: "awaiting",
      ...overrides,
    };
  }

  it("zero-item supersede failure is retried on the NEXT tick via the reconcile pass — parked entry cleared once the edit lands", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");
    (editMessageInChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("transient 503"));

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      { "int-1": fullyPostedRecord(oldMarkdown) },
    );

    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    // Tick 1: supersede edit fails → parked.
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);
    let state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].staleAnchors).toEqual([{ messageId: "old-anchor-id", channelId: "ch-carousel" }]);

    // Tick 2: same zero-item hash (the old code would skip forever here) —
    // the reconcile pass retries the parked edit and clears the queue.
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);
    const retryCall = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(retryCall[1]).toBe("ch-carousel");
    expect(retryCall[2]).toBe("old-anchor-id");
    expect(retryCall[3].embeds[0].description).toMatch(/⏰ superseded/);
    expect(retryCall[3].components).toEqual([]);

    state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].staleAnchors).toBeUndefined();
  });

  it("hashChanged supersede failure parks the OLD anchor on the successor record (old code dropped the id entirely) and retries next tick", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel, postEmbedsToChannel } = await import("../src/discord/rest.js");
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockResolvedValue("msg-2");
    (editMessageInChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("transient 503"));

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      { "int-1": fullyPostedRecord(oldMarkdown) },
    );

    // Revision: different legacy markdown → hash change → full re-post.
    const newMarkdown = buildBatch([3, 1]);
    const interaction = makeInteraction({ payload: { detailsMarkdown: newMarkdown } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    // Tick 1: supersede of the old anchor fails → parked; re-post proceeds.
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);
    let state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].staleAnchors).toEqual([{ messageId: "old-anchor-id", channelId: "ch-carousel" }]);
    // The successor record's current anchor is the NEW trailer, not the old one.
    expect(state["int-1"].anchorMessageId).toBe("msg-2");
    expect(state["int-1"].artifactHash).toBe(sha256(newMarkdown.trim()));

    // Tick 2: reconcile pass retries the parked supersede and clears it.
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);
    const retryCall = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(retryCall[2]).toBe("old-anchor-id");
    expect(retryCall[3].embeds[0].description).toMatch(/⏰ superseded/);

    state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].staleAnchors).toBeUndefined();
    expect(state["int-1"].anchorMessageId).toBe("msg-2");
  });

  it("parked supersede is retried even after the interaction leaves 'pending' (web-accepted) — and the retired card is NEVER repainted with the terminal status", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ status: "accepted", payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });
    const { carouselArtifactHash } = await import("../src/render/carousel-batch.js");

    // Zero-item successor record with a still-parked supersede: the pending
    // loop will never see this interaction again (status=accepted), so the
    // reconcile pass is the only thing that can drain the queue.
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 0,
          totalSections: 0,
          artifactHash: carouselArtifactHash(interaction),
          headerPosted: false,
          trailerPosted: false,
          staleAnchors: [{ messageId: "old-anchor-id", channelId: "ch-carousel" }],
        },
      },
    );

    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // Exactly ONE edit: the superseded retry. The accepted status is NOT
    // rendered anywhere — a zero-item generation has no current anchor, and
    // the retired old card must not be resurrected as the decision card
    // (codex round-6 P2).
    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, channelId, messageId, opts] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("ch-carousel");
    expect(messageId).toBe("old-anchor-id");
    expect(opts.embeds[0].description).toMatch(/⏰ superseded/);

    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].staleAnchors).toBeUndefined();
    expect(state["int-1"].lastRenderedStatus).toBeUndefined();
  });

  it("supersede target deleted on Discord (Unknown Message 10008) → retirement completes, entry NOT parked forever", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");
    const gone = Object.assign(new Error("Unknown Message"), { code: 10008 });
    (editMessageInChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(gone);

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      { "int-1": fullyPostedRecord(oldMarkdown) },
    );

    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // A deleted message cannot show live buttons — nothing to retry.
    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].staleAnchors).toBeUndefined();
  });

  it("supersede target in a deleted channel (Unknown Channel 10003) → retirement completes, entry NOT parked forever", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");
    const gone = Object.assign(new Error("Unknown Channel"), { code: 10003 });
    (editMessageInChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(gone);

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      { "int-1": fullyPostedRecord(oldMarkdown) },
    );

    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].staleAnchors).toBeUndefined();
  });

  it("malformed staleAnchors entry in stored state is DROPPED with a warning — does not crash the sweep, well-formed siblings still drain", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");
    const { carouselArtifactHash } = await import("../src/render/carousel-batch.js");

    const harness = createTestHarness({ manifest });
    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });

    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 0,
          totalSections: 0,
          artifactHash: carouselArtifactHash(interaction),
          headerPosted: false,
          trailerPosted: false,
          // Junk alongside a real entry — untyped JSON state can carry both.
          staleAnchors: [null, { messageId: 42 }, { messageId: "good-id", channelId: "ch-carousel" }],
        },
      },
    );

    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await expect(
      runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip),
    ).resolves.not.toThrow();

    // The well-formed entry drained; the junk is gone, not retried.
    const drained = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[2] === "good-id");
    expect(drained).toHaveLength(1);
    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].staleAnchors).toBeUndefined();
  });

  it("malformed NON-ARRAY staleAnchors container + corrupted artifactHash on a generation change do not wedge the interaction (retireCurrentAnchor tolerates junk shapes)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 2,
          totalSections: 2,
          // artifactHash corrupted to a number + ambiguous-send marker set:
          // the orphan-probe guard must not call .slice() on it.
          artifactHash: 42,
          headerPosted: true,
          trailerPosted: false,
          trailerAttemptedAt: "2026-07-11T00:00:00.000Z",
          anchorMessageId: "old-anchor-id",
          lastRenderedStatus: "awaiting",
          // Truthy non-array container: must be treated as empty, not spread.
          staleAnchors: { junk: true },
        },
      },
    );

    // Revision → generation change → retireCurrentAnchor runs against the
    // corrupted record. Must not throw; the new generation must post.
    const newMarkdown = buildBatch([3, 1]);
    const interaction = makeInteraction({ payload: { detailsMarkdown: newMarkdown } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await expect(
      runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip),
    ).resolves.not.toThrow();

    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    // The record healed: fresh generation stamped, junk container gone.
    expect(state["int-1"].artifactHash).toBe(sha256(newMarkdown.trim()));
    expect(state["int-1"].trailerPosted).toBe(true);
  });

  it("legacy record whose pointer is already marked 'superseded' is never repainted by the terminal reconcile (pre-rewrite zero-item shape)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");
    const { carouselArtifactHash } = await import("../src/render/carousel-batch.js");

    const harness = createTestHarness({ manifest });
    const payload = buildStructuredPayload({ items: [], cadence: { days: [], held: 2, strays: 0, heldOldestWeek: "2026-07-06" } });
    const interaction = makeInteraction({ status: "accepted", payload: { detailsMarkdown: "irrelevant", carouselBatch: payload } });

    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 0,
          totalSections: 0,
          artifactHash: carouselArtifactHash(interaction),
          headerPosted: false,
          trailerPosted: false,
          anchorMessageId: "old-anchor-id",
          lastRenderedStatus: "superseded",
        },
      },
    );

    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).not.toHaveBeenCalled();
  });

  it("terminal reconcile edits the anchor in the channel it was POSTED in (anchorChannelId), not the sweeping rule's current channel", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      { "int-1": fullyPostedRecord(markdown, { anchorMessageId: "anchor-msg-1", trailerMessageId: "anchor-msg-1", anchorChannelId: "ch-original" }) },
    );

    const paperclip = makePaperclip(
      [makeIssue()],
      [makeInteraction({ status: "expired", payload: { detailsMarkdown: markdown } })],
    );
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, channelId, messageId] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("ch-original");
    expect(messageId).toBe("anchor-msg-1");
  });
});

describe("runConfirmationSweep — a KNOWN carousel interaction never falls to the buttonless generic path (live incident: months of buttonless carousel cards)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── THE BUG (verified live-reachable): an interaction ALREADY proven
  // carousel-shaped by a prior tick (real content posted under a non-sentinel
  // artifactHash) gets revised into something neither the structured payload
  // contract nor the legacy heading regex can parse. The matching
  // confirmationSweep rule carries NO carouselBatch flag (the flag is easy to
  // forget on a new/other instance's config — CONFIG below has none). Before
  // the fix, this fell straight to the fully generic path — a single
  // first-image embed, ZERO components, forever (every later tick just
  // re-hits the same 24h-throttled buttonless render: "every redo just
  // re-posts the same button-less card"). The fix: the interaction's OWN
  // carouselState record — NOT this tick's parse outcome, NOT the rule flag —
  // is what decides whether it gets the degrade-with-buttons render.
  it("record exists but revision is not carousel-shaped by ANY path (unflagged rule) → old anchor superseded AND the new card still carries accept/reject buttons, never the buttonless generic path", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel, postEmbedToChannel, postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
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
          trailerMessageId: "old-anchor-id",
          anchorMessageId: "old-anchor-id",
          lastRenderedStatus: "awaiting",
          lastSeenUpdatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    );

    // Revision: plain prose — no structured payload, no legacy heading. The
    // matching rule carries NO carouselBatch flag.
    const brokenMarkdown = "Just a plain note now, no carousel shape at all.";
    const interaction = makeInteraction({ payload: { detailsMarkdown: brokenMarkdown } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);

    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // Old (real-carousel) anchor retired…
    expect(editMessageInChannel).toHaveBeenCalledTimes(1);
    const [, channelId, messageId, opts] = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channelId).toBe("ch-carousel");
    expect(messageId).toBe("old-anchor-id");
    expect(opts.embeds[0].description).toMatch(/⏰ superseded/);

    // …NEVER the buttonless generic single-embed card…
    expect(postEmbedToChannel).not.toHaveBeenCalled();

    // …the degrade-with-buttons render posts instead, buttons intact.
    const embedCalls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const trailerCalls = embedCalls.filter(([, , , components]) => components !== undefined);
    expect(trailerCalls).toHaveLength(1);
    const row = trailerCalls[0][3][0];
    const customIds = row.components.map((c: any) => c.custom_id);
    expect(customIds.some((id: string) => id.startsWith("car-ok:"))).toBe(true);
    expect(customIds.some((id: string) => id.startsWith("car-no:"))).toBe(true);

    // Loud warning still present (never a silent degrade).
    const textCalls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
    const captionCall = textCalls.find(([, , msg]) => (msg as string).includes("unstructured artifact"));
    expect(captionCall).toBeDefined();

    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    // New generation posted for real — not the "" shape-loss sentinel.
    expect(state["int-1"].artifactHash).toBe(sha256(brokenMarkdown));
    expect(state["int-1"].headerPosted).toBe(true);
    expect(state["int-1"].trailerPosted).toBe(true);
    expect(state["int-1"].anchorMessageId).toBeDefined();
    expect(state["int-1"].anchorMessageId).not.toBe("old-anchor-id");
  });

  it("old-anchor supersede failure is parked for retry; the KNOWN-carousel degrade render still posts (with buttons) regardless", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel, postEmbedsToChannel } = await import("../src/discord/rest.js");
    (editMessageInChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("transient 503"));

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
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
          anchorMessageId: "old-anchor-id",
          lastRenderedStatus: "awaiting",
        },
      },
    );

    const brokenMarkdown = "Plain prose revision.";
    const interaction = makeInteraction({ payload: { detailsMarkdown: brokenMarkdown } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // The failed supersede is parked for retry (never dropped)…
    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].staleAnchors).toEqual([{ messageId: "old-anchor-id", channelId: "ch-carousel" }]);
    // …but the new generation posts anyway (real hash, not the "" sentinel).
    expect(state["int-1"].artifactHash).toBe(sha256(brokenMarkdown));

    // Buttons still shipped despite the retirement failure.
    const trailerCalls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, , , components]) => components !== undefined,
    );
    expect(trailerCalls).toHaveLength(1);
  });

  it("the '' sentinel gates re-entry: a shape-lost record does NOT re-fire retirement on later generic-path ticks (even with a zombie anchor pointer)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 0,
          totalSections: 0,
          artifactHash: "",
          headerPosted: false,
          trailerPosted: false,
          // Zombie pointer (corrupted/hand-edited state) — the sentinel must
          // still gate the block; retirement ran at shape-loss time.
          anchorMessageId: "zombie-anchor-id",
        },
      },
    );

    const interaction = makeInteraction({ payload: { detailsMarkdown: "Still plain prose, still not a carousel." } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(editMessageInChannel).not.toHaveBeenCalled();
  });

  it("an UNFLAGGED sibling rule matching the same issue does NOT retire the anchor a carouselBatch-flagged rule owns (rule-scoped shape vs interaction-scoped state)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    // Partial degrade record owned by the flagged rule (mid-resume — the
    // staleness gate does not shield it, so the unflagged rule would have
    // reached the shape-loss block without the sibling-flag guard).
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 1,
          totalSections: 1,
          artifactHash: sha256("Unstructured prose the LLM wrote."),
          headerPosted: true,
          trailerPosted: true,
          anchorMessageId: "degrade-anchor-id",
          anchorChannelId: "ch-flagged",
          lastRenderedStatus: "awaiting",
          lastSeenUpdatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    );

    const config = makeConfig({
      c1: [
        { titleRegex: "Carousel", channelId: "ch-flagged", carouselBatch: true },
        { titleRegex: ".*", channelId: "ch-generic" },
      ],
    });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "Unstructured prose the LLM wrote." } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    // No supersede fired against the flagged rule's anchor…
    const supersedes = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[2] === "degrade-anchor-id",
    );
    expect(supersedes).toHaveLength(0);
    // …and the record was not reset to the shape-loss sentinel.
    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].artifactHash).not.toBe("");
    expect(state["int-1"].anchorMessageId).toBe("degrade-anchor-id");
  });

  it("BROAD-FIRST rule ordering with a STRUCTURED payload: the unflagged rule does not render the carousel into its own channel — the flagged rule's channel gets it (codex round-8)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockResolvedValue("msg-2");

    const harness = createTestHarness({ manifest });
    const config = makeConfig({
      c1: [
        { titleRegex: ".*", channelId: "ch-generic" },
        { titleRegex: "Carousel", channelId: "ch-flagged", carouselBatch: true },
      ],
    });
    const payload = buildStructuredPayload();
    const interaction = makeInteraction({ payload: { detailsMarkdown: "prose", carouselBatch: payload } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    // Every carousel message (header/sections/trailer) landed in the flagged
    // rule's channel; the broad rule posted NOTHING (it would have stamped
    // the record fully-posted and the flagged rule's render would have been
    // staleness-gated away — the carousel would never reach its channel).
    const embedChannels = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    const textChannels = (postToChannel as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(embedChannels.length).toBeGreaterThan(0);
    expect([...embedChannels, ...textChannels].every((ch) => ch === "ch-flagged")).toBe(true);

    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].anchorChannelId).toBe("ch-flagged");
  });

  it("BROAD-FIRST rule ordering: the unflagged rule skips the generic image-stripped card entirely when a carouselBatch rule also matches (codex round-7)", async () => {
    const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedToChannel, postToChannel } = await import("../src/discord/rest.js");

    const harness = createTestHarness({ manifest });
    // Broad unflagged rule iterates FIRST — it used to post the generic
    // image-stripped card before the flagged rule's degrade render.
    const config = makeConfig({
      c1: [
        { titleRegex: ".*", channelId: "ch-generic" },
        { titleRegex: "Carousel", channelId: "ch-flagged", carouselBatch: true },
      ],
    });
    const interaction = makeInteraction({ payload: { detailsMarkdown: "![img](https://r2.example.com/x/1.jpg)\nUnstructured prose the LLM wrote." } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), config, async () => paperclip);

    // The generic single-embed card never posts for a carousel-owned
    // interaction — only the flagged rule's degrade render does.
    expect(postEmbedToChannel).not.toHaveBeenCalled();
    const degradeHeader = (postToChannel as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[1] === "ch-flagged" && String(c[2]).includes("Carousel batch awaiting confirmation"),
    );
    expect(degradeHeader).toHaveLength(1);
  });

  it("a later revision BACK to carousel shape — even byte-identical to the retired generation — re-posts from scratch (the '' sentinel never matches a real hash)", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, postToChannel } = await import("../src/discord/rest.js");
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockResolvedValue("msg-2");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    // Post-shape-loss record: anchor retired, hash sentinel in place.
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      {
        "int-1": {
          postedAt: new Date().toISOString(),
          sectionsPosted: 0,
          totalSections: 0,
          artifactHash: "",
          headerPosted: false,
          trailerPosted: false,
          lastSeenUpdatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    );

    const interaction = makeInteraction({ payload: { detailsMarkdown: markdown } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // Full fresh post: header + sections + trailer.
    expect(postToChannel).toHaveBeenCalled();
    expect(postEmbedsToChannel).toHaveBeenCalled();
    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].artifactHash).toBe(sha256(markdown.trim()));
    expect(state["int-1"].trailerPosted).toBe(true);
    expect(state["int-1"].anchorMessageId).toBe("msg-2");
  });
});

describe("runConfirmationSweep — adopt-don't-duplicate (ambiguous trailer sends)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function pendingTrailerRecord(markdown: string) {
    return {
      postedAt: new Date().toISOString(),
      sectionsPosted: 2,
      totalSections: 2,
      artifactHash: sha256(markdown.trim()),
      headerPosted: true,
      trailerPosted: false,
      trailerAttemptedAt: "2026-07-11T00:00:00.000Z",
    };
  }

  it("prior trailer send with unknown outcome + the message actually landed → probe ADOPTS it, no duplicate live-button anchor is posted", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel, findRecentMessageWithCustomId } = await import("../src/discord/rest.js");
    (findRecentMessageWithCustomId as ReturnType<typeof vi.fn>).mockResolvedValueOnce("landed-msg-id");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      { "int-1": pendingTrailerRecord(markdown) },
    );

    const interaction = makeInteraction({ payload: { detailsMarkdown: markdown } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // Probe matched by this generation's EXACT accept customId.
    const hash8 = sha256(markdown.trim()).slice(0, 8);
    const probeCall = (findRecentMessageWithCustomId as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(probeCall[1]).toBe("ch-carousel");
    expect(probeCall[2]).toBe(`car-ok:${hash8}:iss-1:int-1`);

    // No second trailer posted — the landed message becomes the anchor.
    expect(postEmbedsToChannel).not.toHaveBeenCalled();
    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].trailerPosted).toBe(true);
    expect(state["int-1"].anchorMessageId).toBe("landed-msg-id");
    expect(state["int-1"].anchorChannelId).toBe("ch-carousel");
    expect(state["int-1"].lastRenderedStatus).toBe("awaiting");
  });

  it("probe finds nothing → trailer posts normally; the send is attempt-stamped and the anchor records its channel", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockResolvedValue("msg-2");

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      { "int-1": pendingTrailerRecord(markdown) },
    );

    const interaction = makeInteraction({ payload: { detailsMarkdown: markdown } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    expect(postEmbedsToChannel).toHaveBeenCalledTimes(1);
    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    expect(state["int-1"].trailerPosted).toBe(true);
    expect(state["int-1"].anchorMessageId).toBe("msg-2");
    expect(state["int-1"].anchorChannelId).toBe("ch-carousel");
    expect(state["int-1"].trailerAttemptedAt).toBeDefined();
  });

  it("a FRESH trailer send that throws still persists trailerAttemptedAt (stamped BEFORE the send) — the next tick knows the outcome was ambiguous", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { postEmbedsToChannel } = await import("../src/discord/rest.js");
    // Sections (no components arg) succeed; the trailer (posted WITH the
    // action-row components) times out.
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockImplementation(
      async (_client, _channelId, _embeds, components) => {
        if (components) throw new Error("timeout after send");
        return "msg-2";
      },
    );

    const harness = createTestHarness({ manifest });
    const markdown = buildBatch([2, 2]);
    const interaction = makeInteraction({ payload: { detailsMarkdown: markdown } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    const state = (await harness.ctx.state.get({
      scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY,
    })) as Record<string, any>;
    // trailerPosted false, but the attempt is on record — moving the stamp
    // to AFTER the send would defeat the entire duplicate-anchor defense.
    expect(state["int-1"].trailerPosted).toBe(false);
    expect(state["int-1"].trailerAttemptedAt).toBeDefined();
    // Restore the shared mock for later tests.
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockReset();
    (postEmbedsToChannel as ReturnType<typeof vi.fn>).mockResolvedValue("msg-2");
  });

  it("ambiguous trailer send followed by a GENERATION change → retirement probes for the outgoing generation's orphan and supersedes it", async () => {
    const { runConfirmationSweep, CAROUSEL_BATCH_SWEEP_STATE_KEY } = await import("../src/jobs/confirmation-sweep.js");
    const { editMessageInChannel, findRecentMessageWithCustomId } = await import("../src/discord/rest.js");
    (findRecentMessageWithCustomId as ReturnType<typeof vi.fn>).mockResolvedValueOnce("orphan-anchor-id");

    const harness = createTestHarness({ manifest });
    const oldMarkdown = buildBatch([2, 2]);
    await harness.ctx.state.set(
      { scopeKind: "company", scopeId: "c1", stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY },
      { "int-1": pendingTrailerRecord(oldMarkdown) },
    );

    // Revision to a different artifact BEFORE the ambiguous send was resolved.
    const newMarkdown = buildBatch([3, 1]);
    const interaction = makeInteraction({ payload: { detailsMarkdown: newMarkdown } });
    const paperclip = makePaperclip([makeIssue()], [interaction]);
    await runConfirmationSweep(harness.ctx, () => ({} as Client), CONFIG, async () => paperclip);

    // The probe used the OUTGOING generation's customId…
    const oldHash8 = sha256(oldMarkdown.trim()).slice(0, 8);
    const probeCall = (findRecentMessageWithCustomId as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(probeCall[2]).toBe(`car-ok:${oldHash8}:iss-1:int-1`);
    // …and the found orphan was superseded.
    const supersedeCalls = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[2] === "orphan-anchor-id",
    );
    expect(supersedeCalls).toHaveLength(1);
    expect(supersedeCalls[0][3].embeds[0].description).toMatch(/⏰ superseded/);
  });
});
