import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient, PaperclipRoutine, PaperclipRoutineTrigger } from "../api/paperclip.js";
import { postEmbedToChannel } from "../discord/rest.js";
import { buildRoutineHealthEmbed } from "../render/embeds.js";

// How far past its planned nextRunAt a trigger must be before we alert.
// 1 hour gives the scheduler and any retry logic enough slack to fire without
// triggering false positives.
const GRACE_MS = 3_600_000;

export async function runRoutineHealth(
  ctx: PluginContext,
  getClient: (companyId: string) => Client | null,
  config: DiscordFleetConfig,
  paperclipFactory: (companyId: string) => Promise<PaperclipClient>,
): Promise<void> {
  const now = new Date();

  for (const company of config.companies) {
    const client = getClient(company.companyId);
    if (!client) continue;

    let routines: PaperclipRoutine[];
    try {
      const paperclip = await paperclipFactory(company.companyId);
      routines = await paperclip.getRoutines(company.companyId);
    } catch (err) {
      ctx.logger.error("routine-health: failed to fetch routines for company; skipping", {
        companyId: company.companyId,
        err: String(err),
      });
      continue;
    }

    for (const routine of routines) {
      if (routine.status !== "active") continue;

      const scheduleTriggers: PaperclipRoutineTrigger[] = (routine.triggers ?? []).filter(
        (t) => t.kind === "schedule" && t.enabled === true,
      );

      for (const trigger of scheduleTriggers) {
        const nextRunAt = trigger.nextRunAt ? new Date(trigger.nextRunAt) : null;

        // Missing or invalid nextRunAt on an enabled schedule trigger → misconfigured
        if (!nextRunAt || isNaN(nextRunAt.getTime())) {
          const embed = buildRoutineHealthEmbed({
            routineName: routine.title,
            missedAt: null,
            misconfigured: true,
          });
          try {
            await postEmbedToChannel(client, company.channels.errors, embed);
          } catch (err) {
            ctx.logger.error("routine-health: failed to post misconfigured embed; continuing", {
              companyId: company.companyId,
              routineId: routine.id,
              err: String(err),
            });
          }
          continue;
        }

        // nextRunAt is in the future → scheduler hasn't missed it yet; no alert
        if (nextRunAt > now) continue;

        // nextRunAt is in the past but within grace → still catching up; no alert
        const deadline = new Date(nextRunAt.getTime() + GRACE_MS);
        if (now <= deadline) continue;

        // Scheduler missed its own planned fire — alert
        const embed = buildRoutineHealthEmbed({
          routineName: routine.title,
          missedAt: nextRunAt,
          misconfigured: false,
        });
        try {
          await postEmbedToChannel(client, company.channels.errors, embed);
        } catch (err) {
          ctx.logger.error("routine-health: failed to post embed for company; continuing", {
            companyId: company.companyId,
            routineId: routine.id,
            err: String(err),
          });
        }
      }
    }
  }
}
