import type { Client } from "discord.js";
import type { APIEmbed } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient, PaperclipRoutine, PaperclipRoutineTrigger } from "../api/paperclip.js";
import { postEmbedToChannel } from "../discord/rest.js";
import { buildRoutineHealthEmbed, buildRoutineRunFailedEmbed } from "../render/embeds.js";
import { safeParseMs } from "../util/safe.js";

// How far past its planned nextRunAt a trigger must be before we alert.
// 1 hour gives the scheduler and any retry logic enough slack to fire without
// triggering false positives. Known residual: if the server itself was down
// longer than the grace and this sweep runs within the first scheduler tick
// (~30s) after restart, one catch-up alert can fire spuriously — accepted.
const GRACE_MS = 3_600_000;

// State key for de-duplication — re-alert at most every 24h per alert key
// (same pattern as stuck-detector). Keys: missed:<triggerId>,
// misconfig:<triggerId>, no-assignee:<routineId>, bad-assignee:<routineId>,
// failed-run:<runId>.
export const ROUTINE_HEALTH_STATE_KEY = "routine-health-alerted";
const RETHRESHOLD_MS = 24 * 60 * 60 * 1000;

// Mirrors packages/shared/src/agent-eligibility.ts (ASSIGNABLE minus
// NON_ASSIGNABLE): dispatch throws pre-run for assignees outside this set.
// Mirrored, not imported — the plugin bundle does not depend on the shared
// workspace package. Org-chain health (terminated ancestor / cycle) is the
// one assertAssignableAgent case NOT covered here: it needs the full roster
// graph and stays a documented server-log-only residual.
const ASSIGNABLE_AGENT_STATUSES = new Set(["active", "paused", "idle", "running", "error"]);

type AlertedState = Record<string, string>; // alert key → ISO timestamp of last alert

export async function runRoutineHealth(
  ctx: PluginContext,
  getClient: (companyId: string) => Client | null,
  config: DiscordFleetConfig,
  paperclipFactory: (companyId: string) => Promise<PaperclipClient>,
): Promise<void> {
  const now = new Date();
  let routinesChecked = 0;
  let alertsSent = 0;

  for (const company of config.companies) {
    const client = getClient(company.companyId);
    if (!client) continue;

    let routines: PaperclipRoutine[];
    let agentStatusById: Map<string, string> | null = null;
    try {
      const paperclip = await paperclipFactory(company.companyId);
      routines = await paperclip.getRoutines(company.companyId);
      try {
        agentStatusById = new Map(
          (await paperclip.getAgents(company.companyId)).map((a) => [a.id, a.status ?? ""]),
        );
      } catch (err) {
        // Roster unavailable → skip ONLY the assignee-state checks this sweep
        // (a flaky fetch must not spam misconfigured alerts); log so a dead
        // roster endpoint is still visible.
        ctx.logger.warn("routine-health: failed to fetch agents; assignee-state checks skipped this sweep", {
          companyId: company.companyId,
          err: String(err),
        });
      }
    } catch (err) {
      ctx.logger.error("routine-health: failed to fetch routines for company; skipping", {
        companyId: company.companyId,
        err: String(err),
      });
      continue;
    }

    const stateKey = { scopeKind: "company" as const, scopeId: company.companyId, stateKey: ROUTINE_HEALTH_STATE_KEY };
    const alerted = ((await ctx.state.get(stateKey)) as AlertedState | null) ?? {};

    // Post to the errors channel unless the same alert key fired within the
    // rethreshold. Marks the key only on a successful post so a Discord
    // failure retries on the next sweep.
    // Prune expired dedup entries on load: past the rethreshold a key would
    // re-alert anyway, so dropping it is semantically free and keeps the
    // state blob bounded (~1 day of alert keys instead of unbounded growth).
    for (const [key, ts] of Object.entries(alerted)) {
      const t = safeParseMs(ts);
      if (t === null || now.getTime() - t >= RETHRESHOLD_MS) delete alerted[key];
    }

    const alert = async (alertKey: string, embed: APIEmbed, logCtx: Record<string, unknown>) => {
      const lastAlert = safeParseMs(alerted[alertKey]);
      if (lastAlert !== null && now.getTime() - lastAlert < RETHRESHOLD_MS) return;
      try {
        await postEmbedToChannel(client, company.channels.errors, embed);
      } catch (err) {
        ctx.logger.error("routine-health: failed to post embed; continuing", {
          companyId: company.companyId,
          ...logCtx,
          err: String(err),
        });
        return; // not marked — retries next sweep
      }
      alerted[alertKey] = now.toISOString();
      alertsSent += 1;
      try {
        // Persist immediately (same discipline as stuck-detector): a crash
        // later in the sweep must not forget sent alerts and re-post them.
        await ctx.state.set(stateKey, alerted);
      } catch (err) {
        ctx.logger.error("routine-health: failed to persist dedup state; may re-alert next sweep", {
          companyId: company.companyId,
          ...logCtx,
          err: String(err),
        });
      }
    };

    for (const routine of routines) {
      if (routine.status !== "active") continue;
      routinesChecked += 1;

      const scheduleTriggers: PaperclipRoutineTrigger[] = (routine.triggers ?? []).filter(
        (t) => t.kind === "schedule" && t.enabled === true,
      );

      // A triggered routine with no assignee is invisible-broken: the
      // scheduler advances nextRunAt BEFORE dispatching (and webhook fires
      // dispatch directly), then dispatch throws "Default agent required"
      // before any run row exists (server/src/services/routines.ts) — so
      // nextRunAt alone can never expose this. Detect it statically for ANY
      // enabled trigger kind. (Residual gap: an assignee that exists but is
      // terminated / has a broken org chain also throws pre-run; that state
      // lives in agent records this plugin does not fetch, and is only
      // visible in server logs.)
      const hasEnabledTrigger = (routine.triggers ?? []).some((t) => t.enabled === true);
      if (hasEnabledTrigger && !routine.assigneeAgentId) {
        await alert(
          `no-assignee:${routine.id}`,
          buildRoutineHealthEmbed({
            routineName: routine.title,
            missedAt: null,
            misconfigured: true,
            detail:
              "Routine has no assignee — every triggered dispatch fails before a run is created (and can abort the scheduler tick for other routines). Set a default agent.",
          }),
          { routineId: routine.id },
        );
      }

      // An assignee that exists but is not assignable (terminated /
      // pending_approval / not in the roster) throws in assertAssignableAgent
      // pre-run — the same invisible-miss class as no-assignee.
      if (hasEnabledTrigger && routine.assigneeAgentId && agentStatusById) {
        const status = agentStatusById.get(routine.assigneeAgentId);
        if (status === undefined || !ASSIGNABLE_AGENT_STATUSES.has(status)) {
          await alert(
            `bad-assignee:${routine.id}`,
            buildRoutineHealthEmbed({
              routineName: routine.title,
              missedAt: null,
              misconfigured: true,
              detail: `Routine assignee ${routine.assigneeAgentId} is ${
                status === undefined ? "not in the company roster" : `status=${status} (not assignable)`
              } — every triggered dispatch fails before a run is created. Reassign the routine.`,
            }),
            { routineId: routine.id, assigneeAgentId: routine.assigneeAgentId },
          );
        }
      }

      // A failed most-recent run is the API-visible trace of a dispatch that
      // died mid-flight (issue creation / wake queue). Alert once per run id.
      // Deliberately independent of the no-assignee alert above — they report
      // different facts (config vs outcome) and can legitimately coexist.
      if (routine.lastRun?.status === "failed") {
        await alert(
          `failed-run:${routine.lastRun.id}`,
          buildRoutineRunFailedEmbed({
            routineName: routine.title,
            runId: routine.lastRun.id,
            failureReason: routine.lastRun.failureReason,
          }),
          { routineId: routine.id, runId: routine.lastRun.id },
        );
      }

      for (const trigger of scheduleTriggers) {
        const nextRunAt = trigger.nextRunAt ? new Date(trigger.nextRunAt) : null;

        // Missing or invalid nextRunAt on an enabled schedule trigger → misconfigured
        if (!nextRunAt || isNaN(nextRunAt.getTime())) {
          await alert(
            `misconfig:${trigger.id}`,
            buildRoutineHealthEmbed({ routineName: routine.title, missedAt: null, misconfigured: true }),
            { routineId: routine.id, triggerId: trigger.id },
          );
          continue;
        }

        // nextRunAt is in the future → scheduler hasn't missed it yet; no alert
        if (nextRunAt > now) continue;

        // nextRunAt is in the past but within grace → still catching up; no alert
        const deadline = new Date(nextRunAt.getTime() + GRACE_MS);
        if (now <= deadline) continue;

        // Scheduler missed its own planned fire — alert
        await alert(
          `missed:${trigger.id}`,
          buildRoutineHealthEmbed({ routineName: routine.title, missedAt: nextRunAt, misconfigured: false }),
          { routineId: routine.id, triggerId: trigger.id },
        );
      }
    }
    // No end-of-company flush needed: alert() persists state after every
    // successful post, and non-post sweeps change nothing.
  }

  // Liveness: this monitor was once dead for weeks with nothing to grep for.
  // One line per sweep proves it ran to completion.
  ctx.logger.info("routine-health: sweep complete", {
    companies: config.companies.length,
    routinesChecked,
    alertsSent,
  });
}
