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

// ─── RESOLVED-RECONCILE: wires the dead "expired" anchor status. The main
// sweep loop only ever considers status==="pending" interactions, so an
// interaction that expires server-side (never clicked) would otherwise sit
// with its anchor stuck on "🟡 awaiting decision" forever ─────────────────

describe("runConfirmationSweep — resolved-reconcile (expired interaction)", () => {
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

  it("accepted/rejected interactions are NOT touched by the resolved-reconcile pass (handled by the button handler, not the sweep)", async () => {
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
