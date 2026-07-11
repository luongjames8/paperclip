import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient, PaperclipIssue, PaperclipInteraction } from "../api/paperclip.js";
import { postEmbedToChannel, postEmbedsToChannel, postToChannel, editMessageInChannel } from "../discord/rest.js";
import {
  enforceEmbedLimits,
  buildCarouselConfirmationActionRow,
  buildCarouselAnchorEmbed,
  CAROUSEL_HASH_TOKEN_LEN,
} from "../render/embeds.js";
import { chunkEmbedsForDiscord } from "../render/issue-docs.js";
import {
  parseCarouselBatchMarkdown,
  parseCarouselBatchPayload,
  carouselBatchFromStructuredPayload,
  carouselArtifactHash,
  buildUnstructuredDegradeSection,
  renderCarouselSlideEmbeds,
  SECTION_HEADING_RE,
  sha256,
  type CarouselSection,
  type ParsedCarouselBatch,
} from "../render/carousel-batch.js";
import { stripSecrets } from "../render/secrets.js";
import { truncate } from "../render/plain.js";
import { safeParseMs, safeStr } from "../util/safe.js";

// Re-post at most this often per interaction.
const RETHRESHOLD_MS = 24 * 60 * 60 * 1000;
export const CONFIRMATION_SWEEP_STATE_KEY = "confirmation-sweep-posted";
export const CAROUSEL_BATCH_SWEEP_STATE_KEY = "carousel-batch-sweep-posted";

const CONTENT_CHUNK_MAX = 1900;

// Never post more than this many slide embeds for a single section — a
// malformed artifact (e.g. duplicated slides) must not spam Discord.
const SECTION_EMBED_ELISION_CAP = 30;

// State: interactionId → ISO timestamp of last post.
type SweepState = Record<string, string>;

// State for the carousel-batch path: interactionId → per-interaction resume
// record. Distinct from SweepState above (different shape, different key)
// because it needs to survive PARTIAL posting (resume from sectionsPosted)
// and full re-post detection (artifactHash), not just a 24h throttle.
export interface CarouselBatchSweepRecord {
  postedAt: string;
  sectionsPosted: number;
  totalSections: number;
  artifactHash: string;
  headerPosted: boolean;
  trailerPosted: boolean;
  // The posted trailer message's Discord id — lets a later hashChanged
  // re-post best-effort-disable this (now stale) trailer's buttons. Absent on
  // records created before this field existed (older re-post can't be found).
  trailerMessageId?: string;
  // ANCHOR (kills "stacked generations" — 2026-07-11 live incident): the SAME
  // message id as trailerMessageId once the anchor rewrite lands, tracked
  // under its own name because it is now a distinct concept — "the one
  // message the sweep/button-handler EDIT for every state change" — not just
  // "the message with buttons on it". New field; absent on records from
  // before this migration (falls back to trailerMessageId — see
  // resolveAnchorMessageId).
  anchorMessageId?: string;
  // Last status rendered onto the anchor by SWEEP-driven edits only
  // ("awaiting" | "superseded" | "expired"). Terminal states
  // ("accepted"/"rejected") are rendered directly by the button handler on
  // ITS OWN interaction.message reference and never routed back through this
  // record. "expired" IS routed through this record — unlike
  // accepted/rejected, there is no button click to render it, so the
  // resolved-reconcile pass below (reconcileResolvedCarouselAnchor) is the
  // ONLY place that ever renders it, guarded by this field so it edits the
  // anchor at most once. Absent on records from before this field existed.
  lastRenderedStatus?: "awaiting" | "superseded" | "expired";
  // The interaction's server-side updatedAt as of the last tick this record's
  // full parse+hash path ran. STALENESS GATE: when a fully-posted record's
  // interaction.updatedAt is unchanged from this value, the sweep skips
  // parseCarouselBatchPayload/parseCarouselBatchMarkdown/JSON.stringify/sha256
  // entirely for that interaction on this tick — those all run once per
  // interaction per underlying change, never once per interaction per sweep
  // tick regardless of change. Absent on records from before this field
  // existed (first tick after upgrade always runs the full path once, then
  // starts gating).
  lastSeenUpdatedAt?: string;
}
type CarouselBatchSweepState = Record<string, CarouselBatchSweepRecord>;

// A carousel-batch artifact is detected purely by shape: detailsMarkdown
// contains at least one `**N. slug (Day)**` section heading. When it does,
// the sweep takes the carousel-batch path below; otherwise the existing
// generic single-embed path (unchanged) runs.
function looksLikeCarouselBatch(detailsMarkdown: string): boolean {
  return SECTION_HEADING_RE.test(detailsMarkdown);
}

// Extract the first image URL from markdown text (first `![...](url)` match).
function extractFirstImageUrl(text: string): string | null {
  const match = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/.exec(text);
  return match ? match[1] : null;
}

// Strip all image markdown lines from text.
function stripImageLines(text: string): string {
  return text.split("\n").filter((line) => !/^!\[/.test(line.trim())).join("\n").trim();
}

function chunkBySection(text: string): string[] {
  const raw = text.split(/(?=^## )/m).filter((s) => s.trim());
  const chunks: string[] = [];
  for (const section of raw) {
    if (section.length <= CONTENT_CHUNK_MAX) {
      chunks.push(section);
    } else {
      let remaining = section;
      while (remaining.length > CONTENT_CHUNK_MAX) {
        const cut = remaining.lastIndexOf("\n\n", CONTENT_CHUNK_MAX);
        const end = cut > 0 ? cut : CONTENT_CHUNK_MAX;
        chunks.push(remaining.slice(0, end));
        remaining = remaining.slice(end).trimStart();
      }
      if (remaining) chunks.push(remaining);
    }
  }
  return chunks;
}

// Discriminates which detection path produced a ParsedCarouselBatch, purely
// for header wording (the structured path never hits the 20000-char cap the
// legacy markdown path can, so its header never shows the cap-fallback line).
export type CarouselBatchSource = "structured" | "legacy" | "unstructured-degrade";

/**
 * Post one carousel-batch pending interaction: header → per-section (slide
 * embeds + caption) → trailer/anchor (decision buttons). Resumes from
 * `record.sectionsPosted` on a prior partial failure; re-posts everything
 * when the artifact hash changed (the same interactionId got a new
 * detailsMarkdown/structured payload, e.g. after a revision cycle).
 *
 * `artifactHash` (the FINAL hash — already computed by the caller via the
 * single-source-of-truth carouselArtifactHash, or sha256 of the legacy
 * markdown; never re-hashed here) and `getParsed` (LAZY — structured-payload
 * detection and legacy-markdown parsing are both deferred behind this
 * closure, invoked only when there's actual section work to do) are supplied
 * by the caller. Both detection paths funnel into the same ParsedCarouselBatch
 * shape (see carouselBatchFromStructuredPayload in ./render/carousel-batch.ts)
 * so this function never needs to know which path produced it.
 */
async function postCarouselBatch(
  ctx: PluginContext,
  client: Client,
  channelId: string,
  company: DiscordFleetConfig["companies"][number],
  issue: PaperclipIssue,
  interaction: PaperclipInteraction,
  artifactHash: string,
  getParsed: () => ParsedCarouselBatch,
  source: CarouselBatchSource,
  state: CarouselBatchSweepState,
  now: number,
): Promise<void> {
  const issueUrl = `${company.paperclipApiUrl}/${company.companyPrefix}/issues/${issue.identifier}`;
  const existing = state[interaction.id];

  // Fully posted AND hash unchanged: nothing to do. Checked before parsing —
  // this is the common steady-state tick (no section work left), so it must
  // not pay for getParsed() just to find that out. Still stamps
  // lastSeenUpdatedAt (cheap — no parse/stringify/hash work above this point)
  // so the CALLER's staleness gate can skip the parse+hash work entirely on
  // the NEXT tick if updatedAt hasn't moved again.
  if (
    existing &&
    existing.artifactHash === artifactHash &&
    existing.headerPosted &&
    existing.trailerPosted &&
    existing.sectionsPosted >= existing.totalSections
  ) {
    if (existing.lastSeenUpdatedAt !== interaction.updatedAt) {
      state[interaction.id] = { ...existing, lastSeenUpdatedAt: interaction.updatedAt };
    }
    return;
  }

  // Trailer-only resume: header + all sections already posted under the same
  // hash, only the trailer/anchor is missing. Needs only ids/counts already
  // in the record — post it without ever calling getParsed().
  if (
    existing &&
    existing.artifactHash === artifactHash &&
    existing.headerPosted &&
    !existing.trailerPosted &&
    existing.sectionsPosted >= existing.totalSections
  ) {
    await postCarouselTrailer(
      ctx, client, channelId, company.companyId, issue, interaction, issueUrl,
      { ...existing, lastSeenUpdatedAt: interaction.updatedAt },
      state, now,
    );
    return;
  }

  const parsed = getParsed();
  const totalSections = parsed.sections.length;

  // 0 items: a structured payload can legitimately parse with an empty
  // `items` array (e.g. a batch that held everything over). Nothing to
  // render — posting an empty header + a trailer with buttons that accept/
  // reject NOTHING would be actively misleading. Log once per hash change
  // and skip; the interaction stays pending until the publisher revises it
  // with real items (or an operator resolves it directly in Paperclip).
  if (totalSections === 0) {
    if (!existing || existing.artifactHash !== artifactHash) {
      ctx.logger.warn("confirmation-sweep: carousel-batch parsed with ZERO items — skipping post, interaction stays pending", {
        companyId: company.companyId,
        interactionId: interaction.id,
        source,
      });
      state[interaction.id] = {
        postedAt: new Date(now).toISOString(),
        sectionsPosted: 0,
        totalSections: 0,
        artifactHash,
        headerPosted: false,
        trailerPosted: false,
        lastSeenUpdatedAt: interaction.updatedAt,
      };
    }
    return;
  }

  // Hash changed from a previously (partially or fully) posted record: full
  // re-post — reset the resume record to start from zero.
  const hashChanged = existing && existing.artifactHash !== artifactHash;
  const record: CarouselBatchSweepRecord =
    !existing || hashChanged
      ? { postedAt: new Date(now).toISOString(), sectionsPosted: 0, totalSections, artifactHash, headerPosted: false, trailerPosted: false, lastSeenUpdatedAt: interaction.updatedAt }
      : { ...existing, totalSections, lastSeenUpdatedAt: interaction.updatedAt };

  // ANCHOR — mark the PREVIOUS generation superseded (kills "stacked
  // generations": 2026-07-11 live incident, partial + full renders of the
  // same week both sitting in the channel with nothing marking which was
  // current). This EDITS the old anchor in place rather than leaving it live
  // — belt-and-suspenders only: the customId version-token check at click
  // time (FIX (a), PR #27) is what actually prevents a stale accept/reject
  // from taking effect, so a failure here is logged and swallowed, never
  // fatal to the re-post.
  const previousAnchorId = existing ? resolveAnchorMessageId(existing) : undefined;
  if (hashChanged && previousAnchorId) {
    try {
      await editMessageInChannel(client, channelId, previousAnchorId, {
        embeds: [buildCarouselAnchorEmbed({ issueUrl, status: "superseded" })],
        components: [],
      });
    } catch (err) {
      ctx.logger.warn("confirmation-sweep: best-effort disable of superseded anchor failed — proceeding (version-token guard still applies)", {
        companyId: company.companyId,
        interactionId: interaction.id,
        anchorMessageId: previousAnchorId,
        error: String(err),
      });
    }
  }

  if (!record.headerPosted) {
    const totalImages = parsed.totalImagesFound;
    const headerLines = [
      `🎠 **Carousel batch awaiting confirmation**: ${stripSecrets(truncate(issue.title, 200))}`,
      `${totalSections} carousel(s) · ${totalImages} image(s) total`,
      `[View in Paperclip](${issueUrl})`,
    ];
    if (source === "legacy" && parsed.wasCapFallback) {
      headerLines.push(
        `⚠️ artifact hit the 20000-char cap — showing FIRST SLIDE ONLY per carousel; full sets in paperclip: ${issueUrl}`,
      );
    }
    try {
      await postToChannel(client, channelId, stripSecrets(headerLines.join("\n")));
      record.headerPosted = true;
      state[interaction.id] = { ...record };
    } catch (err) {
      ctx.logger.warn("confirmation-sweep: carousel-batch header post failed — will retry next sweep", {
        companyId: company.companyId,
        interactionId: interaction.id,
        error: String(err),
      });
      return;
    }
  }

  // Resume from record.sectionsPosted — sections before that index are
  // already posted (both embeds and caption succeeded for each).
  for (let i = record.sectionsPosted; i < parsed.sections.length; i++) {
    const section = parsed.sections[i];
    const posted = await postCarouselSection(ctx, client, channelId, company.companyId, interaction.id, issueUrl, section);
    if (!posted) {
      // Partial failure: persist what succeeded so far and stop — next sweep
      // resumes from this same section index.
      state[interaction.id] = { ...record };
      return;
    }
    record.sectionsPosted = i + 1;
    state[interaction.id] = { ...record };
  }

  if (!record.trailerPosted) {
    const ok = await postCarouselTrailer(ctx, client, channelId, company.companyId, issue, interaction, issueUrl, record, state, now);
    if (!ok) return;
  }

  ctx.logger.info("confirmation-sweep: posted carousel-batch interaction", {
    companyId: company.companyId,
    issueId: issue.id,
    interactionId: interaction.id,
    channelId,
    totalSections,
    source,
  });
}

// A record created before the anchor rewrite carries only trailerMessageId.
// anchorMessageId (once populated) is authoritative going forward — both are
// kept in sync by postCarouselTrailer so old and new code paths never diverge
// on which message id is "the" anchor.
function resolveAnchorMessageId(record: CarouselBatchSweepRecord): string | undefined {
  return record.anchorMessageId ?? record.trailerMessageId;
}

// RESOLVED-RECONCILE (wires the dead "expired" anchor status): the main sweep
// loop only ever considers interactions with status === "pending" (see
// pendingConfirmations below), so once a request_confirmation interaction's
// status leaves "pending" WITHOUT going through the carousel-confirmation
// button handler (i.e. it EXPIRED server-side rather than being
// accepted/rejected by a click), nothing else in this plugin ever revisits
// its anchor — it would sit showing "🟡 awaiting decision" forever despite
// the decision window having closed. This pass catches exactly that gap:
// for every carousel-batch record this sweep knows about (has an
// anchorMessageId) whose interaction is now "expired" and whose anchor
// hasn't already been edited to "expired" (lastRenderedStatus guard — at
// most one edit per record), edit the anchor in place and strip its buttons.
// Accepted/rejected are NOT handled here — those are rendered directly by
// the button handler on its own interaction.message reference (see the
// CarouselBatchSweepRecord.lastRenderedStatus doc) and never need this pass.
async function reconcileResolvedCarouselAnchors(
  ctx: PluginContext,
  client: Client,
  channelId: string,
  company: DiscordFleetConfig["companies"][number],
  issue: PaperclipIssue,
  interactions: PaperclipInteraction[],
  state: CarouselBatchSweepState,
): Promise<void> {
  for (const interaction of interactions) {
    if (interaction.kind !== "request_confirmation") continue;
    if (interaction.status !== "expired") continue;

    const record = state[interaction.id];
    if (!record) continue;
    const anchorMessageId = resolveAnchorMessageId(record);
    if (!anchorMessageId) continue;
    if (record.lastRenderedStatus === "expired") continue;

    const issueUrl = `${company.paperclipApiUrl}/${company.companyPrefix}/issues/${issue.identifier}`;
    try {
      await editMessageInChannel(client, channelId, anchorMessageId, {
        embeds: [buildCarouselAnchorEmbed({ issueUrl, status: "expired" })],
        components: [],
      });
      state[interaction.id] = { ...record, lastRenderedStatus: "expired" };
    } catch (err) {
      ctx.logger.warn("confirmation-sweep: failed to edit anchor to expired — will retry next sweep", {
        companyId: company.companyId,
        interactionId: interaction.id,
        anchorMessageId,
        error: String(err),
      });
    }
  }
}

// Post the trailer/anchor message (decision embed + accept/reject buttons)
// for an already-fully-sectioned carousel-batch interaction and persist the
// updated record. Needs only ids/counts already on `record` — never the
// parsed artifact. Returns true on success (state persisted), false on
// failure (caller stops; next sweep retries).
async function postCarouselTrailer(
  ctx: PluginContext,
  client: Client,
  channelId: string,
  companyId: string,
  issue: PaperclipIssue,
  interaction: PaperclipInteraction,
  issueUrl: string,
  record: CarouselBatchSweepRecord,
  state: CarouselBatchSweepState,
  now: number,
): Promise<boolean> {
  try {
    const hash8 = record.artifactHash.slice(0, CAROUSEL_HASH_TOKEN_LEN);
    const messageId = await postEmbedsToChannel(
      client,
      channelId,
      [buildCarouselAnchorEmbed({ issueUrl, status: "awaiting" })],
      [buildCarouselConfirmationActionRow(issue.id, interaction.id, hash8)],
    );
    state[interaction.id] = {
      ...record,
      trailerPosted: true,
      postedAt: new Date(now).toISOString(),
      trailerMessageId: messageId,
      anchorMessageId: messageId,
      lastRenderedStatus: "awaiting",
    };
    return true;
  } catch (err) {
    ctx.logger.warn("confirmation-sweep: carousel-batch trailer post failed — will retry next sweep", {
      companyId,
      interactionId: interaction.id,
      error: String(err),
    });
    return false;
  }
}

// Post one carousel section: slide embeds (chunked for Discord's ≤10-per-message
// limit, elision-capped at SECTION_EMBED_ELISION_CAP) THEN one plain-text caption
// message. Returns false if any post failed (caller stops resume there).
// Invariant: rendered embed count === section.slideUrls.length OR an explicit
// "+N more slides not shown" line is posted — an image is never silently dropped.
async function postCarouselSection(
  ctx: PluginContext,
  client: Client,
  channelId: string,
  companyId: string,
  interactionId: string,
  issueUrl: string,
  section: CarouselSection,
): Promise<boolean> {
  const allEmbeds = renderCarouselSlideEmbeds(section);
  const elided = allEmbeds.length > SECTION_EMBED_ELISION_CAP;
  const embedsToPost = elided ? allEmbeds.slice(0, SECTION_EMBED_ELISION_CAP) : allEmbeds;

  const chunks = chunkEmbedsForDiscord(embedsToPost);
  try {
    for (const chunk of chunks) {
      await postEmbedsToChannel(client, channelId, chunk);
    }
  } catch (err) {
    ctx.logger.warn("confirmation-sweep: carousel section embed post failed", {
      companyId,
      interactionId,
      section: section.slug,
      error: String(err),
    });
    return false;
  }

  const captionLines = [`**${section.index}. ${section.slug} (${section.day})**`];
  if (section.caption) captionLines.push(section.caption);
  if (elided) {
    const remaining = allEmbeds.length - embedsToPost.length;
    captionLines.push(`+${remaining} more slides not shown — ${issueUrl}`);
  }

  try {
    await postToChannel(client, channelId, truncate(stripSecrets(captionLines.join("\n")), CONTENT_CHUNK_MAX));
  } catch (err) {
    ctx.logger.warn("confirmation-sweep: carousel section caption post failed", {
      companyId,
      interactionId,
      section: section.slug,
      error: String(err),
    });
    return false;
  }

  return true;
}

// UNSTRUCTURED DEGRADE entry point (kills failure 2's blind spot — see
// buildUnstructuredDegradeSection doc in ./render/carousel-batch.ts): a
// carousel-titled issue whose interaction matched NEITHER the structured
// payload contract NOR the legacy heading regex. Renders as a single
// synthetic section carrying every image found in the raw text plus a loud
// warning caption — reuses postCarouselBatch's full resume/hash/anchor
// machinery (same idempotency guarantees as the other two paths) rather than
// duplicating it.
async function postUnstructuredCarouselDegrade(
  ctx: PluginContext,
  client: Client,
  channelId: string,
  company: DiscordFleetConfig["companies"][number],
  issue: PaperclipIssue,
  interaction: PaperclipInteraction,
  detailsMarkdown: string,
  state: CarouselBatchSweepState,
  now: number,
): Promise<void> {
  await postCarouselBatch(
    ctx, client, channelId, company, issue, interaction,
    sha256(detailsMarkdown),
    () => {
      const section = buildUnstructuredDegradeSection(detailsMarkdown);
      return { sections: [section], totalImagesFound: section.slideUrls.length, wasCapFallback: false };
    },
    "unstructured-degrade",
    state, now,
  );
}

/**
 * Sweep backlog/todo issues for pending `request_confirmation` interactions and
 * post them to the configured Discord channel so publish gates are visible
 * without opening the Paperclip UI.
 *
 * Config shape (CHANGE 4):
 *   confirmationSweep: {
 *     "<companyId>": [{ "titleRegex": "...", "channelId": "..." }]
 *   }
 *
 * Re-posts at most every 24h per interaction. No buttons needed for the
 * generic path — the purpose is visibility, not actioning from Discord.
 *
 * Carousel-batch shape detection: when an interaction's detailsMarkdown
 * matches the `**N. slug (Day)**` section-heading pattern, the sweep takes a
 * separate rendering path (postCarouselBatch) — one embed per slide instead
 * of a single first-image embed, plus accept/reject-with-reason buttons on a
 * trailer message. All other interaction kinds/shapes are UNCHANGED.
 */
export async function runConfirmationSweep(
  ctx: PluginContext,
  getClient: (companyId: string) => Client | null,
  config: DiscordFleetConfig,
  paperclipFactory: (companyId: string) => Promise<PaperclipClient>,
): Promise<void> {
  const sweepConfig = config.confirmationSweep;
  if (!sweepConfig) return;

  for (const company of config.companies) {
    const rules = sweepConfig[company.companyId];
    if (!rules || rules.length === 0) continue;

    const client = getClient(company.companyId);
    if (!client) continue;

    const paperclip = await paperclipFactory(company.companyId);

    let issues: PaperclipIssue[] = [];
    try {
      issues = await paperclip.getOpenIssues(company.companyId);
    } catch (err) {
      ctx.logger.warn("confirmation-sweep: failed to fetch issues", { companyId: company.companyId, error: String(err) });
      continue;
    }

    const stateKey = { scopeKind: "company" as const, scopeId: company.companyId, stateKey: CONFIRMATION_SWEEP_STATE_KEY };
    const posted = ((await ctx.state.get(stateKey)) as SweepState | null) ?? {};
    const carouselStateKey = { scopeKind: "company" as const, scopeId: company.companyId, stateKey: CAROUSEL_BATCH_SWEEP_STATE_KEY };
    const carouselState = ((await ctx.state.get(carouselStateKey)) as CarouselBatchSweepState | null) ?? {};
    const now = Date.now();

    for (const rule of rules) {
      let regex: RegExp;
      try {
        regex = new RegExp(rule.titleRegex);
      } catch {
        ctx.logger.warn("confirmation-sweep: invalid titleRegex, skipping rule", { companyId: company.companyId, titleRegex: rule.titleRegex });
        continue;
      }

      const matchedIssues = issues.filter((i) => regex.test(safeStr(i.title, 512)));

      for (const issue of matchedIssues) {
        let interactions: PaperclipInteraction[] = [];
        try {
          interactions = await paperclip.listIssueInteractions(issue.id);
        } catch (err) {
          ctx.logger.warn("confirmation-sweep: failed to fetch interactions", { companyId: company.companyId, issueId: issue.id, error: String(err) });
          continue;
        }

        // Resolved-reconcile: interactions that left "pending" WITHOUT a
        // button click (i.e. expired server-side) never reappear in
        // pendingConfirmations below — this is the only pass that revisits
        // them, so their anchor doesn't sit stuck on "awaiting" forever.
        await reconcileResolvedCarouselAnchors(ctx, client, rule.channelId, company, issue, interactions, carouselState);

        const pendingConfirmations = interactions.filter(
          (i) => i.kind === "request_confirmation" && i.status === "pending",
        );

        for (const interaction of pendingConfirmations) {
          try {
          const issueUrl = `${company.paperclipApiUrl}/${company.companyPrefix}/issues/${issue.identifier}`;
          // interaction.payload is Record<string,unknown> — guard against non-string detailsMarkdown.
          // Fall back to payload.prompt (string) when detailsMarkdown is absent or empty, as the
          // interactions schema requires prompt and agents may omit detailsMarkdown.
          const rawDetails = interaction.payload?.detailsMarkdown;
          const rawPrompt = interaction.payload?.prompt;
          const detailsMarkdown =
            typeof rawDetails === "string" && rawDetails.trim()
              ? rawDetails.trim()
              : typeof rawPrompt === "string" && rawPrompt.trim()
                ? rawPrompt.trim()
                : "";

          // Carousel-batch detection happens BEFORE the generic 24h `posted`
          // throttle below (codex round-3 P2, PR #27): a carousel interaction
          // migrating from the OLD generic sweep can already carry a `posted`
          // marker from when it was rendered as a 1-of-N generic card.
          // Consulting that marker here would `continue` past the new
          // renderer for up to 24h — exactly the deploy-day case this PR
          // exists to fix. Once an interaction is carousel-shaped, it is
          // governed ONLY by carouselState (postCarouselBatch's own resume/
          // hash idempotency) — the generic `posted` marker for it is ignored
          // permanently, not just this tick.
          //
          // Detection order (STRUCTURED PAYLOAD CONTRACT — kills the
          // "regex-on-LLM-prose" failure class, 2026-07-11 live incident: the
          // publisher wrote `## akihabara (Sat)` instead of the documented
          // `**1. akihabara (Sat)**`; SECTION_HEADING_RE missed it and the
          // sweep fell to the generic path, which strips ALL image lines —
          // zero slides, zero buttons):
          //   1. payload.carouselBatch?.version === 1 → render from DATA,
          //      never touches detailsMarkdown/regex at all.
          //   2. legacy SECTION_HEADING_RE match on detailsMarkdown (old
          //      cards, or a carouselState record already proving this
          //      interaction was identified as carousel-batch on a prior
          //      sweep — skips re-running the regex once shape is settled).
          //   3. neither matched, but the MATCHING rule is flagged
          //      `carouselBatch: true` (operator-configured discriminator —
          //      the rule that matched this issue's title is already known
          //      by this point in the loop; no second hardcoded title
          //      pattern needed) → unstructured-degrade: a contract miss must
          //      be VISIBLE, never blind. Renders with images intact (never
          //      stripImageLines for a carousel-batch rule) plus a loud
          //      "⚠ unstructured artifact" warning line.

          // STALENESS GATE (cheap skip before the parse+hash work below):
          // once a carousel-batch record is fully posted AND the interaction's
          // server-side updatedAt hasn't moved since the last tick that ran
          // the full path, there is nothing new to detect — every steady-state
          // tick would otherwise re-run parseCarouselBatchPayload/
          // parseCarouselBatchMarkdown/JSON.stringify/sha256 for NO reason.
          // First-seen or changed updatedAt always falls through to the full
          // path below (and that path updates lastSeenUpdatedAt once it does).
          const existingRecord = carouselState[interaction.id];
          const fullyPosted = Boolean(
            existingRecord &&
              existingRecord.headerPosted &&
              existingRecord.trailerPosted &&
              existingRecord.sectionsPosted >= existingRecord.totalSections,
          );
          if (fullyPosted && existingRecord!.lastSeenUpdatedAt === interaction.updatedAt) {
            continue;
          }

          const structuredPayload = parseCarouselBatchPayload(interaction.payload?.carouselBatch);
          const knownCarousel = Boolean(carouselState[interaction.id]);
          const legacyMatches = detailsMarkdown && (knownCarousel || looksLikeCarouselBatch(detailsMarkdown));

          if (structuredPayload) {
            // SINGLE HASH SOURCE (codex P1, PR #27 round 4): carouselArtifactHash
            // is the SAME function the button/modal handlers call at click time
            // (isCurrentVersion) — the sweep and the click-guard now compute
            // the customId version token identically, so they can never drift.
            await postCarouselBatch(
              ctx, client, rule.channelId, company, issue, interaction,
              carouselArtifactHash(interaction),
              () => carouselBatchFromStructuredPayload(structuredPayload),
              "structured",
              carouselState, now,
            );
            continue;
          }

          if (legacyMatches) {
            await postCarouselBatch(
              ctx, client, rule.channelId, company, issue, interaction,
              sha256(detailsMarkdown),
              () => parseCarouselBatchMarkdown(detailsMarkdown),
              "legacy",
              carouselState, now,
            );
            continue;
          }

          if (rule.carouselBatch) {
            await postUnstructuredCarouselDegrade(ctx, client, rule.channelId, company, issue, interaction, detailsMarkdown, carouselState, now);
            continue;
          }

          // Generic path only: safeParseMs turns a corrupted stored timestamp
          // into null ("never posted") instead of NaN silently bypassing the
          // 24h throttle.
          const lastPosted = safeParseMs(posted[interaction.id]);
          if (lastPosted !== null && now - lastPosted < RETHRESHOLD_MS) continue;

          const imageUrl = detailsMarkdown ? extractFirstImageUrl(detailsMarkdown) : null;
          const bodyText = detailsMarkdown ? stripImageLines(detailsMarkdown) : "";

          const embed = enforceEmbedLimits({
            color: 0x5865f2,
            title: stripSecrets(truncate(`🔔 Awaiting confirmation: ${issue.title}`, 256)),
            url: issueUrl,
            description: stripSecrets(`[View in Paperclip](${issueUrl})`),
            timestamp: new Date(now).toISOString(),
            ...(imageUrl ? { image: { url: imageUrl } } : {}),
          });

          try {
            await postEmbedToChannel(client, rule.channelId, embed);
            ctx.logger.info("confirmation-sweep: posted interaction", {
              companyId: company.companyId,
              issueId: issue.id,
              interactionId: interaction.id,
              channelId: rule.channelId,
            });
          } catch (err) {
            ctx.logger.warn("confirmation-sweep: failed to post embed", { companyId: company.companyId, interactionId: interaction.id, error: String(err) });
            continue;
          }

          // Post the markdown body (minus image lines) chunked after the embed.
          // The throttle marker is written ONLY when every chunk succeeded — a
          // partial card (embed without its body) stays eligible for a full
          // re-post on the next sweep instead of sitting unreadable for 24h.
          let allChunksSent = true;
          if (bodyText) {
            const chunks = chunkBySection(stripSecrets(bodyText));
            for (const chunk of chunks) {
              try {
                await postToChannel(client, rule.channelId, truncate(chunk, CONTENT_CHUNK_MAX));
              } catch (err) {
                allChunksSent = false;
                ctx.logger.warn("confirmation-sweep: body chunk post failed — card stays eligible for re-post next sweep", { companyId: company.companyId, interactionId: interaction.id, error: String(err) });
              }
            }
          }

          if (allChunksSent) {
            posted[interaction.id] = new Date(now).toISOString();
          }
          // Deliberate tradeoff: while chunks persistently fail (usually a
          // channel-wide Discord fault), the embed re-posts each sweep — a
          // visible symptom is preferred over a silently unreadable card.
          } catch (err) {
            ctx.logger.warn("confirmation-sweep: unexpected error processing interaction; skipping", {
              companyId: company.companyId,
              issueId: issue.id,
              interactionId: interaction.id,
              error: String(err),
            });
          }
        }
      }
    }

    await ctx.state.set(stateKey, posted);
    await ctx.state.set(carouselStateKey, carouselState);
  }
}
