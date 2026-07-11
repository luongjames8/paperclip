import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { activityLog } from "@paperclipai/db";
import { PLUGIN_EVENT_TYPES, type PluginEventType } from "@paperclipai/shared";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import { publishLiveEvent } from "./live-events.js";
import { redactCurrentUserValue } from "../log-redaction.js";
import { sanitizeRecord } from "../redaction.js";
import { logger } from "../middleware/logger.js";
import type { PluginEventBus } from "./plugin-event-bus.js";
import { instanceSettingsService } from "./instance-settings.js";
import { resolveVerifiedRunId } from "./run-id-trust.js";

const PLUGIN_EVENT_SET: ReadonlySet<string> = new Set(PLUGIN_EVENT_TYPES);
const ACTIVITY_ACTION_TO_PLUGIN_EVENT: Readonly<Record<string, PluginEventType>> = {
  issue_comment_added: "issue.comment.created",
  issue_comment_created: "issue.comment.created",
  issue_document_created: "issue.document.created",
  issue_document_updated: "issue.document.updated",
  issue_document_deleted: "issue.document.deleted",
  issue_blockers_updated: "issue.relations.updated",
  approval_approved: "approval.decided",
  approval_rejected: "approval.decided",
  approval_revision_requested: "approval.decided",
  budget_soft_threshold_crossed: "budget.incident.opened",
  budget_hard_threshold_crossed: "budget.incident.opened",
  budget_incident_resolved: "budget.incident.resolved",
};

let _pluginEventBus: PluginEventBus | null = null;

/** Wire the plugin event bus so domain events are forwarded to plugins. */
export function setPluginEventBus(bus: PluginEventBus): void {
  if (_pluginEventBus) {
    logger.warn("setPluginEventBus called more than once, replacing existing bus");
  }
  _pluginEventBus = bus;
}

function eventTypeForActivityAction(action: string): PluginEventType | null {
  if (PLUGIN_EVENT_SET.has(action)) return action as PluginEventType;
  return ACTIVITY_ACTION_TO_PLUGIN_EVENT[action.replaceAll(".", "_")] ?? null;
}

export function publishPluginDomainEvent(event: PluginEvent): void {
  if (!_pluginEventBus) return;
  void _pluginEventBus.emit(event).then(({ errors }) => {
    for (const { pluginId, error } of errors) {
      logger.warn({ pluginId, eventType: event.eventType, err: error }, "plugin event handler failed");
    }
  }).catch(() => {});
}

export interface LogActivityInput {
  companyId: string;
  actorType: "agent" | "user" | "system" | "plugin";
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentId?: string | null;
  runId?: string | null;
  details?: Record<string, unknown> | null;
}

export async function logActivity(db: Db, input: LogActivityInput) {
  const currentUserRedactionOptions = {
    enabled: (await instanceSettingsService(db).getGeneral()).censorUsernameInLogs,
  };
  const sanitizedDetails = input.details ? sanitizeRecord(input.details) : null;
  const redactedDetails = sanitizedDetails
    ? redactCurrentUserValue(sanitizedDetails, currentUserRedactionOptions)
    : null;
  // Guard: runId flows in here straight from the caller-supplied
  // X-Paperclip-Run-Id request header (via getActorInfo → actor.runId), with
  // NO validation anywhere upstream — the header is a bare string an agent
  // sets on every mutating call (AGENTS.md mandates it). activityLog.runId is
  // a Postgres uuid column AND a foreign key into heartbeat_runs — either a
  // malformed (non-uuid) value OR a well-formed-but-stale/nonexistent uuid
  // throws "invalid input syntax for type uuid" / a foreign key violation
  // from the driver, uncaught, turning into a bare HTTP 500 on the ENTIRE
  // mutation this logActivity call was just recording — not merely a lost
  // log row (2026-07-11 live incident: the openclaw agent's comment/
  // issue-create POSTs 500'd twice WITH the header set and succeeded
  // immediately after removing it). resolveVerifiedRunId does a single
  // indexed existence check and drops anything that isn't a real
  // heartbeat_runs row to null (with a warning) rather than let a
  // diagnostic header crash the real mutation — the documented-correct
  // behavior (sending the header) must never be worse than the undocumented
  // workaround (omitting it).
  const safeRunId = await resolveVerifiedRunId(db, input.runId);
  if (input.runId && !safeRunId) {
    logger.warn({ runId: input.runId, action: input.action }, "logActivity: runId is not a valid/known heartbeat run — dropping to null instead of crashing the mutation");
  }
  await db.insert(activityLog).values({
    companyId: input.companyId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    agentId: input.agentId ?? null,
    runId: safeRunId,
    details: redactedDetails,
  });

  publishLiveEvent({
    companyId: input.companyId,
    type: "activity.logged",
    payload: {
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      agentId: input.agentId ?? null,
      runId: safeRunId,
      details: redactedDetails,
    },
  });

  const pluginEventType = eventTypeForActivityAction(input.action);
  if (pluginEventType) {
    const event: PluginEvent = {
      eventId: randomUUID(),
      eventType: pluginEventType,
      occurredAt: new Date().toISOString(),
      actorId: input.actorId,
      actorType: input.actorType,
      entityId: input.entityId,
      entityType: input.entityType,
      companyId: input.companyId,
      payload: {
        ...redactedDetails,
        action: input.action,
        agentId: input.agentId ?? null,
        runId: safeRunId,
      },
    };
    publishPluginDomainEvent(event);
  }

  // For actions in PLUGIN_EVENT_SET, this emits a SECOND event with eventType "activity.logged"
  // (in addition to the typed event above). Plugins that subscribe to both will receive
  // duplicates and must dedupe by checking eventType. Plugins should generally subscribe to
  // EITHER typed events OR activity.logged (with action-string demux), not both.
  if (_pluginEventBus) {
    const catchAllEvent: PluginEvent = {
      eventId: randomUUID(),
      eventType: "activity.logged" as PluginEventType,
      occurredAt: new Date().toISOString(),
      actorId: input.actorId,
      actorType: input.actorType,
      entityId: input.entityId,
      entityType: input.entityType,
      companyId: input.companyId,
      payload: {
        ...(redactedDetails ?? {}),
        action: input.action,
        agentId: input.agentId ?? null,
        runId: safeRunId,
      },
    };
    void _pluginEventBus.emit(catchAllEvent).then(({ errors }) => {
      for (const { pluginId, error } of errors) {
        logger.warn({ pluginId, eventType: catchAllEvent.eventType, err: error }, "plugin event handler failed");
      }
    }).catch(() => {});
  }
}
