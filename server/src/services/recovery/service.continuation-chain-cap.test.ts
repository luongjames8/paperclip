import { describe, expect, it } from "vitest";
import {
  STRANDED_PRODUCTIVE_CONTINUATION_MAX_CHAIN,
  decideProductiveContinuationRecovery,
  isRepeatedProductiveContinuationRecovery,
} from "./service.js";

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

describe("GH #706: productive-continuation chain cap", () => {
  it("keeps requeuing while the chain is short and the exemption holds", () => {
    expect(
      decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength: 1, maxChain: 5 }),
    ).toBe("requeue");
    expect(
      decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength: 4, maxChain: 5 }),
    ).toBe("requeue");
  });

  it("terminates the chain at the cap even though the exemption still holds", () => {
    // This is the whole fix: `exempted: true` no longer buys another wake once
    // the chain has run its budget.
    expect(
      decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength: 5, maxChain: 5 }),
    ).toBe("escalate_chain_exhausted");
    expect(
      decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength: 9_183, maxChain: 5 }),
    ).toBe("escalate_chain_exhausted");
  });

  it("still escalates immediately when there is no visible progress at all", () => {
    expect(
      decideProductiveContinuationRecovery({ repeated: true, exempted: false, chainLength: 1, maxChain: 5 }),
    ).toBe("escalate_no_progress");
  });

  it("does not escalate a first, non-repeated productive continuation", () => {
    expect(
      decideProductiveContinuationRecovery({ repeated: false, exempted: false, chainLength: 0, maxChain: 5 }),
    ).toBe("requeue");
  });

  it("simulated HIN-2846 loop terminates instead of running forever", () => {
    // Drive the branch the way reconcileStrandedAssignedIssues does: every
    // wake the agent comments ("still pending"), so `exempted` is always true.
    let chainLength = 0;
    let decision = decideProductiveContinuationRecovery({
      repeated: true,
      exempted: true,
      chainLength,
      maxChain: 20,
    });
    let wakes = 0;
    while (decision === "requeue" && wakes < 10_000) {
      wakes += 1;
      chainLength += 1;
      decision = decideProductiveContinuationRecovery({
        repeated: true,
        exempted: true,
        chainLength,
        maxChain: 20,
      });
    }
    expect(decision).toBe("escalate_chain_exhausted");
    expect(wakes).toBe(20);
  });

  it("the shipped default cap is bounded and at least the sibling path's 2", () => {
    expect(STRANDED_PRODUCTIVE_CONTINUATION_MAX_CHAIN).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(STRANDED_PRODUCTIVE_CONTINUATION_MAX_CHAIN)).toBe(true);
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
