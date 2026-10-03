import type { ChannelTypeRoute, CompanyConfig, DiscordFleetConfig } from "../config/schema.js";

export interface RouteResult {
  guildId: string;
  channelId: string;
  companyConfig: CompanyConfig;
}

export function routeIssue(
  config: DiscordFleetConfig,
  companyId: string,
  projectId?: string,
): RouteResult {
  const company = config.companies.find((c) => c.companyId === companyId);
  if (!company) {
    throw new Error(`unknown company: ${companyId}`);
  }

  const channelId =
    projectId !== undefined && projectId in company.projectRouting
      ? company.projectRouting[projectId]
      : company.channels.orphan;

  return {
    guildId: company.guildId,
    channelId,
    companyConfig: company,
  };
}

// First route whose pattern matches any candidate wins (route-major order).
// Invalid regexes are skipped so one bad config row cannot break routing.
export function matchChannelByType(
  routes: ChannelTypeRoute[] | undefined,
  candidates: Array<string | undefined>,
): string | null {
  if (!routes || routes.length === 0) return null;
  for (const [pattern, channelId] of routes) {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      continue;
    }
    for (const value of candidates) {
      if (value && re.test(value)) return channelId;
    }
  }
  return null;
}

// Exact-identification matching for the payload.approvalType discriminator
// pass (codex P2, PR #26): a discriminator is a TOKEN, so a row wins the key
// only when its pattern matches the key WHOLLY. A broad legacy title regex
// (e.g. /batch/) can substring-match the constant's text but will never
// full-match it — so keyed routing cannot depend on config row order, by
// construction, with no separate route set needed. Title matching stays
// substring (matchChannelByType) in the second pass.
export function matchChannelByExactKey(
  routes: ChannelTypeRoute[] | undefined,
  key: string | undefined,
): string | null {
  if (!routes || routes.length === 0 || !key) return null;
  for (const [pattern, channelId] of routes) {
    let re: RegExp;
    try {
      re = new RegExp(`^(?:${pattern})$`);
    } catch {
      continue;
    }
    if (re.test(key)) return channelId;
  }
  return null;
}

// approvalKind routing (fleet issue #687): a plain per-company exact map, not
// a regex table — approvalKind is engine-typed and config-inherited (never
// LLM-composed), so there is nothing to pattern-match against, only a key to
// look up. Shared by handleApprovalCreated and approvals-reminder.ts so the
// lookup can't drift between the two call sites.
export function matchChannelByKind(
  kindChannels: Record<string, Record<string, string>> | undefined,
  companyId: string,
  kind: string,
): string | null {
  if (!kind) return null;
  return kindChannels?.[companyId]?.[kind] ?? null;
}
