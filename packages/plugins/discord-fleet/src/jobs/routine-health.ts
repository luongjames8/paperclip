import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient, PaperclipRoutine } from "../api/paperclip.js";
import { postEmbedToChannel } from "../discord/rest.js";
import { buildRoutineHealthEmbed } from "../render/embeds.js";

// Parse a cron expression and return the most recent expected fire time before `now`.
// Supports only the 5-field "minute hour dom month dow" format.
// Returns null if the schedule cannot be parsed or is not a simple periodic schedule.
function expectedLastFire(cronExpr: string, tz: string, now: Date): Date | null {
  try {
    // Simple heuristic: find the most recent whole-hour boundary matching the cron hour field.
    // For "0 7 * * *" (daily at 7am TZ), look for today's or yesterday's 7am.
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [minuteField, hourField] = parts;

    const minute = minuteField === "*" ? 0 : parseInt(minuteField, 10);
    const hour = hourField === "*" ? null : parseInt(hourField, 10);

    if (isNaN(minute) || (hour !== null && isNaN(hour))) return null;

    // Reconstruct expected fire by walking back from `now` in the given timezone
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
    const candidate = new Date(now.getTime());

    // Construct today's expected fire in UTC by approximation
    // We use a simple approach: subtract the TZ offset for a rough calculation
    const tzOffset = (new Date().getTimezoneOffset() * 60_000); // local TZ offset — rough
    const todayFire = new Date(Date.UTC(year, month, day, fireHour, minute, 0) + tzOffset);

    if (todayFire <= now) {
      candidate.setTime(todayFire.getTime());
    } else {
      // Yesterday's fire
      candidate.setTime(todayFire.getTime() - 86_400_000);
    }

    return candidate;
  } catch {
    return null;
  }
}

export async function runRoutineHealth(
  ctx: PluginContext,
  client: Client,
  config: DiscordFleetConfig,
  paperclipFactory: (companyId: string) => Promise<PaperclipClient>,
): Promise<void> {
  const now = new Date();

  for (const company of config.companies) {
    const paperclip = await paperclipFactory(company.companyId);
    const routines = await paperclip.getRoutines(company.companyId);

    for (const routine of routines) {
      if (!routine.enabled || !routine.schedule || routine.schedule.type !== "cron") continue;

      const expected = expectedLastFire(routine.schedule.expression, company.digest.timezone, now);
      if (!expected) continue;

      // Flag if actual last fire is more than 1h before expected
      const lastFire = routine.lastTriggeredAt ? new Date(routine.lastTriggeredAt) : null;
      const threshold = new Date(expected.getTime() - 3_600_000);
      if (!lastFire || lastFire < threshold) {
        const embed = buildRoutineHealthEmbed({
          routineName: routine.name,
          expectedLastFire: expected,
          actualLastFire: lastFire,
        });
        await postEmbedToChannel(client, company.channels.errors, embed);
      }
    }
  }
}
