import { createHash } from "node:crypto";
import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient, PaperclipIssue, PaperclipInteraction } from "../api/paperclip.js";
import { postEmbedToChannel, postEmbedsToChannel, postToChannel } from "../discord/rest.js";
import { enforceEmbedLimits, buildCarouselConfirmationActionRow } from "../render/embeds.js";
import { chunkEmbedsForDiscord } from "../render/issue-docs.js";
import {
  parseCarouselBatchMarkdown,
  renderCarouselSlideEmbeds,
  type CarouselSection,
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
}
type CarouselBatchSweepState = Record<string, CarouselBatchSweepRecord>;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// A carousel-batch artifact is detected purely by shape: detailsMarkdown
// contains at least one `**N. slug (Day)**` section heading. When it does,
// the sweep takes the carousel-batch path below; otherwise the existing
// generic single-embed path (unchanged) runs.
function looksLikeCarouselBatch(detailsMarkdown: string): boolean {
  return /^\*\*(\d+)\.\s+([\w-]+)\s+\(([^)]+)\)\*\*/m.test(detailsMarkdown);
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

/**
 * Post one carousel-batch pending interaction: header → per-section (slide
 * embeds + caption) → trailer (decision buttons). Resumes from
 * `record.sectionsPosted` on a prior partial failure; re-posts everything
 * when the artifact hash changed (the same interactionId got a new
 * detailsMarkdown, e.g. after a revision cycle).
 *
 * Returns true if the interaction is now fully posted (state should be kept),
 * matching the caller's persistence pattern.
 */
async function postCarouselBatch(
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
  const issueUrl = `${company.paperclipApiUrl}/${company.companyPrefix}/issues/${issue.identifier}`;
  const artifactHash = sha256(detailsMarkdown);
  const existing = state[interaction.id];

  // Fully posted AND hash unchanged: nothing to do.
  if (
    existing &&
    existing.artifactHash === artifactHash &&
    existing.headerPosted &&
    existing.trailerPosted &&
    existing.sectionsPosted >= existing.totalSections
  ) {
    return;
  }

  const parsed = parseCarouselBatchMarkdown(detailsMarkdown);
  const totalSections = parsed.sections.length;

  // Hash changed from a previously (partially or fully) posted record: full
  // re-post — reset the resume record to start from zero.
  const hashChanged = existing && existing.artifactHash !== artifactHash;
  const record: CarouselBatchSweepRecord =
    !existing || hashChanged
      ? { postedAt: new Date(now).toISOString(), sectionsPosted: 0, totalSections, artifactHash, headerPosted: false, trailerPosted: false }
      : { ...existing, totalSections };

  if (!record.headerPosted) {
    const totalImages = parsed.totalImagesFound;
    const headerLines = [
      `🎠 **Carousel batch awaiting confirmation**: ${stripSecrets(truncate(issue.title, 200))}`,
      `${totalSections} carousel(s) · ${totalImages} image(s) total`,
      `[View in Paperclip](${issueUrl})`,
    ];
    if (parsed.wasCapFallback) {
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
    try {
      await postEmbedsToChannel(
        client,
        channelId,
        [
          enforceEmbedLimits({
            color: 0x5865f2,
            title: "Decision needed",
            description: `[View full batch in Paperclip](${issueUrl})`,
          }),
        ],
        [buildCarouselConfirmationActionRow(issue.id, interaction.id)],
      );
      record.trailerPosted = true;
      record.postedAt = new Date(now).toISOString();
      state[interaction.id] = { ...record };
    } catch (err) {
      ctx.logger.warn("confirmation-sweep: carousel-batch trailer post failed — will retry next sweep", {
        companyId: company.companyId,
        interactionId: interaction.id,
        error: String(err),
      });
      return;
    }
  }

  ctx.logger.info("confirmation-sweep: posted carousel-batch interaction", {
    companyId: company.companyId,
    issueId: issue.id,
    interactionId: interaction.id,
    channelId,
    totalSections,
  });
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

        const pendingConfirmations = interactions.filter(
          (i) => i.kind === "request_confirmation" && i.status === "pending",
        );

        for (const interaction of pendingConfirmations) {
          try {
          // safeParseMs: a corrupted stored timestamp becomes null ("never
          // posted") instead of NaN silently bypassing the 24h throttle.
          const lastPosted = safeParseMs(posted[interaction.id]);
          if (lastPosted !== null && now - lastPosted < RETHRESHOLD_MS) continue;

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

          // Carousel-batch shape: take the dedicated multi-slide-embed +
          // accept/reject-buttons path entirely, bypassing the generic
          // single-embed path below. postCarouselBatch owns its own
          // idempotency/resume state (carouselState), not `posted`.
          if (detailsMarkdown && looksLikeCarouselBatch(detailsMarkdown)) {
            await postCarouselBatch(ctx, client, rule.channelId, company, issue, interaction, detailsMarkdown, carouselState, now);
            continue;
          }

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
