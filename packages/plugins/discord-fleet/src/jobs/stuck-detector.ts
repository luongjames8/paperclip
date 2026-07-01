import type { Client } from "discord.js";
import type { APIEmbed } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient, PaperclipIssue } from "../api/paperclip.js";
import { postEmbedToChannel } from "../discord/rest.js";
import { getThreadForIssue } from "../routing/thread-state.js";
import { postEmbedToThread } from "../discord/rest.js";
import { buildStuckIssueEmbed } from "../render/embeds.js";
import { enforceEmbedLimits } from "../render/embeds.js";
import { stripSecrets } from "../render/secrets.js";
import { truncate } from "../render/plain.js";

// State key for de-duplication — re-alert at most every 24h per issue per category.
export const STUCK_DETECTOR_STATE_KEY = "stuck-detector-alerted";
const RETHRESHOLD_MS = 24 * 60 * 60 * 1000;
const MAX_ISSUES_PER_GROUP = 15;

type AlertedState = Record<string, string>; // issueId → ISO timestamp of last alert

function ageHoursFrom(isoDate: string, now: number): number {
  return Math.floor((now - new Date(isoDate).getTime()) / 3_600_000);
}

function issueUrl(company: { paperclipApiUrl: string; companyPrefix: string }, issue: PaperclipIssue): string {
  return `${company.paperclipApiUrl}/${company.companyPrefix}/issues/${issue.identifier}`;
}

// Build a grouped embed that lists up to MAX_ISSUES_PER_GROUP issues with identifier, truncated title, age, and link.
function buildGroupEmbed(
  headline: string,
  color: number,
  issues: Array<{ issue: PaperclipIssue; ageHours: number; url: string }>,
  total: number,
): APIEmbed {
  const lines: string[] = [];
  for (const { issue, ageHours, url } of issues.slice(0, MAX_ISSUES_PER_GROUP)) {
    const title = truncate(issue.title, 60);
    lines.push(`• \`${issue.identifier}\` (${ageHours}h) — ${stripSecrets(title)} — [view](${url})`);
  }
  if (total > MAX_ISSUES_PER_GROUP) {
    lines.push(`+${total - MAX_ISSUES_PER_GROUP} more`);
  }
  return enforceEmbedLimits({
    color,
    title: stripSecrets(headline).slice(0, 256),
    description: lines.join("\n").slice(0, 4096),
    timestamp: new Date().toISOString(),
  });
}

export async function runStuckDetector(
  ctx: PluginContext,
  getClient: (companyId: string) => Client | null,
  config: DiscordFleetConfig,
  paperclipFactory: (companyId: string) => Promise<PaperclipClient>,
): Promise<void> {
  for (const company of config.companies) {
    if (!company.companyPrefix?.trim()) {
      ctx.logger.warn("discord-fleet: companyPrefix missing or empty; skipping company", { companyId: company.companyId });
      continue;
    }
    if (company.stuckIssueThresholdHours < 1) {
      ctx.logger.warn("discord-fleet: stuckIssueThresholdHours < 1 is invalid; skipping company", { companyId: company.companyId });
      continue;
    }
    const client = getClient(company.companyId);
    if (!client) continue;
    const paperclip = await paperclipFactory(company.companyId);
    const now = Date.now();

    // Load de-dup state for all three categories.
    const stateKey = { scopeKind: "company" as const, scopeId: company.companyId, stateKey: STUCK_DETECTOR_STATE_KEY };
    const alerted = ((await ctx.state.get(stateKey)) as AlertedState | null) ?? {};

    // ── Category A: in_progress issues older than threshold (existing behaviour) ──
    const inProgressIssues = await paperclip.getInProgressIssues(company.companyId);
    for (const issue of inProgressIssues) {
      const updatedMs = new Date(issue.updatedAt).getTime();
      const hoursStuck = Math.floor((now - updatedMs) / 3_600_000);
      if (hoursStuck < company.stuckIssueThresholdHours) continue;

      const alertKey = `in_progress:${issue.id}`;
      const lastAlert = alerted[alertKey] ? Date.parse(alerted[alertKey]) : null;
      if (lastAlert !== null && now - lastAlert < RETHRESHOLD_MS) continue;

      const url = issueUrl(company, issue);
      const embed = buildStuckIssueEmbed({
        identifier: issue.identifier,
        title: issue.title,
        hoursStuck,
        assignee: issue.assigneeId,
        issueUrl: url,
      });

      const threadEntry = await getThreadForIssue(ctx, company.companyId, issue.id);
      if (threadEntry) {
        await postEmbedToThread(client, threadEntry.threadId, embed);
      }
      await postEmbedToChannel(client, company.channels.errors, embed);
      alerted[alertKey] = new Date(now).toISOString();
    }

    // ── Category B: blocked issues with no blockedByIssueIds — permanently stranded ──
    let blockedIssues: PaperclipIssue[] = [];
    try {
      blockedIssues = await paperclip.getBlockedIssues(company.companyId);
    } catch (err) {
      ctx.logger.warn("stuck-detector: failed to fetch blocked issues", { companyId: company.companyId, error: String(err) });
    }

    const stranded = blockedIssues.filter((issue) => {
      const ageHours = ageHoursFrom(issue.updatedAt, now);
      if (ageHours < company.stuckIssueThresholdHours) return false;
      const blockers = issue.blockedByIssueIds;
      return !blockers || blockers.length === 0;
    });

    if (stranded.length > 0) {
      const toAlert = stranded.filter((issue) => {
        const alertKey = `blocked_no_blockers:${issue.id}`;
        const lastAlert = alerted[alertKey] ? Date.parse(alerted[alertKey]) : null;
        return lastAlert === null || now - lastAlert >= RETHRESHOLD_MS;
      });
      if (toAlert.length > 0) {
        const items = toAlert.map((issue) => ({
          issue,
          ageHours: ageHoursFrom(issue.updatedAt, now),
          url: issueUrl(company, issue),
        }));
        const embed = buildGroupEmbed(
          `⛔ Blocked with no declared blockers (${toAlert.length} issue${toAlert.length === 1 ? "" : "s"})`,
          0xed4245,
          items,
          toAlert.length,
        );
        await postEmbedToChannel(client, company.channels.errors, embed);
        const now2 = new Date(now).toISOString();
        for (const issue of toAlert) {
          alerted[`blocked_no_blockers:${issue.id}`] = now2;
        }
      }
    }

    // ── Category C: todo issues WITH an assignee older than threshold — lost-assignment wake ──
    let todoIssues: PaperclipIssue[] = [];
    try {
      todoIssues = await paperclip.getAssignedTodoIssues(company.companyId);
    } catch (err) {
      ctx.logger.warn("stuck-detector: failed to fetch todo issues", { companyId: company.companyId, error: String(err) });
    }

    const lostWakes = todoIssues.filter((issue) => {
      const hasAssignee = Boolean(issue.assigneeId ?? issue.assigneeAgentId ?? issue.assigneeUserId);
      if (!hasAssignee) return false;
      const ageHours = ageHoursFrom(issue.updatedAt, now);
      return ageHours >= company.stuckIssueThresholdHours;
    });

    if (lostWakes.length > 0) {
      const toAlert = lostWakes.filter((issue) => {
        const alertKey = `todo_assigned:${issue.id}`;
        const lastAlert = alerted[alertKey] ? Date.parse(alerted[alertKey]) : null;
        return lastAlert === null || now - lastAlert >= RETHRESHOLD_MS;
      });
      if (toAlert.length > 0) {
        const items = toAlert.map((issue) => ({
          issue,
          ageHours: ageHoursFrom(issue.updatedAt, now),
          url: issueUrl(company, issue),
        }));
        const embed = buildGroupEmbed(
          `📋 Assigned todo — no heartbeat wake (${toAlert.length} issue${toAlert.length === 1 ? "" : "s"})`,
          0xffa500,
          items,
          toAlert.length,
        );
        await postEmbedToChannel(client, company.channels.errors, embed);
        const now2 = new Date(now).toISOString();
        for (const issue of toAlert) {
          alerted[`todo_assigned:${issue.id}`] = now2;
        }
      }
    }

    await ctx.state.set(stateKey, alerted);
  }
}
