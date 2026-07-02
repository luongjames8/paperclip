import { parseExpression } from "cron-parser";
import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient, PaperclipRoutine, PaperclipRoutineTrigger } from "../api/paperclip.js";
import { postEmbedToChannel } from "../discord/rest.js";
import { buildRoutineHealthEmbed } from "../render/embeds.js";

// Return the most recent scheduled occurrence strictly before `now` for the given
// cron expression in the given IANA timezone.
// Uses cron-parser (the same library the server's scheduler depends on) so that
// dow/monthly/step expressions all resolve correctly without hand-rolled math.
// Returns null if the expression cannot be parsed.
export function expectedLastFire(cronExpr: string, tz: string, now: Date): Date | null {
  try {
    const interval = parseExpression(cronExpr, { currentDate: now, tz });
    return interval.prev().toDate();
  } catch {
    return null;
  }
}

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
        (t) => t.kind === "schedule" && t.enabled === true && t.cronExpression,
      );

      for (const trigger of scheduleTriggers) {
        const tz = trigger.timezone ?? "UTC";
        const expected = expectedLastFire(trigger.cronExpression!, tz, now);
        if (!expected) continue;

        // Prefer trigger.lastFiredAt, fall back to routine.lastTriggeredAt
        const rawLastFire = trigger.lastFiredAt ?? routine.lastTriggeredAt ?? null;
        const lastFire = rawLastFire ? new Date(rawLastFire as string) : null;

        // Flag if actual last fire is more than 1h before expected
        const threshold = new Date(expected.getTime() - 3_600_000);
        if (!lastFire || lastFire < threshold) {
          const embed = buildRoutineHealthEmbed({
            routineName: routine.title,
            expectedLastFire: expected,
            actualLastFire: lastFire,
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
}
