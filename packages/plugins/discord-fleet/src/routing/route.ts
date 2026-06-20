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
