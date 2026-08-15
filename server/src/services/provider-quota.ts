import { parseObject } from "../adapters/utils.js";

// A run's failure-bearing fields. Structural on purpose so both a full
// heartbeatRuns row and recovery's narrower LatestIssueRun satisfy it —
// recovery/service.ts cannot import heartbeat.ts (heartbeat imports recovery),
// which is why this classifier lives in its own module rather than in either.
export type ProviderQuotaRunFields = {
  error?: string | null;
  errorCode?: string | null;
  resultJson?: unknown;
};

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// Provider quota / billing exhaustion is NOT transient: retrying cannot succeed
// until the allowance window resets or the operator tops the account up. GH #706
// (fleet-wide outage 2026-08-07 → 08-15): every failure carried errorCode
// `openclaw_gateway_wait_error`, which is in TRANSIENT_UPSTREAM_ERROR_CODES, so
// 27,080 of 34,064 failed runs in 12 days were `transient_failure_retry` wakes
// against a dead provider. The cause is only visible in the error TEXT — the
// gateway adapter has no quota-specific errorCode — so this classifies on text,
// unlike upstream/master which keys on an adapter-supplied `provider_quota` code.
// Live samples this must match (verified against heartbeat_runs on fsn):
//   "FailoverError: ⚠️ month allocated quota exceeded."
//   "FallbackSummaryError: All models failed (2): bailian/glm-5: 429 month
//    allocated quota exceeded. (rate_limit) | deepseek/deepseek-v4-pro:
//    402 Insufficient Balance (billing) <- ..."
// The first alternatives are ported verbatim from upstream/master's
// PROVIDER_QUOTA_ERROR_RE; `allocated quota`, `insufficient balance`,
// `insufficient credits`, `billing error` and `payment required` cover the
// billing half, which upstream has no case for. Deliberately NOT included:
// "insufficient funds", which is the EVM gas-fee phrase — a fleet agent working
// on a wallet would otherwise park its own run for an hour.
const PROVIDER_QUOTA_ERROR_RE =
  /(?:you(?:'|’)ve hit your usage limit|usage limit(?: reached| exceeded)?|provider quota|quota (?:limit )?exceeded|allocated quota|model (?:is )?at capacity|insufficient balance|insufficient credits?|billing error|payment required)/i;

// The run fields that hold the ADAPTER's own failure text. Deliberately not the
// whole resultJson: that also carries the agent's summary/stdout/stderr, so
// scanning it would classify any run whose transcript merely discusses quotas or
// billing — a fleet agent writing payment code parking itself for an hour is the
// same defect as GH #706 pointed the other way.
function readRunFailureText(
  run: ProviderQuotaRunFields,
  resultJson: Record<string, unknown>,
) {
  return [
    run.errorCode ?? "",
    run.error ?? "",
    readNonEmptyString(resultJson.error) ?? "",
    readNonEmptyString(resultJson.errorMessage) ?? "",
  ].join("\n");
}

// Fallback park window when the provider does not state a reset time. Ported
// from upstream/master's PROVIDER_QUOTA_RECOVERY_DEFAULT_BACKOFF_MS.
export const PROVIDER_QUOTA_RETRY_DEFAULT_BACKOFF_MS = 60 * 60 * 1000;

// Ported from upstream/master's parseProviderQuotaClockReset: pull "try again at
// 3pm (PST)" out of the provider's message so the retry is scheduled at the real
// reset instead of a blind hour.
export function parseProviderQuotaClockReset(error: string, now: Date) {
  const match = error.match(
    /try again at\s+(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?(?:\s*\(([^)]+)\)|\s+([A-Z]{2,5}))?/i,
  );
  if (!match) return null;

  const hourValue = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "0", 10);
  const meridiem = (match[3] ?? "").toLowerCase();
  if (!Number.isInteger(hourValue)) return null;
  if (meridiem ? hourValue < 1 || hourValue > 12 : hourValue < 0 || hourValue > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  let hour = meridiem ? hourValue % 12 : hourValue;
  if (meridiem === "p") hour += 12;
  const timeZone = (match[4] ?? match[5])?.trim();
  if (!timeZone) {
    const retryAt = new Date(now);
    retryAt.setUTCHours(hour, minute, 0, 0);
    if (retryAt.getTime() <= now.getTime()) retryAt.setUTCDate(retryAt.getUTCDate() + 1);
    return retryAt;
  }

  try {
    const wallClock = (date: Date) => Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(date).map((part) => [part.type, part.value]),
    );
    const nowParts = wallClock(now);
    const buildRetryAt = (dayOffset: number) => {
      const targetDay = new Date(Date.UTC(
        Number(nowParts.year),
        Number(nowParts.month) - 1,
        Number(nowParts.day) + dayOffset,
        hour,
        minute,
      ));
      let candidate = targetDay;
      const targetMs = targetDay.getTime();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const actual = wallClock(candidate);
        const actualMs = Date.UTC(
          Number(actual.year),
          Number(actual.month) - 1,
          Number(actual.day),
          Number(actual.hour),
          Number(actual.minute),
        );
        const adjustment = targetMs - actualMs;
        if (adjustment === 0) break;
        candidate = new Date(candidate.getTime() + adjustment);
      }
      return candidate;
    };
    const sameDay = buildRetryAt(0);
    return sameDay.getTime() > now.getTime() ? sameDay : buildRetryAt(1);
  } catch {
    return null;
  }
}

// Returns the park-until instant for a provider quota/billing failure, or null
// when the run is not one. Exported for tests.
export function classifyProviderQuotaFailure(
  run: ProviderQuotaRunFields | null | undefined,
  now = new Date(),
): { retryAt: Date; parsedResetTime: boolean } | null {
  if (!run) return null;
  const resultJson = parseObject(run.resultJson);
  const text = readRunFailureText(run, resultJson);
  if (run.errorCode !== "provider_quota" && !PROVIDER_QUOTA_ERROR_RE.test(text)) return null;

  const persistedRetryAt = readNonEmptyString(resultJson.providerQuotaRetryNotBefore) ??
    readNonEmptyString(resultJson.retryNotBefore) ??
    readNonEmptyString(resultJson.transientRetryNotBefore);
  const parsedPersistedRetryAt = persistedRetryAt ? new Date(persistedRetryAt) : null;
  if (parsedPersistedRetryAt && !Number.isNaN(parsedPersistedRetryAt.getTime()) && parsedPersistedRetryAt > now) {
    return { retryAt: parsedPersistedRetryAt, parsedResetTime: true };
  }

  const parsedClockReset = parseProviderQuotaClockReset(text, now);
  if (parsedClockReset) return { retryAt: parsedClockReset, parsedResetTime: true };

  return {
    retryAt: new Date(now.getTime() + PROVIDER_QUOTA_RETRY_DEFAULT_BACKOFF_MS),
    parsedResetTime: false,
  };
}
