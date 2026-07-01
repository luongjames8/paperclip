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

// One auto-expiry rule for a pending approval.
export interface ApprovalExpiryRule {
  // Regex matched against the approval's payload.title.
  titleRegex: string;
  // Age in hours at which the approval is auto-rejected if still pending.
  maxAgeHours: number;
}

// One rule for the confirmation-sweep job.
export interface ConfirmationSweepRule {
  // Regex matched against the issue title.
  titleRegex: string;
  // Discord channel ID to post the confirmation card into.
  channelId: string;
}

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
  // Config-driven auto-expiry for time-sensitive approvals, keyed by companyId.
  // In the approvals-reminder sweep: if a pending approval's title matches a
  // rule's titleRegex AND its age exceeds maxAgeHours, it is auto-rejected
  // with a standard decisionNote. The approval is NOT re-posted as a reminder
  // in the same sweep. Requires the per-company paperclipApiKeySecretRef to be
  // a board key (403 otherwise — logged clearly).
  approvalExpiry?: Record<string, ApprovalExpiryRule[]>;
  // Sweep backlog/todo issues for pending request_confirmation interactions and
  // post them to Discord so publish gates are visible without opening Paperclip.
  // Keyed by companyId; each rule matches issue titles by regex and posts to a
  // fixed channelId. Re-posts at most every 24h per interaction.
  confirmationSweep?: Record<string, ConfirmationSweepRule[]>;
}

export const DEFAULT_DIGEST: DigestConfig = {
  cronExpression: "0 7 * * *",
  timezone: "Asia/Taipei",
};
