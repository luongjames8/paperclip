import { describe, expect, it } from "vitest";
import {
  STRANDED_PRODUCTIVE_CONTINUATION_MAX_CHAIN,
  decideProductiveContinuationRecovery,
  isProviderQuotaExhaustedRunFor,
  isRepeatedProductiveContinuationRecovery,
  readProductiveContinuationChainLength,
} from "./service.js";

type LatestIssueRunForGuard = Parameters<typeof isProviderQuotaExhaustedRunFor>[0];

// GH #706. The `in_progress` productive-continuation branch of
// reconcileStrandedAssignedIssues had no attempt cap: the GGU-809
// recent-progress exemption accepts an assignee comment as evidence of
// progress, and the agent writes that comment on the very wake being
// evaluated, so a waiting agent guarantees its own next wake forever
// (HIN-2846: 9,183 wakes / 9,110 comments in 4 days).

const productiveRecoveryRun = (overrides: Record<string, unknown> = {}) =>
  ({
    status: "succeeded",
    livenessState: "advanced",
    contextSnapshot: {
      retryReason: "issue_continuation_needed",
      source: "issue.productive_terminal_continuation_recovery",
    },
    ...overrides,
  } as unknown as Parameters<typeof isRepeatedProductiveContinuationRecovery>[0]);

const CAP = STRANDED_PRODUCTIVE_CONTINUATION_MAX_CHAIN;

describe("GH #706: productive-continuation chain cap", () => {
  it("keeps requeuing while the chain is short and the exemption holds", () => {
    expect(
      decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength: 1 }),
    ).toBe("requeue");
    expect(
      decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength: CAP - 1 }),
    ).toBe("requeue");
  });

  it("terminates the chain at the cap even though the exemption still holds", () => {
    // This is the whole fix: `exempted: true` no longer buys another wake once
    // the chain has run its budget.
    expect(
      decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength: CAP }),
    ).toBe("escalate_chain_exhausted");
    expect(
      decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength: 9_183 }),
    ).toBe("escalate_chain_exhausted");
  });

  it("still escalates immediately when there is no visible progress at all", () => {
    expect(
      decideProductiveContinuationRecovery({ repeated: true, exempted: false, chainLength: 1 }),
    ).toBe("escalate_no_progress");
  });

  it("does not escalate a first, non-repeated productive continuation", () => {
    expect(
      decideProductiveContinuationRecovery({ repeated: false, exempted: false, chainLength: 0 }),
    ).toBe("requeue");
  });

  it("simulated HIN-2846 loop terminates instead of running forever", () => {
    // Drives both halves the way reconcileStrandedAssignedIssues does: the agent
    // comments "still pending" on every wake so `exempted` never goes false, and
    // each requeue hands the incremented counter to the next link. This is the
    // regression test for the outage — without the cap it never leaves the loop.
    let chainLength = readProductiveContinuationChainLength({});
    let wakes = 0;
    let decision = decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength });
    while (decision === "requeue" && wakes < 10_000) {
      wakes += 1;
      chainLength = readProductiveContinuationChainLength({ productiveContinuationChain: chainLength + 1 });
      decision = decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength });
    }
    expect(decision).toBe("escalate_chain_exhausted");
    expect(wakes).toBe(CAP);
  });

  it("a transient failure mid-chain does not reset the count", () => {
    // scheduleBoundedRetryForRun copies the context forward but rewrites
    // retryReason to "transient_failure", so the retried link is NOT an
    // isRepeatedProductiveContinuationRecovery. The counter still rides along,
    // and it is the counter the cap reads — otherwise one transient failure
    // every CAP-1 wakes would slip the ceiling forever (codex P1 on PR #40).
    const midChainContext = { productiveContinuationChain: CAP };
    const transientRetryContext = {
      ...midChainContext,
      retryReason: "transient_failure",
      wakeReason: "transient_failure_retry",
    };
    expect(readProductiveContinuationChainLength(transientRetryContext)).toBe(CAP);
    expect(
      decideProductiveContinuationRecovery({
        repeated: false,
        exempted: false,
        chainLength: readProductiveContinuationChainLength(transientRetryContext),
      }),
    ).toBe("escalate_chain_exhausted");
  });

  it("the shipped default cap is bounded and at least the sibling path's 2", () => {
    expect(CAP).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(CAP)).toBe(true);
  });
});

describe("GH #706: chain length carried on the wake context", () => {
  it("treats a run with no counter as not yet in a chain", () => {
    // Also the state of every chain already in flight when this deploys: they
    // simply restart their count once rather than being escalated on sight.
    expect(readProductiveContinuationChainLength({})).toBe(0);
    expect(readProductiveContinuationChainLength(null)).toBe(0);
    expect(readProductiveContinuationChainLength({ productiveContinuationChain: 0 })).toBe(0);
  });

  it("reads the counter the previous link handed forward", () => {
    expect(readProductiveContinuationChainLength({ productiveContinuationChain: 7 })).toBe(7);
  });

  it("ignores a junk counter rather than trusting it", () => {
    for (const junk of ["nonsense", -3, Number.NaN, Number.POSITIVE_INFINITY, { nested: 1 }]) {
      expect(readProductiveContinuationChainLength({ productiveContinuationChain: junk })).toBe(0);
    }
  });
});

describe("GH #706: the provider-quota re-drive guard", () => {
  // reconcileStrandedAssignedIssues escalates to `blocked` instead of requeuing
  // when this fires. Reaching it means the heartbeat ladder is spent, because a
  // parked scheduled_retry is an active execution path and the loop skips those.
  const quotaRun = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "run-1",
      agentId: "agent-a",
      status: "failed",
      error: "FailoverError: ⚠️ month allocated quota exceeded.",
      errorCode: "openclaw_gateway_wait_error",
      contextSnapshot: { issueId: "issue-1", retryReason: "transient_failure" },
      livenessState: null,
      resultJson: { boundedRetryLadderExhausted: true },
      ...overrides,
    } as unknown as LatestIssueRunForGuard);

  it("fires for the current agent's exhausted quota failure", () => {
    expect(isProviderQuotaExhaustedRunFor(quotaRun(), "agent-a")).toBe(true);
  });

  it("ignores a quota failure left behind by a previous assignee", () => {
    // Reassignment clears execution locks but keeps run history, so the issue's
    // latest run can be agent A's while agent B is now assigned — possibly on a
    // different provider. Blocking on A's failure would strand the reassignment.
    expect(isProviderQuotaExhaustedRunFor(quotaRun(), "agent-b")).toBe(false);
  });

  it("ignores a non-quota failure and a still-running run", () => {
    expect(isProviderQuotaExhaustedRunFor(quotaRun({ error: "Error: socket hang up" }), "agent-a")).toBe(false);
    expect(isProviderQuotaExhaustedRunFor(quotaRun({ status: "running" }), "agent-a")).toBe(false);
    expect(isProviderQuotaExhaustedRunFor(quotaRun({ status: "succeeded" }), "agent-a")).toBe(false);
  });

  it("ignores a quota failure whose ladder has not stamped exhaustion", () => {
    // heartbeat.ts persists the failed status BEFORE it schedules the retry, so
    // a reconciliation tick landing in that window sees a terminal quota run
    // with no active execution path. Blocking there would both be wrong and let
    // the finalizer queue a retry for already-blocked work. Runs from before
    // this change carry no marker either, and get a ladder rather than a block.
    expect(isProviderQuotaExhaustedRunFor(quotaRun({ resultJson: {} }), "agent-a")).toBe(false);
    expect(isProviderQuotaExhaustedRunFor(quotaRun({ resultJson: null }), "agent-a")).toBe(false);
    expect(
      isProviderQuotaExhaustedRunFor(quotaRun({ resultJson: { boundedRetryLadderExhausted: "yes" } }), "agent-a"),
    ).toBe(false);
  });

  it("ignores a missing run or a missing agent rather than escalating on nothing", () => {
    expect(isProviderQuotaExhaustedRunFor(null, "agent-a")).toBe(false);
    expect(isProviderQuotaExhaustedRunFor(quotaRun(), null)).toBe(false);
    expect(isProviderQuotaExhaustedRunFor(quotaRun(), undefined)).toBe(false);
  });
});

describe("GH #706: chain counter membership predicate", () => {
  it("counts a productive continuation-recovery run", () => {
    expect(isRepeatedProductiveContinuationRecovery(productiveRecoveryRun())).toBe(true);
  });

  it("breaks the chain on a run from any other source", () => {
    expect(
      isRepeatedProductiveContinuationRecovery(
        productiveRecoveryRun({
          contextSnapshot: { retryReason: "issue_continuation_needed", source: "issue.assignment_recovery" },
        }),
      ),
    ).toBe(false);
  });

  it("breaks the chain on a non-succeeded run", () => {
    expect(isRepeatedProductiveContinuationRecovery(productiveRecoveryRun({ status: "failed" }))).toBe(false);
  });

  it("breaks the chain on a run that made no progress", () => {
    expect(isRepeatedProductiveContinuationRecovery(productiveRecoveryRun({ livenessState: "idle" }))).toBe(false);
  });
});
