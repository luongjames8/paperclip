export type TriggerKind = "routine" | "approval" | "issue";

export interface RoutineTrigger {
  kind: "routine";
  routineId: string;
}

export interface ApprovalTrigger {
  kind: "approval";
  // Which approval lifecycle event to listen for. Default "decided" (preserves v0.2 behavior).
  // - "created": fires when approval is first created (use for review-time Discord posts)
  // - "decided": fires when approval status flips to approved/rejected/cancelled (use for downstream actions like Metricool push)
  event?: "created" | "decided";
  // Optional filter — if omitted, fires on any approval. e.g. "request_board_approval".
  approvalType?: string;
  // Optional status filter (only meaningful for event=decided). Default "approved".
  requireStatus?: "approved" | "rejected" | "any";
}

export interface IssueTrigger {
  kind: "issue";
  // Lifecycle event to listen for. "updated" fires on any status change.
  event?: "updated";
  // Optional filter on the new status value (e.g. "done"). If omitted, fires on any status change.
  statusFilter?: string;
  // Optional filter on assignee agent UUID.
  assigneeAgentId?: string;
  // Optional filter on title substring (case-insensitive). Useful when the agent has multiple skill bodies.
  titleContains?: string;
}

export type HelperTrigger = RoutineTrigger | ApprovalTrigger | IssueTrigger;

export interface HelperExec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutSec?: number;
}

export interface HelperOutput {
  documentKey?: string;
  format?: "json" | "markdown" | "raw";
  comment?: boolean;
}

export interface HelperErrorHandling {
  onFailure?: "block_issue" | "cancel_issue" | "noop";
  onTimeout?: "block_issue" | "cancel_issue" | "noop";
}

export interface HelperConfig {
  name: string;
  trigger: HelperTrigger;
  exec: HelperExec;
  output?: HelperOutput;
  errorHandling?: HelperErrorHandling;
  maxConcurrent?: number;
}

export interface PluginConfig {
  helpers: HelperConfig[];
}
