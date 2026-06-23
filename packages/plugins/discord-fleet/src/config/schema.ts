export interface UserMapping {
  discordUserId: string;
  paperclipUserId: string;
  role: string;
  boardApiKeySecretRef?: string;
}

export interface CompanyChannels {
  digest: string;
  errors: string;
  orphan: string;
}

export interface DigestConfig {
  cronExpression: string;
  timezone: string;
}

export interface CompanyConfig {
  companyId: string;
  companyPrefix: string;
  guildId: string;
  channels: CompanyChannels;
  projectRouting: Record<string, string>;
  userMappings?: UserMapping[];
  digest: DigestConfig;
  stuckIssueThresholdHours: number;
  costEventThresholdCents?: number;
  paperclipApiKeySecretRef: string;
  paperclipApiUrl: string;
  // Optional per-company Discord bot token. When set, this company uses its own
  // Discord bot instead of the root botTokenSecretRef. Multiple companies that
  // resolve to the same token share one Client (Discord rejects duplicate gateway
  // connections for the same token). When absent, falls back to the root token
  // for full backward compatibility.
  botTokenSecretRef?: string;
  // Destination for approvals that don't match any approvalsChannelsByType
  // regex AND aren't co-locatable in an existing work-thread. Distinct from
  // channels.orphan (which is the issue-routing fallback). When absent, the
  // plugin falls back to channels.orphan for backward compat. Keyed
  // per-company so multi-company deployments don't cross-leak approvals.
  approvalFallbackChannelId?: string;
}

export type ChannelTypeRoute = [regex: string, channelId: string];

export interface DiscordFleetConfig {
  botTokenSecretRef: string;
  companies: CompanyConfig[];
  // Per-content-surface routing for seed issues, keyed by companyId. The
  // plugin matches the issue's routine_slug / identifier / title against
  // each regex in order; first match wins. On no match, falls back to
  // routeIssue() (projectRouting → channels.orphan). Replaces per-issue
  // thread spawning.
  issuesChannelsByType?: Record<string, ChannelTypeRoute[]>;
  // Per-content-surface routing for approvals, keyed by companyId. Same
  // semantics as issuesChannelsByType but matched against approval title.
  // On no match, falls back to the company's approvalFallbackChannelId
  // (or channels.orphan if absent — see backward-compat note on
  // CompanyConfig.approvalFallbackChannelId).
  approvalsChannelsByType?: Record<string, ChannelTypeRoute[]>;
}

export const DEFAULT_DIGEST: DigestConfig = {
  cronExpression: "0 7 * * *",
  timezone: "Asia/Taipei",
};
