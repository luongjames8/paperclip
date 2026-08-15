import { describe, expect, it } from "vitest";
import {
  PROVIDER_QUOTA_RETRY_DEFAULT_BACKOFF_MS,
  classifyProviderQuotaFailure,
  parseProviderQuotaClockReset,
} from "./provider-quota.js";

// GH #706. Provider quota/billing exhaustion was classified `transient_upstream`
// (because the gateway stamps errorCode `openclaw_gateway_wait_error`, which is
// in TRANSIENT_UPSTREAM_ERROR_CODES) and so rode the 2m/10m/30m/2h retry ladder
// against a provider that could not possibly answer. 27,080 of 34,064 failed runs
// over 12 days were `transient_failure_retry` wakes.

const run = (error: string, overrides: Record<string, unknown> = {}) =>
  ({
    error,
    errorCode: "openclaw_gateway_wait_error",
    resultJson: { error },
    ...overrides,
  } as unknown as Parameters<typeof classifyProviderQuotaFailure>[0]);

const NOW = new Date("2026-08-14T12:00:00.000Z");

describe("GH #706: provider quota/billing is not transient", () => {
  // Both strings below are verbatim from heartbeat_runs on the live fsn
  // database during the 2026-08-07 outage.
  it("classifies the bailian monthly-allocation failure", () => {
    const classified = classifyProviderQuotaFailure(
      run("FailoverError: ⚠️ month allocated quota exceeded."),
      NOW,
    );
    expect(classified).not.toBeNull();
    expect(classified!.retryAt.getTime()).toBe(NOW.getTime() + PROVIDER_QUOTA_RETRY_DEFAULT_BACKOFF_MS);
    expect(classified!.parsedResetTime).toBe(false);
  });

  it("classifies the mixed quota + deepseek billing failover summary", () => {
    const classified = classifyProviderQuotaFailure(
      run(
        "FallbackSummaryError: All models failed (2): bailian/glm-5: 429 month allocated quota exceeded. " +
          "(rate_limit) | deepseek/deepseek-v4-pro: 402 Insufficient Balance (billing) <- FailoverError: " +
          "⚠️ deepseek (deepseek-v4-pro) returned a billing error",
      ),
      NOW,
    );
    expect(classified).not.toBeNull();
  });

  it("classifies a billing-only failure with no quota wording", () => {
    // The deepseek half on its own — upstream/master's regex has no case for it.
    expect(classifyProviderQuotaFailure(run("402 Insufficient Balance (billing)"), NOW)).not.toBeNull();
  });

  it("parks until the reset time the provider states, not a blind hour", () => {
    const classified = classifyProviderQuotaFailure(
      run("You've hit your usage limit. Try again at 3pm (UTC)."),
      NOW,
    );
    expect(classified!.parsedResetTime).toBe(true);
    expect(classified!.retryAt.toISOString()).toBe("2026-08-14T15:00:00.000Z");
  });

  it("honours a reset time the adapter already persisted", () => {
    const classified = classifyProviderQuotaFailure(
      run("provider quota", { resultJson: { providerQuotaRetryNotBefore: "2026-08-17T00:00:00.000Z" } }),
      NOW,
    );
    expect(classified!.parsedResetTime).toBe(true);
    expect(classified!.retryAt.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });

  it("leaves genuinely transient gateway failures alone", () => {
    // These must keep riding the fast transient ladder — the fix must not turn
    // every gateway hiccup into an hour-long park.
    expect(classifyProviderQuotaFailure(run("Error: socket hang up"), NOW)).toBeNull();
    expect(
      classifyProviderQuotaFailure(run("CLI transcript compaction failed for bailian/glm-5: Compaction timed out"), NOW),
    ).toBeNull();
    expect(
      classifyProviderQuotaFailure(
        run("EmbeddedAttemptSessionTakeoverError: session file changed while embedded prompt lock was released"),
        NOW,
      ),
    ).toBeNull();
    expect(classifyProviderQuotaFailure(run("connect ECONNREFUSED 127.0.0.1:3100"), NOW)).toBeNull();
  });

  it("ignores quota wording that is only in the agent's own transcript", () => {
    // resultJson also carries the agent's summary/stdout. A fleet agent writing
    // billing code must not park its own run for an hour, so only the adapter's
    // failure fields are scanned.
    const transcriptRun = {
      error: "Error: socket hang up",
      errorCode: "openclaw_gateway_wait_error",
      resultJson: {
        error: "Error: socket hang up",
        errorFamily: "transient_upstream",
        summary: "Reviewed the checkout flow's handling of quota exceeded and insufficient balance responses.",
        stdout: "402 payment required\ninsufficient credits",
      },
    } as unknown as Parameters<typeof classifyProviderQuotaFailure>[0];
    expect(classifyProviderQuotaFailure(transcriptRun, NOW)).toBeNull();
  });

  it("beats a persisted errorFamily that mislabels a real quota failure as transient", () => {
    // The GH #706 misclassification itself: text is the stronger evidence.
    const mislabelled = {
      error: "FailoverError: ⚠️ month allocated quota exceeded.",
      errorCode: "openclaw_gateway_wait_error",
      resultJson: {
        error: "FailoverError: ⚠️ month allocated quota exceeded.",
        errorFamily: "transient_upstream",
      },
    } as unknown as Parameters<typeof classifyProviderQuotaFailure>[0];
    expect(classifyProviderQuotaFailure(mislabelled, NOW)).not.toBeNull();
  });

  it("classifies the Claude allowance phrases the claude-local adapter already parses", () => {
    // parse.ts persists these as claude_transient_upstream, so if this classifier
    // misses them the ladder is exhausted and then handed a fresh one forever.
    for (const text of [
      "You're out of extra usage. Your limit resets soon.",
      "Claude usage limit reached",
      "5-hour limit reached",
      "weekly limit reached",
      "usage cap reached",
    ]) {
      expect(classifyProviderQuotaFailure(run(text), NOW)).not.toBeNull();
    }
  });

  it("does not treat an EVM gas-fee failure as a provider billing failure", () => {
    expect(classifyProviderQuotaFailure(run("Error: insufficient funds for gas * price + value"), NOW)).toBeNull();
  });

  it("every park is strictly in the future, so a retry can never fire immediately", () => {
    for (const text of [
      "FailoverError: ⚠️ month allocated quota exceeded.",
      "402 Insufficient Balance (billing)",
      "You've hit your usage limit. Try again at 3pm (UTC).",
      "model is at capacity",
    ]) {
      expect(classifyProviderQuotaFailure(run(text), NOW)!.retryAt.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });
});

describe("GH #706: the recovery service's re-drive guard sees the same failures", () => {
  // reconcileStrandedAssignedIssues escalates instead of requeuing when this
  // classifier fires on the latest terminal run. Codex P1 on PR #40: without it
  // the exhausted heartbeat ladder is restarted from attempt 1 forever, because
  // an exhausted ladder leaves retryReason "transient_failure", which
  // didAutomaticRecoveryFail does not recognise as a failed recovery.
  // recovery's LatestIssueRun is a narrower shape than a heartbeatRuns row, so
  // this pins that the classifier accepts it.
  const latestIssueRunShape = {
    id: "run-1",
    agentId: "agent-1",
    status: "failed",
    error: "FailoverError: ⚠️ month allocated quota exceeded.",
    errorCode: "openclaw_gateway_wait_error",
    contextSnapshot: { issueId: "issue-1", retryReason: "transient_failure" },
    livenessState: null,
  };

  it("classifies a run in recovery's LatestIssueRun shape, with no resultJson at all", () => {
    expect(classifyProviderQuotaFailure(latestIssueRunShape, NOW)).not.toBeNull();
  });

  it("does not fire on an exhausted ladder that failed for a non-quota reason", () => {
    expect(
      classifyProviderQuotaFailure({ ...latestIssueRunShape, error: "Error: socket hang up" }, NOW),
    ).toBeNull();
  });
});

describe("GH #706: provider quota clock-reset parsing", () => {
  it("rolls a reset time that already passed today to tomorrow", () => {
    expect(parseProviderQuotaClockReset("try again at 9am (UTC)", NOW)!.toISOString()).toBe(
      "2026-08-15T09:00:00.000Z",
    );
  });

  it("returns null when the message states no reset time", () => {
    expect(parseProviderQuotaClockReset("month allocated quota exceeded", NOW)).toBeNull();
  });

  it("returns null for an out-of-range clock", () => {
    expect(parseProviderQuotaClockReset("try again at 99:99", NOW)).toBeNull();
  });

  it("resolves the US zone abbreviations providers actually send", () => {
    // Node's Intl accepts these as zone aliases, so the DST-correcting branch
    // does resolve them. Pinned because it is the branch most likely to rot on a
    // runtime upgrade — and if it ever does throw, the catch returns null and
    // classifyProviderQuotaFailure falls back to the default park window, which
    // is safe rather than wrong.
    expect(parseProviderQuotaClockReset("try again at 3pm (PST)", NOW)!.toISOString()).toBe(
      "2026-08-14T22:00:00.000Z",
    );
    // "EST" resolves as a fixed UTC-5 zone (no summer-time shift), unlike "PST"
    // above which Node aliases to America/Los_Angeles and so does shift. The
    // abbreviations are ambiguous by nature; both land in the future, which is
    // what the park actually depends on.
    expect(parseProviderQuotaClockReset("try again at 3pm EST", NOW)!.toISOString()).toBe(
      "2026-08-14T20:00:00.000Z",
    );
  });

  it("falls back to the default park window when no reset time is stated", () => {
    const classified = classifyProviderQuotaFailure(
      {
        error: "You've hit your usage limit.",
        errorCode: "openclaw_gateway_wait_error",
        resultJson: {},
      } as unknown as Parameters<typeof classifyProviderQuotaFailure>[0],
      NOW,
    );
    expect(classified!.parsedResetTime).toBe(false);
    expect(classified!.retryAt.getTime()).toBe(NOW.getTime() + PROVIDER_QUOTA_RETRY_DEFAULT_BACKOFF_MS);
  });
});
