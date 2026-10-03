// Boundary-safety helpers. Every timestamp or free-form value the plugin reads
// from the paperclip API or its own state store is untrusted: fields can be
// absent, non-string, corrupted, or in the future (clock skew / bogus writes).
// These helpers make NaN and negative-age poisoning impossible by construction
// — callers get `null` ("unknown — treat conservatively") instead of NaN
// silently flipping a comparison.

/** Parse an ISO-ish stored timestamp; null for non-string/unparseable/non-finite. */
export function safeParseMs(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Age in whole hours of `isoDate` relative to `now`.
 * - invalid/missing date → null (age unknown; callers must skip, not alert)
 * - future date (clock skew, bogus server value) → 0 (treat as "just updated",
 *   never as "stuck forever" or "older than any threshold")
 */
export function safeAgeHours(isoDate: unknown, nowMs: number): number | null {
  const then = safeParseMs(isoDate);
  if (then === null) return null;
  return Math.max(0, Math.floor((nowMs - then) / 3_600_000));
}

/** Coerce an unknown API field to a bounded display string (never throws). */
export function safeStr(v: unknown, max: number): string {
  return String(v ?? "").slice(0, max);
}
