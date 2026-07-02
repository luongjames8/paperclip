import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient, PaperclipRoutine, PaperclipRoutineTrigger } from "../api/paperclip.js";
import { postEmbedToChannel } from "../discord/rest.js";
import { buildRoutineHealthEmbed } from "../render/embeds.js";

// Parse a cron expression and return the most recent expected fire time before `now`.
// Supports only the 5-field "minute hour dom month dow" format.
// Returns null if the schedule cannot be parsed or is not a simple periodic schedule.
export function expectedLastFire(cronExpr: string, tz: string, now: Date): Date | null {
  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [minuteField, hourField] = parts;

    const minute = minuteField === "*" ? 0 : parseInt(minuteField, 10);
    const hour = hourField === "*" ? null : parseInt(hourField, 10);

    if (isNaN(minute) || (hour !== null && isNaN(hour))) return null;

    // Obtain wall-clock parts in the routine's timezone (they are already in target-TZ time).
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });

    const todayParts = formatter.formatToParts(now);
    const get = (type: string) => parseInt(todayParts.find((p) => p.type === type)?.value ?? "0", 10);
    const year = get("year"); const month = get("month") - 1; const day = get("day");
    const nowHour = get("hour"); const nowMin = get("minute");

    const fireHour = hour ?? nowHour;

    // Convert the target-TZ wall time (year, month, day, fireHour, minute) to UTC correctly.
    //
    // Step 1: naiveUtc — treat the TZ-local wall-clock parts as if they were UTC.
    const naiveUtc = Date.UTC(year, month, day, fireHour, minute, 0);

    // Step 2: format naiveUtc back in the target TZ to see what the clock reads there.
    // This reveals the TZ offset at that instant: offsetMs = zonedReading - naiveUtc.
    const refFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const refParts = refFormatter.formatToParts(new Date(naiveUtc));
    const rget = (type: string) => parseInt(refParts.find((p) => p.type === type)?.value ?? "0", 10);
    const rYear = rget("year"); const rMonth = rget("month") - 1; const rDay = rget("day");
    const rHour = rget("hour"); const rMin = rget("minute");
    // offsetMs = how many ms the TZ is ahead of UTC (positive for UTC+N zones like Tokyo UTC+9)
    const offsetMs = Date.UTC(rYear, rMonth, rDay, rHour, rMin, 0) - naiveUtc;

    // Step 3: true UTC = naiveUtc (local wall-clock as UTC) minus the TZ offset.
    // For Tokyo (UTC+9): 07:00 Tokyo - 9h = 22:00 UTC previous day.
    const todayFireUtc = naiveUtc - offsetMs;
    const todayFire = new Date(todayFireUtc);

    if (todayFire <= now) {
      return todayFire;
    }
    // Yesterday's fire: subtract 24h
    return new Date(todayFireUtc - 86_400_000);
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
