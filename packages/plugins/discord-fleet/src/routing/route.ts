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

// Discriminator-pass matching (codex P2 rounds, PR #26): the key pass runs
// NO REGEX AT ALL. Only literal-anchored rows — pattern shaped exactly
// ^plain_token$ (letters/digits/_/-) — participate, compared by string
// equality against the key. That is the "split keyed routes from title
// regexes" split expressed without a schema change: literal rows ARE the
// keyed route set by definition. Every capture class dies by construction:
// broad substrings (/batch/), wildcards (/.*/, /.*batch.*/), and ordering
// games cannot match a key because their rows never enter this pass.
// Title matching stays substring regex (matchChannelByType) in pass 2.
const LITERAL_KEY_ROW = /^\^[A-Za-z0-9_-]+\$$/;

export function matchChannelByExactKey(
  routes: ChannelTypeRoute[] | undefined,
  key: string | undefined,
): string | null {
  if (!routes || routes.length === 0 || !key) return null;
  for (const [pattern, channelId] of routes) {
    if (!LITERAL_KEY_ROW.test(pattern)) continue;
    if (pattern.slice(1, -1) === key) return channelId;
  }
  return null;
}
