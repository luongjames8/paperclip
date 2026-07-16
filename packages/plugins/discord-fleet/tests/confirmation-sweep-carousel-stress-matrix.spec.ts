/**
 * STRESS MATRIX for the carousel confirmation-card seam.
 *
 * PR #34 fixed ONE reachable gap: a KNOWN carousel interaction (real prior
 * carouselState) whose matching rule wasn't carouselBatch-flagged used to
 * fall to the buttonless generic path on a broken revision. That fix was
 * proven with exactly one drifted-artifact example. This file empirically
 * hammers the seam across the FULL cross product of (heading-drift shape) x
 * (rule.carouselBatch flag) x (prior interaction state), driving the REAL
 * production functions (runConfirmationSweep -> the structured / legacy /
 * unstructured-degrade detection branches -> postCarouselBatch ->
 * postCarouselTrailer -> buildCarouselConfirmationActionRow), never
 * reimplementations.
 *
 * This is a CHARACTERIZATION matrix, not a "should always pass" one: each
 * cell asserts against an `expectedOutcome()` table derived from reading the
 * routing code (see the function below for the exact reasoning). Cells the
 * code currently gets WRONG are asserted as wrong ON PURPOSE, with a
 * `// KNOWN GAP` comment — this keeps the suite green (per repo policy: no
 * committed red tests) while making every currently-broken combination a
 * single-line diff away from failing loud the moment someone "fixes" it
 * without updating this table, and failing loud if a future change
 * regresses a currently-working cell. The table IS the breakage matrix.
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
  postEmbedToChannel: vi.fn().mockResolvedValue("generic-msg"),
  postEmbedsToChannel: vi.fn().mockResolvedValue("embeds-msg"),
  postToChannel: vi.fn().mockResolvedValue("text-msg"),
  postEmbedToThread: vi.fn().mockResolvedValue("thread-msg"),
  postToThread: vi.fn().mockResolvedValue("thread-msg-2"),
  editMessageInChannel: vi.fn().mockResolvedValue(undefined),
  findRecentMessageWithCustomId: vi.fn().mockResolvedValue(null),
}));

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function makeConfig(rule: DiscordFleetConfig["confirmationSweep"] extends infer T ? T : never): DiscordFleetConfig {
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
    confirmationSweep: rule,
  };
}

function makeIssue(): PaperclipIssue {
  return {
    id: "iss-1",
    identifier: "ISS-1",
    title: "Publisher (Carousel) — wk-stress",
    status: "backlog",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

function makeInteraction(overrides: Partial<PaperclipInteraction> = {}): PaperclipInteraction {
  return {
    id: "int-1",
    kind: "request_confirmation",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    payload: { detailsMarkdown: "placeholder" },
    ...overrides,
  };
}

function makePaperclip(issues: PaperclipIssue[], interactions: PaperclipInteraction[]): PaperclipClient {
  return {
    getOpenIssues: vi.fn().mockResolvedValue(issues),
    listIssueInteractions: vi.fn().mockResolvedValue(interactions),
  } as unknown as PaperclipClient;
}

// ─── Rule-flag axis (config.carouselBatch = true / false / absent) ──────────
type RuleFlagId = "true" | "false" | "absent";
function ruleConfig(flag: RuleFlagId): DiscordFleetConfig["confirmationSweep"] {
  const base = { titleRegex: "Publisher \\(Carousel\\)", channelId: "ch-carousel" };
  if (flag === "true") return { c1: [{ ...base, carouselBatch: true }] };
  if (flag === "false") return { c1: [{ ...base, carouselBatch: false }] };
  return { c1: [{ ...base }] }; // absent
}

// ─── Prior-interaction-state axis: fresh vs. revision (a REAL prior
// carouselState record — this IS "has prior carouselState" AND "v2
// supersedes v1" in one: v1 was a genuinely valid legacy post, v2 is the
// matrix cell's artifact under test) ──────────────────────────────────────
type PriorStateId = "fresh" | "revision";
const V1_MARKDOWN = "**1. legacy-seed (Mon)**\n![s](https://r2.example.com/seed/1.jpg)\n\nSeed caption.\n";
function seedPriorRecord(harness: ReturnType<typeof createTestHarness>) {
  return harness.ctx.state.set(
    { scopeKind: "company", scopeId: "c1", stateKey: "carousel-batch-sweep-posted" },
    {
      "int-1": {
        postedAt: new Date().toISOString(),
        sectionsPosted: 1,
        totalSections: 1,
        artifactHash: sha256(V1_MARKDOWN.trim()),
        headerPosted: true,
        trailerPosted: true,
        trailerMessageId: "v1-anchor",
        anchorMessageId: "v1-anchor",
        anchorChannelId: "ch-carousel",
        lastRenderedStatus: "awaiting",
        lastSeenUpdatedAt: "2020-01-01T00:00:00.000Z",
      },
    },
  );
}

// ─── Heading-drift shape axis (a)-(h) ────────────────────────────────────
interface ShapeDef {
  id: string;
  label: string;
  detailsMarkdown: string;
  carouselBatchPayload?: CarouselBatchPayload;
  // Detected by structured payload OR legacy heading regex REGARDLESS of the
  // rule flag / prior state — buttons are unconditional for these (verified
  // against confirmation-sweep.ts's detection ordering, not assumed).
  structurallyParseable: boolean;
  expectedImageUrls: string[];
  // Per-section image cap for elision math (only shape H exceeds 30/section).
  perSectionCap?: number;
}

const shapes: ShapeDef[] = [
  {
    id: "a",
    label: "(a) proper structured payload",
    detailsMarkdown: "irrelevant prose — structured payload must win regardless of text shape",
    carouselBatchPayload: {
      version: 1,
      items: [
        { slug: "a1", day: "Mon", caption: "C1", slides: ["https://r2.example.com/a/1-1.jpg", "https://r2.example.com/a/1-2.jpg"] },
        { slug: "a2", day: "Tue", caption: "C2", slides: ["https://r2.example.com/a/2-1.jpg", "https://r2.example.com/a/2-2.jpg"] },
      ],
    },
    structurallyParseable: true,
    expectedImageUrls: ["https://r2.example.com/a/1-1.jpg", "https://r2.example.com/a/1-2.jpg", "https://r2.example.com/a/2-1.jpg", "https://r2.example.com/a/2-2.jpg"],
  },
  {
    id: "b",
    label: "(b) legacy **N. slug (Day)** bold heading",
    detailsMarkdown:
      "**1. tokyo-guide (Mon)**\n![s](https://r2.example.com/b/1-1.jpg)\n![s](https://r2.example.com/b/1-2.jpg)\n\nCaption one.\n\n**2. osaka-food (Tue)**\n![s](https://r2.example.com/b/2-1.jpg)\n![s](https://r2.example.com/b/2-2.jpg)\n\nCaption two.\n",
    structurallyParseable: true,
    expectedImageUrls: ["https://r2.example.com/b/1-1.jpg", "https://r2.example.com/b/1-2.jpg", "https://r2.example.com/b/2-1.jpg", "https://r2.example.com/b/2-2.jpg"],
  },
  {
    id: "c",
    label: "(c) drifted ## slug (Day) H2 heading",
    detailsMarkdown: "## tokyo-guide (Mon)\n![s](https://r2.example.com/c/1.jpg)\n![s](https://r2.example.com/c/2.jpg)\n\nCaption for c.\n",
    structurallyParseable: false,
    expectedImageUrls: ["https://r2.example.com/c/1.jpg", "https://r2.example.com/c/2.jpg"],
  },
  {
    id: "d",
    label: "(d) em-dash separator, no parens (**N. slug — Day**)",
    detailsMarkdown: "**1. tokyo-guide — Mon**\n![s](https://r2.example.com/d/1.jpg)\n![s](https://r2.example.com/d/2.jpg)\n\nCaption for d.\n",
    structurallyParseable: false,
    expectedImageUrls: ["https://r2.example.com/d/1.jpg", "https://r2.example.com/d/2.jpg"],
  },
  {
    id: "e",
    label: "(e) mixed valid bold + invalid H2 item in one batch",
    detailsMarkdown:
      "**1. tokyo-guide (Mon)**\n![s](https://r2.example.com/e/1-1.jpg)\n\nCaption one.\n\n## osaka-food (Tue)\n![s](https://r2.example.com/e/2-1.jpg)\n\nCaption two.\n",
    // legacyMatches=true (item 1's bold heading matches) — always detected,
    // even though item 2 silently merges into item 1's block (see report).
    structurallyParseable: true,
    expectedImageUrls: ["https://r2.example.com/e/1-1.jpg", "https://r2.example.com/e/2-1.jpg"],
  },
  {
    id: "f",
    label: "(f) LLM reworded prose, no heading markers at all",
    detailsMarkdown:
      "First up, our fantastic Tokyo private car tour! ![s](https://r2.example.com/f/1.jpg) Absolutely stunning views.\n\nNext stop: the Shibuya crossing experience. ![s](https://r2.example.com/f/2.jpg) Don't miss it.\n",
    structurallyParseable: false,
    expectedImageUrls: ["https://r2.example.com/f/1.jpg", "https://r2.example.com/f/2.jpg"],
  },
  {
    id: "g",
    label: "(g) empty / zero-image artifact",
    detailsMarkdown: "Nothing to see here — no images, no headings, just a status note about this week's batch.",
    structurallyParseable: false,
    expectedImageUrls: [],
  },
  {
    id: "h",
    label: "(h) oversized batch exceeding Discord's 30-embed elision cap",
    detailsMarkdown:
      "**1. mega-set (Mon)**\n" +
      Array.from({ length: 35 }, (_, i) => `![s](https://r2.example.com/h/1-${i + 1}.jpg)`).join("\n") +
      "\n\nBig caption.\n\n**2. small-set (Tue)**\n![s](https://r2.example.com/h/2-1.jpg)\n![s](https://r2.example.com/h/2-2.jpg)\n\nSmall caption.\n",
    structurallyParseable: true,
    expectedImageUrls: [
      ...Array.from({ length: 35 }, (_, i) => `https://r2.example.com/h/1-${i + 1}.jpg`),
      "https://r2.example.com/h/2-1.jpg",
      "https://r2.example.com/h/2-2.jpg",
    ],
    perSectionCap: 30,
  },
];

// ─── The expectation table (= the breakage matrix), derived from reading
// confirmation-sweep.ts's detection/routing order, NOT assumed ────────────
//
// a, b, e, h are ALWAYS detected via structuredPayload or legacyMatches —
// buttons are unconditional for them regardless of flag/prior state.
//
// c, d, f, g fail BOTH structured and legacy detection. Buttons for these
// require EITHER rule.carouselBatch===true OR a known-prior-carousel record
// (the PR #34 fix). The one combination PR #34 does NOT cover — because
// there is no prior record AND the operator never flagged the rule — is the
// KNOWN GAP this stress pass surfaces: a carousel-titled issue's VERY FIRST
// post, with a drifted artifact, on an unflagged rule, still silently
// degrades to the buttonless generic path.
function expectButtons(shape: ShapeDef, ruleFlag: RuleFlagId, priorState: PriorStateId): boolean {
  if (shape.structurallyParseable) return true;
  if (ruleFlag === "true") return true;
  if (priorState === "revision") return true; // PR #34 fix
  return false; // KNOWN GAP: fresh + unflagged + unparseable shape
}

interface CellResult {
  hasTrailerButtons: boolean;
  customIds: string[];
  genericPathFired: boolean;
  warningPresent: boolean;
  renderedImageUrls: string[];
  elisionMarkerCounts: number[];
  oldAnchorSuperseded: boolean | "n/a";
  newAnchorDiffersFromOld: boolean | "n/a";
}

async function runCell(shape: ShapeDef, ruleFlag: RuleFlagId, priorState: PriorStateId): Promise<CellResult> {
  vi.clearAllMocks();
  const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
  const { postEmbedToChannel, postEmbedsToChannel, postToChannel, editMessageInChannel } = await import("../src/discord/rest.js");

  const harness = createTestHarness({ manifest });
  if (priorState === "revision") await seedPriorRecord(harness);

  const payload: Record<string, unknown> = { detailsMarkdown: shape.detailsMarkdown };
  if (shape.carouselBatchPayload) payload.carouselBatch = shape.carouselBatchPayload;
  const interaction = makeInteraction({ payload });
  const paperclip = makePaperclip([makeIssue()], [interaction]);

  await runConfirmationSweep(harness.ctx, () => ({} as Client), makeConfig(ruleConfig(ruleFlag)), async () => paperclip);

  const embedsCalls = (postEmbedsToChannel as ReturnType<typeof vi.fn>).mock.calls;
  const trailerCalls = embedsCalls.filter(([, , , components]) => components !== undefined);
  const slideCalls = embedsCalls.filter(([, , , components]) => components === undefined);
  const textCalls = (postToChannel as ReturnType<typeof vi.fn>).mock.calls;
  const genericCalls = (postEmbedToChannel as ReturnType<typeof vi.fn>).mock.calls;
  const editCalls = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls;

  const hasTrailerButtons = trailerCalls.length > 0;
  const customIds: string[] = hasTrailerButtons
    ? (trailerCalls[0][3][0].components as Array<{ custom_id: string }>).map((c) => c.custom_id)
    : [];

  const renderedImageUrls = [
    ...slideCalls.flatMap(([, , embeds]) => (embeds as Array<{ image?: { url?: string } }>).map((e) => e.image?.url).filter(Boolean) as string[]),
    ...genericCalls.map(([, , embed]) => (embed as { image?: { url?: string } }).image?.url).filter(Boolean) as string[],
  ];
  const elisionMarkerCounts = textCalls
    .map(([, , msg]) => /\+(\d+) more slides not shown/.exec(msg as string))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));

  const warningPresent = textCalls.some(([, , msg]) => (msg as string).includes("unstructured artifact"));

  let oldAnchorSuperseded: boolean | "n/a" = "n/a";
  let newAnchorDiffersFromOld: boolean | "n/a" = "n/a";
  if (priorState === "revision") {
    const supersedeCall = editCalls.find((c) => c[2] === "v1-anchor");
    oldAnchorSuperseded = Boolean(supersedeCall && /⏰ superseded/.test((supersedeCall[3] as { embeds: Array<{ description?: string }> }).embeds[0].description ?? ""));
    newAnchorDiffersFromOld = hasTrailerButtons; // any new trailer id is necessarily != "v1-anchor" (adopt-probe returns null in this harness)
  }

  return {
    hasTrailerButtons,
    customIds,
    genericPathFired: genericCalls.length > 0,
    warningPresent,
    renderedImageUrls,
    elisionMarkerCounts,
    oldAnchorSuperseded,
    newAnchorDiffersFromOld,
  };
}

const RULE_FLAGS: RuleFlagId[] = ["true", "false", "absent"];
const PRIOR_STATES: PriorStateId[] = ["fresh", "revision"];

describe("STRESS MATRIX — carousel confirmation-card seam (heading-drift x rule-flag x prior-state)", () => {
  for (const shape of shapes) {
    for (const ruleFlag of RULE_FLAGS) {
      for (const priorState of PRIOR_STATES) {
        const expected = expectButtons(shape, ruleFlag, priorState);
        const isKnownGap = !expected;
        const title = `${shape.label} | rule.carouselBatch=${ruleFlag} | prior=${priorState} => INV-1 buttons ${expected ? "PASS" : "KNOWN GAP (RED)"}`;

        it(title, async () => {
          const r = await runCell(shape, ruleFlag, priorState);

          // INV-1: buttons present, exactly matching the derived expectation.
          expect(r.hasTrailerButtons).toBe(expected);
          if (expected) {
            expect(r.customIds.some((id) => id.startsWith("car-ok:"))).toBe(true);
            expect(r.customIds.some((id) => id.startsWith("car-no:"))).toBe(true);
          }

          // INV-5: routing never sends a KNOWN-carousel interaction (prior
          // state = revision) to the buttonless generic path — this holds
          // for EVERY shape/flag once there's a real prior record (the
          // PR #34 fix), so it's unconditionally true for all revision cells.
          if (priorState === "revision") {
            expect(r.genericPathFired).toBe(false);
          }
          // For a KNOWN GAP cell (fresh, unflagged, unparseable), the
          // generic path is exactly what DOES fire — document it, don't
          // hide it.
          if (isKnownGap) {
            expect(r.genericPathFired).toBe(true);
          }

          // INV-3: loud warning shown iff the degrade path is what produced
          // the buttons (unparseable shape + buttons actually present).
          const warningExpected = !shape.structurallyParseable && expected;
          expect(r.warningPresent).toBe(warningExpected);

          // INV-2: every source image URL is rendered, OR (shape h only)
          // accounted for via an explicit elision marker — UNLESS this cell
          // is a KNOWN GAP, where the generic path structurally can only
          // carry the first image (or none), so anything beyond 1 is lost.
          if (expected) {
            const cap = shape.perSectionCap;
            if (!cap) {
              expect(new Set(r.renderedImageUrls)).toEqual(new Set(shape.expectedImageUrls));
            } else {
              // Shape h: section 1 has 35 (capped to 30 + elision marker),
              // section 2 has 2 (under cap, rendered whole).
              expect(r.renderedImageUrls.length).toBe(32);
              expect(r.elisionMarkerCounts).toEqual([5]);
            }
          } else {
            // KNOWN GAP: generic path renders AT MOST the first image
            // (extractFirstImageUrl) — anything beyond that is silently
            // dropped from the posted content entirely.
            expect(r.renderedImageUrls.length).toBeLessThanOrEqual(1);
            if (shape.expectedImageUrls.length > 1) {
              expect(r.renderedImageUrls.length).toBeLessThan(shape.expectedImageUrls.length);
            }
          }

          // INV-4: revision cleanly supersedes v1 — checked whenever a v1
          // record existed, regardless of whether v2 ends up buttoned.
          if (priorState === "revision") {
            if (expected) {
              // v2 posted successfully with buttons: v1 must be retired.
              expect(r.oldAnchorSuperseded).toBe(true);
              expect(r.newAnchorDiffersFromOld).toBe(true);
            }
            // Note: no KNOWN GAP cell has priorState="revision" — the
            // known-prior record IS what makes those cells PASS (see
            // expectButtons). INV-4 is therefore never exercised against a
            // buttonless outcome in this matrix; that would require a THIRD
            // failure mode (a broken v1->v2 transition even with a flagged
            // rule) which this pass did not find.
          }
        });
      }
    }
  }
});

// ─── Terminal-state axis: "expired" is intentionally NOT crossed into the
// buttons matrix above — an expired interaction is a TERMINAL status
// (interaction.status !== "pending"), so pendingConfirmations excludes it
// from the render loop entirely; only reconcileResolvedCarouselAnchors
// touches it, and CORRECTLY strips buttons (decision window is closed). The
// invariant here is different in kind from INV-1: not "buttons present" but
// "the anchor visibly reflects expiry, uniformly, across every render path
// that could have produced the original card." ────────────────────────────
describe("STRESS MATRIX — expired-interaction reconciliation across render paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const expiredShapes = shapes.filter((s) => ["a", "b", "c", "h"].includes(s.id));

  for (const shape of expiredShapes) {
    it(`${shape.label} | interaction.status="expired" with a live prior anchor → anchor edited to expired, buttons stripped, exactly once`, async () => {
      const { runConfirmationSweep } = await import("../src/jobs/confirmation-sweep.js");
      const { editMessageInChannel } = await import("../src/discord/rest.js");

      const harness = createTestHarness({ manifest });
      // Seed a fully-posted record matching THIS shape's own hash (so the
      // reconcile pass's record lookup is realistic, not the generic V1 seed).
      const hash = shape.carouselBatchPayload ? sha256(JSON.stringify({ version: 1, items: shape.carouselBatchPayload.items })) : sha256(shape.detailsMarkdown.trim());
      await harness.ctx.state.set(
        { scopeKind: "company", scopeId: "c1", stateKey: "carousel-batch-sweep-posted" },
        {
          "int-1": {
            postedAt: new Date().toISOString(),
            sectionsPosted: 1,
            totalSections: 1,
            artifactHash: hash,
            headerPosted: true,
            trailerPosted: true,
            anchorMessageId: "expiring-anchor",
            anchorChannelId: "ch-carousel",
            lastRenderedStatus: "awaiting",
          },
        },
      );

      const payload: Record<string, unknown> = { detailsMarkdown: shape.detailsMarkdown };
      if (shape.carouselBatchPayload) payload.carouselBatch = shape.carouselBatchPayload;
      const interaction = makeInteraction({ status: "expired", payload });
      const paperclip = makePaperclip([makeIssue()], [interaction]);

      await runConfirmationSweep(harness.ctx, () => ({} as Client), makeConfig(ruleConfig("true")), async () => paperclip);

      const calls = (editMessageInChannel as ReturnType<typeof vi.fn>).mock.calls;
      const expireCall = calls.find((c) => c[2] === "expiring-anchor");
      expect(expireCall).toBeDefined();
      const opts = expireCall![3] as { embeds: Array<{ description?: string }>; components: unknown[] };
      expect(opts.embeds[0].description).toMatch(/⏰ expired/);
      expect(opts.components).toEqual([]);
      // Exactly once — idempotent, no duplicate edit for the same status.
      expect(calls.filter((c) => c[2] === "expiring-anchor")).toHaveLength(1);
    });
  }
});
