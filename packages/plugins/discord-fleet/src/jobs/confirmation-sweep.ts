import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient, PaperclipIssue, PaperclipInteraction } from "../api/paperclip.js";
import { postEmbedToChannel, postToChannel } from "../discord/rest.js";
import { enforceEmbedLimits } from "../render/embeds.js";
import { stripSecrets } from "../render/secrets.js";
import { truncate } from "../render/plain.js";

// Re-post at most this often per interaction.
const RETHRESHOLD_MS = 24 * 60 * 60 * 1000;
export const CONFIRMATION_SWEEP_STATE_KEY = "confirmation-sweep-posted";

const CONTENT_CHUNK_MAX = 1900;

// State: interactionId → ISO timestamp of last post.
type SweepState = Record<string, string>;

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
 * Sweep backlog/todo issues for pending `request_confirmation` interactions and
 * post them to the configured Discord channel so publish gates are visible
 * without opening the Paperclip UI.
 *
 * Config shape (CHANGE 4):
 *   confirmationSweep: {
 *     "<companyId>": [{ "titleRegex": "...", "channelId": "..." }]
 *   }
 *
 * Re-posts at most every 24h per interaction. No buttons needed — the purpose
 * is visibility, not actioning from Discord.
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
    const now = Date.now();

    for (const rule of rules) {
      let regex: RegExp;
      try {
        regex = new RegExp(rule.titleRegex);
      } catch {
        ctx.logger.warn("confirmation-sweep: invalid titleRegex, skipping rule", { companyId: company.companyId, titleRegex: rule.titleRegex });
        continue;
      }

      const matchedIssues = issues.filter((i) => regex.test(i.title));

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
          const lastPosted = posted[interaction.id] ? Date.parse(posted[interaction.id]) : null;
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
          if (bodyText) {
            const chunks = chunkBySection(stripSecrets(bodyText));
            for (const chunk of chunks) {
              try {
                await postToChannel(client, rule.channelId, truncate(chunk, CONTENT_CHUNK_MAX));
              } catch (err) {
                ctx.logger.warn("confirmation-sweep: body chunk post failed", { companyId: company.companyId, interactionId: interaction.id, error: String(err) });
              }
            }
          }

          posted[interaction.id] = new Date(now).toISOString();
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
  }
}
