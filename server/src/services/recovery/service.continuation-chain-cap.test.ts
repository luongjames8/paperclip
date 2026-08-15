import { describe, expect, it } from "vitest";
import {
  STRANDED_PRODUCTIVE_CONTINUATION_MAX_CHAIN,
  decideProductiveContinuationRecovery,
  isRepeatedProductiveContinuationRecovery,
  readProductiveContinuationChainLength,
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
    let wakes = 1;
    let decision = decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength });
    while (decision === "requeue" && wakes < 10_000) {
      wakes += 1;
      chainLength = readProductiveContinuationChainLength({ productiveContinuationChain: chainLength + 1 });
      decision = decideProductiveContinuationRecovery({ repeated: true, exempted: true, chainLength });
    }
    expect(decision).toBe("escalate_chain_exhausted");
    expect(wakes).toBe(CAP);
  });

  it("the shipped default cap is bounded and at least the sibling path's 2", () => {
    expect(CAP).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(CAP)).toBe(true);
  });
});

describe("GH #706: chain length carried on the wake context", () => {
  it("treats a run with no counter as the start of a chain", () => {
    // Also the state of every chain already in flight when this deploys: they
    // simply restart their count once rather than being escalated on sight.
    expect(readProductiveContinuationChainLength({})).toBe(1);
    expect(readProductiveContinuationChainLength(null)).toBe(1);
    expect(readProductiveContinuationChainLength({ productiveContinuationChain: 0 })).toBe(1);
  });

  it("reads the counter the previous link handed forward", () => {
    expect(readProductiveContinuationChainLength({ productiveContinuationChain: 7 })).toBe(7);
  });

  it("ignores a junk counter rather than trusting it", () => {
    for (const junk of ["nonsense", -3, Number.NaN, Number.POSITIVE_INFINITY, { nested: 1 }]) {
      expect(readProductiveContinuationChainLength({ productiveContinuationChain: junk })).toBe(1);
    }
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
