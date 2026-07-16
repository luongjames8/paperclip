import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient, PaperclipIssue, PaperclipInteraction } from "../api/paperclip.js";
import { postEmbedToChannel, postEmbedsToChannel, postToChannel, editMessageInChannel, findRecentMessageWithCustomId } from "../discord/rest.js";
import {
  enforceEmbedLimits,
  buildCarouselConfirmationActionRow,
  buildCarouselAnchorEmbed,
  carouselConfirmAcceptCustomId,
  CAROUSEL_HASH_TOKEN_LEN,
  type CarouselAnchorStatus,
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
  //
  // INVARIANT (codex round-6 class-closer): this field only ever points at
  // the CURRENT generation's anchor — set solely when a trailer is posted
  // (or probe-adopted) for record.artifactHash, and DROPPED on every
  // generation change (hash change, zero-item revision, carousel-shape
  // loss). An anchor belonging to a retired generation lives in
  // staleAnchors below until its "superseded" edit lands; it never occupies
  // this field, so the resolved-reconcile pass can never repaint an old
  // card as the current decision card.
  anchorMessageId?: string;
  // The channel the current anchor was POSTED in. Every later edit of the
  // anchor (supersede, terminal reconcile) targets this channel — never the
  // channel of whichever sweep rule happens to be iterating, which can
  // differ when multiple rules match the same issue or a rule's channelId
  // is reconfigured. Absent on records from before this field existed
  // (edits fall back to the sweeping rule's channelId — prior behavior).
  anchorChannelId?: string;
  // RETIREMENT QUEUE: anchors of PRIOR generations whose "superseded" edit
  // has not succeeded yet (the edit failed transiently, or a lost-response
  // trailer was probe-recovered after its generation was already retired).
  // Drained by reconcileResolvedCarouselAnchors every tick — each entry is
  // re-attempted until its edit lands, then removed. This is what makes
  // "anchors of non-current generations are eventually rendered superseded"
  // TRUE BY CONSTRUCTION rather than best-effort-once: a transient Discord
  // failure can never permanently strand an old anchor with live buttons
  // (codex round-6 P2 ×3: zero-item retry, generic-fallback supersede,
  // reconcile-vs-superseded-anchor).
  staleAnchors?: Array<{ messageId: string; channelId: string }>;
  // Stamped immediately BEFORE each trailer send. Presence with
  // trailerPosted still false means a prior send's outcome is UNKNOWN (the
  // send threw, but Discord may have created the message — timeout-after-
  // send). The next trailer attempt then PROBES the channel for a message
  // carrying this generation's accept-button customId and ADOPTS it instead
  // of posting a duplicate live-button anchor.
  trailerAttemptedAt?: string;
  // Last status rendered onto the anchor by SWEEP-driven edits
  // ("awaiting" | "superseded" | "expired" | "accepted" | "rejected" |
  // "cancelled"). A Discord-button accept/reject ALSO renders the anchor
  // directly via the button handler's own interaction.message reference
  // (renderAnchorResolved) without going through this field — but that
  // in-Discord path is never the only way a decision can be made: an
  // accept/reject/cancel made from the Paperclip web UI/API leaves the
  // Discord anchor showing stale "Decision needed" buttons forever unless
  // something else catches it. reconcileResolvedCarouselAnchors (below) is
  // that catch-all: for ANY non-pending terminal status whose value here
  // doesn't already match, it edits the anchor and records the match here —
  // guarded by this field so each status transition is rendered at most once
  // regardless of which path (Discord click vs. reconcile sweep) got there
  // first. Absent on records from before this field existed.
  lastRenderedStatus?: "awaiting" | "superseded" | "expired" | "accepted" | "rejected" | "cancelled";
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

      // GENERATION-CHANGE RETIREMENT (codex round-6 P2 ×2): the outgoing
      // generation's anchor is retired via the shared primitive — a failed
      // edit is PARKED in staleAnchors and retried every tick by
      // reconcileResolvedCarouselAnchors, never stamped over (the old code
      // stamped the new hash even when the edit failed, and the hash-change
      // guard above then gated the retry off forever). The successor record
      // deliberately carries NO anchor pointer: a zero-item generation posts
      // nothing, so it HAS no current anchor, and the resolved-reconcile
      // pass must never treat the retired old card as this generation's
      // decision card (it used to repaint it accepted/rejected, undoing the
      // superseded marker on an obsolete batch).
      const staleAnchors = existing
        ? await retireCurrentAnchor(ctx, client, channelId, company.companyId, issue.id, interaction.id, issueUrl, existing)
        : [];

      state[interaction.id] = {
        postedAt: new Date(now).toISOString(),
        sectionsPosted: 0,
        totalSections: 0,
        artifactHash,
        headerPosted: false,
        trailerPosted: false,
        lastSeenUpdatedAt: interaction.updatedAt,
        ...(staleAnchors.length ? { staleAnchors } : {}),
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

  // ANCHOR — retire the PREVIOUS generation's anchor (kills "stacked
  // generations": 2026-07-11 live incident, partial + full renders of the
  // same week both sitting in the channel with nothing marking which was
  // current). The customId version-token check at click time (FIX (a),
  // PR #27) is what prevents a stale accept/reject from TAKING EFFECT, but
  // the visual retirement is no longer best-effort-once: a failed edit is
  // parked in staleAnchors on the successor record and retried every tick
  // until it lands — the old code dropped the old anchor id from state
  // entirely on failure, permanently stranding a live-button card.
  if (hashChanged && existing) {
    const staleAnchors = await retireCurrentAnchor(
      ctx, client, channelId, company.companyId, issue.id, interaction.id, issueUrl, existing,
    );
    if (staleAnchors.length) record.staleAnchors = staleAnchors;
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

// Edit one message to the terminal "superseded" card, stripping its buttons.
// Returns true when the edit landed, false when it failed — the caller MUST
// park a false result in staleAnchors (retried every tick by
// reconcileResolvedCarouselAnchors) rather than dropping it: a swallowed
// failure here used to permanently strand an old anchor with live buttons.
async function supersedeAnchorMessage(
  ctx: PluginContext,
  client: Client,
  channelId: string,
  companyId: string,
  interactionId: string,
  messageId: string,
  issueUrl: string,
): Promise<boolean> {
  try {
    await editMessageInChannel(client, channelId, messageId, {
      embeds: [buildCarouselAnchorEmbed({ issueUrl, status: "superseded" })],
      components: [],
    });
    return true;
  } catch (err) {
    // Unknown Message (10008) / Unknown Channel (10003): the message no
    // longer exists, so it cannot show live buttons — retirement is
    // vacuously complete. Treating this as failure would park the entry to
    // be retried every tick FOREVER against a message that will never come
    // back.
    const code = (err as { code?: unknown })?.code;
    if (code === 10008 || code === 10003) {
      ctx.logger.info("confirmation-sweep: supersede target no longer exists — retirement complete", {
        companyId,
        interactionId,
        anchorMessageId: messageId,
        channelId,
        code,
      });
      return true;
    }
    ctx.logger.warn("confirmation-sweep: supersede edit failed — parked in staleAnchors for retry next sweep", {
      companyId,
      interactionId,
      anchorMessageId: messageId,
      channelId,
      error: String(err),
    });
    return false;
  }
}

// GENERATION-CHANGE RETIREMENT — the single implementation behind all three
// change shapes (artifact hash change, revision down to zero items,
// carousel-shape loss to the generic path). Retires every live-button
// artifact the outgoing generation could have left in the channel:
//   1. carries forward anything already parked in existing.staleAnchors;
//   2. if the outgoing generation's last trailer send was AMBIGUOUS
//      (trailerAttemptedAt set, trailerPosted false — the send threw but the
//      message may have landed), probes the channel for that generation's
//      accept-button customId and treats a found orphan as a live anchor;
//   3. edits the current anchor (and any probed orphan) to "superseded" —
//      an edit that fails is PARKED, not dropped, so it is retried every
//      tick until it lands.
// Anchors already rendered terminal (accepted/rejected/cancelled/expired —
// buttons long stripped) or already superseded are left untouched: repainting
// a decided card as "superseded" would destroy the audit trail.
// Returns the staleAnchors array the SUCCESSOR record must carry.
async function retireCurrentAnchor(
  ctx: PluginContext,
  client: Client,
  fallbackChannelId: string,
  companyId: string,
  issueId: string,
  interactionId: string,
  issueUrl: string,
  existing: CarouselBatchSweepRecord,
): Promise<Array<{ messageId: string; channelId: string }>> {
  // Stored state is untyped JSON — tolerate a malformed container the same
  // way the reconcile drain tolerates malformed entries (a throw here would
  // wedge this interaction's generation changes forever, since nothing
  // repairs the record before the throw recurs).
  const parked = Array.isArray(existing.staleAnchors) ? [...existing.staleAnchors] : [];
  const channelId = existing.anchorChannelId ?? fallbackChannelId;

  const toRetire: string[] = [];
  const currentId = resolveAnchorMessageId(existing);
  if (currentId && (existing.lastRenderedStatus === "awaiting" || existing.lastRenderedStatus === undefined)) {
    toRetire.push(currentId);
  }

  // Lost-response orphan: the outgoing generation attempted a trailer whose
  // outcome is unknown. If it actually landed, it is a live-button anchor
  // this record never learned the id of — probe for it so it gets retired
  // with the rest. DELIBERATE RESIDUAL: this probe runs once, at retirement —
  // an orphan it fails to find (probe error, or buried deeper than the
  // 100-message fetch window within one sweep interval) is not hunted again;
  // its id was never knowable, so it cannot be parked. A click on such a
  // card is still refused by the click-time version-token guard (stale
  // hash), so the residual is a dead-looking card after a triple-rare
  // coincidence, never a wrong decision — not worth a forever-probing ghost
  // queue.
  if (existing.trailerAttemptedAt && !existing.trailerPosted && typeof existing.artifactHash === "string" && existing.artifactHash) {
    const hash8 = existing.artifactHash.slice(0, CAROUSEL_HASH_TOKEN_LEN);
    try {
      const orphanId = await findRecentMessageWithCustomId(
        client,
        channelId,
        carouselConfirmAcceptCustomId(issueId, interactionId, hash8),
      );
      if (orphanId && !toRetire.includes(orphanId)) toRetire.push(orphanId);
    } catch (err) {
      ctx.logger.warn("confirmation-sweep: orphan-anchor probe failed during retirement — skipping", {
        companyId,
        interactionId,
        error: String(err),
      });
    }
  }

  for (const messageId of toRetire) {
    const ok = await supersedeAnchorMessage(ctx, client, channelId, companyId, interactionId, messageId, issueUrl);
    if (!ok && !parked.some((s) => s.messageId === messageId)) {
      parked.push({ messageId, channelId });
    }
  }
  return parked;
}

// request_confirmation interaction status -> the CarouselAnchorStatus the
// anchor should show. Only terminal (non-"pending") statuses are mapped —
// "pending" is intentionally absent (handled by the main sweep loop, not
// this pass) and any unrecognized value falls through to undefined (skip).
const TERMINAL_INTERACTION_STATUS_TO_ANCHOR: Readonly<Record<string, CarouselAnchorStatus | undefined>> = {
  accepted: "accepted",
  rejected: "rejected",
  cancelled: "cancelled",
  expired: "expired",
};

// RESOLVED-RECONCILE (wires every dead terminal anchor status, not just
// "expired"): the main sweep loop only ever considers interactions with
// status === "pending" (see pendingConfirmations below), so once a
// request_confirmation interaction's status leaves "pending" WITHOUT going
// through the carousel-confirmation Discord button handler — i.e. it was
// accepted/rejected/cancelled from the Paperclip web UI/API, or it expired
// server-side — nothing else in this plugin ever revisits its anchor: it
// would sit showing "🟡 awaiting decision" WITH LIVE BUTTONS forever despite
// the decision already being made. This pass catches exactly that gap: for
// every carousel-batch record this sweep knows about (has an
// anchorMessageId) whose interaction is now ANY known non-pending terminal
// status (accepted/rejected/cancelled/expired) and whose anchor hasn't
// already been edited to match (lastRenderedStatus guard), edit the anchor
// in place and strip its buttons, then persist the match so the NEXT tick is
// a no-op. Note: the Discord button handler renders accepted/rejected
// directly via its own interaction.message reference (renderAnchorResolved)
// WITHOUT writing back to this sweep's persisted state, so a Discord-driven
// decision can cause exactly one redundant (but harmless — same terminal
// embed, edit-failure-tolerant either way) re-edit here on the tick right
// after the click, before lastRenderedStatus catches up; every tick after
// that is a true no-op.
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
    let record = state[interaction.id];
    if (!record) continue;
    const issueUrl = `${company.paperclipApiUrl}/${company.companyPrefix}/issues/${issue.identifier}`;

    // RETIREMENT-QUEUE DRAIN: parked supersede edits from prior generation
    // changes (the inline attempt failed transiently). Retried HERE — the
    // one pass that sees every interaction this sweep knows about regardless
    // of status, pending AND terminal — so a stale anchor is still retired
    // even after its interaction leaves "pending" (the main loop would never
    // revisit it). Each entry is re-attempted until its edit lands, then
    // dropped; each entry carries the channel its message was POSTED in.
    if (record.staleAnchors && record.staleAnchors.length > 0) {
      const remaining: Array<{ messageId: string; channelId: string }> = [];
      for (const stale of record.staleAnchors) {
        // Stored state is untyped JSON — a malformed entry must be DROPPED
        // (with a warning), never dereferenced: a throw here sits outside
        // the per-interaction try/catch, would kill the whole company's
        // sweep tick, and would recur every tick since the crash precedes
        // the drain-write that could clear it.
        if (!stale || typeof stale.messageId !== "string" || typeof stale.channelId !== "string") {
          ctx.logger.warn("confirmation-sweep: dropping malformed staleAnchors entry", {
            companyId: company.companyId,
            interactionId: interaction.id,
            entry: JSON.stringify(stale ?? null),
          });
          continue;
        }
        const ok = await supersedeAnchorMessage(
          ctx, client, stale.channelId, company.companyId, interaction.id, stale.messageId, issueUrl,
        );
        if (!ok) remaining.push(stale);
      }
      const { staleAnchors: _drained, ...rest } = record;
      record = remaining.length > 0 ? { ...rest, staleAnchors: remaining } : rest;
      state[interaction.id] = record;
    }

    const anchorStatus = TERMINAL_INTERACTION_STATUS_TO_ANCHOR[interaction.status];
    if (!anchorStatus) continue;

    const anchorMessageId = resolveAnchorMessageId(record);
    if (!anchorMessageId) continue;
    if (record.lastRenderedStatus === anchorStatus) continue;
    // A pointer marked "superseded" is a retired old card, not the current
    // generation's decision card — never repaint it as accepted/rejected
    // (that would resurrect an obsolete batch as the decided one). Only
    // records written before the retirement-queue rewrite can carry this
    // combination; new records drop the pointer on generation change.
    if (record.lastRenderedStatus === "superseded") continue;

    try {
      await editMessageInChannel(client, record.anchorChannelId ?? channelId, anchorMessageId, {
        embeds: [buildCarouselAnchorEmbed({ issueUrl, status: anchorStatus })],
        components: [],
      });
      state[interaction.id] = { ...record, lastRenderedStatus: anchorStatus };
    } catch (err) {
      ctx.logger.warn("confirmation-sweep: failed to edit anchor to resolved status — will retry next sweep", {
        companyId: company.companyId,
        interactionId: interaction.id,
        anchorMessageId,
        status: anchorStatus,
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
  const hash8 = record.artifactHash.slice(0, CAROUSEL_HASH_TOKEN_LEN);
  try {
    // ADOPT-DON'T-DUPLICATE: a prior send for THIS generation threw with an
    // unknown outcome (trailerAttemptedAt stamped, trailerPosted never set —
    // classic timeout-after-send: Discord created the message but the
    // response was lost). Posting again would put TWO live-button anchors
    // with identical version tokens in the channel, both of which the
    // click-time guard would accept. Probe for the already-landed message
    // (matched by this generation's exact accept customId) and adopt it as
    // the anchor instead. A probe failure throws into the catch below —
    // "retry next sweep" is the fail direction, never "assume safe to post".
    if (record.trailerAttemptedAt && !record.trailerPosted) {
      const adoptedId = await findRecentMessageWithCustomId(
        client,
        channelId,
        carouselConfirmAcceptCustomId(issue.id, interaction.id, hash8),
      );
      if (adoptedId) {
        state[interaction.id] = {
          ...record,
          trailerPosted: true,
          postedAt: new Date(now).toISOString(),
          trailerMessageId: adoptedId,
          anchorMessageId: adoptedId,
          anchorChannelId: channelId,
          lastRenderedStatus: "awaiting",
        };
        ctx.logger.info("confirmation-sweep: adopted already-landed trailer from a lost-response send — no duplicate posted", {
          companyId,
          interactionId: interaction.id,
          anchorMessageId: adoptedId,
        });
        return true;
      }
    }

    // Stamp the attempt BEFORE the send — if the send throws after Discord
    // created the message, the next tick sees the ambiguity and probes
    // (above) before ever posting again.
    const attemptedAt = new Date(now).toISOString();
    state[interaction.id] = { ...record, trailerAttemptedAt: attemptedAt };

    const messageId = await postEmbedsToChannel(
      client,
      channelId,
      [buildCarouselAnchorEmbed({ issueUrl, status: "awaiting" })],
      [buildCarouselConfirmationActionRow(issue.id, interaction.id, hash8)],
    );
    state[interaction.id] = {
      ...record,
      trailerAttemptedAt: attemptedAt,
      trailerPosted: true,
      postedAt: new Date(now).toISOString(),
      trailerMessageId: messageId,
      anchorMessageId: messageId,
      anchorChannelId: channelId,
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

          // CAROUSEL OWNERSHIP IS RULE-SCOPED, STATE IS INTERACTION-SCOPED
          // (codex rounds 6-8, one class): when a carouselBatch-flagged
          // sibling rule matches this issue's title, that rule owns this
          // interaction END-TO-END — its own iteration renders it
          // (structured, legacy, or unstructured-degrade always posts
          // SOMETHING for a flagged rule). An UNFLAGGED rule must therefore
          // not touch it AT ALL — not render the structured card into its
          // own channel (broad-rule-first ordering would land the carousel
          // in the wrong channel and the staleness gate would then skip the
          // flagged rule's render entirely), not retire its anchor, and not
          // post the generic image-stripped card. This skip sits ABOVE
          // every detection branch so ownership is decided before any
          // rendering path can run.
          const carouselFlaggedElsewhere =
            !rule.carouselBatch &&
            rules.some((r) => {
              if (!r.carouselBatch) return false;
              try {
                return new RegExp(r.titleRegex).test(safeStr(issue.title, 512));
              } catch {
                return false;
              }
            });
          if (carouselFlaggedElsewhere) continue;

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
          // Legacy-shape match is decided ONLY by the CURRENT detailsMarkdown
          // (codex P2): a knownCarousel interactionId used to also
          // short-circuit straight to the legacy parser, but a revision can
          // remove the structured payload and rewrite detailsMarkdown to
          // something that no longer matches SECTION_HEADING_RE. Forcing the
          // legacy parser in that case makes parseCarouselBatchMarkdown
          // return zero sections, and postCarouselBatch skips posting on
          // zero sections — the operator sees nothing, and (for a
          // carouselBatch-flagged rule) the unstructured-degrade path below
          // never runs. Re-checking the shape every tick is cheap (a single
          // regex .test() on a string already in memory), so there's no
          // reason to special-case "known" interactions here.
          const legacyMatches = detailsMarkdown && looksLikeCarouselBatch(detailsMarkdown);

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

          // BUTTONS BIND TO THE INTERACTION'S OWN CAROUSEL IDENTITY, NEVER TO
          // WHETHER TODAY'S TEXT HAPPENS TO PARSE (live incident: months of
          // buttonless carousel cards). `rule.carouselBatch` alone used to
          // gate the degrade-with-buttons render — an interaction that had
          // ALREADY been rendered as a real carousel (structured or legacy
          // match on a prior tick, proven by a non-sentinel carouselState
          // record) but whose matching rule was never flagged would, on a
          // revision that broke BOTH detectors, fall straight through to the
          // "generic path" below, which posts a single first-image embed with
          // NO components — permanently, since every later tick just re-hits
          // the same 24h-throttled buttonless render. `knownCarousel` makes
          // that impossible: an interaction this sweep has EVER confirmed is
          // a carousel (real content once posted under it, not the ""
          // shape-loss sentinel) always gets the degrade-with-buttons render
          // from here on, independent of the rule flag or this tick's parse
          // outcome. `postUnstructuredCarouselDegrade` → `postCarouselBatch`
          // already retires the outgoing generation's anchor via its own
          // hashChanged handling (the old real hash → this tick's degrade
          // hash), so no separate manual retirement step is needed here.
          const priorRecord = carouselState[interaction.id];
          const knownCarousel = Boolean(priorRecord && priorRecord.artifactHash !== "");

          if (rule.carouselBatch || knownCarousel) {
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
