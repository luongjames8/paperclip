import { describe, expect, it } from "vitest";
import {
  createRoutineSchema,
  routineExecutionPolicySchema,
  routineRevisionSnapshotV1Schema,
  routineVariableSchema,
  updateRoutineSchema,
} from "./routine.js";

const routineId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const triggerId = "33333333-3333-4333-8333-333333333333";
const baseRevisionId = "44444444-4444-4444-8444-444444444444";

describe("routine validators", () => {
  it("accepts versioned routine revision snapshots with safe trigger metadata", () => {
    const parsed = routineRevisionSnapshotV1Schema.parse({
      version: 1,
      routine: {
        id: routineId,
        companyId,
        projectId: null,
        goalId: null,
        parentIssueId: null,
        title: "Daily triage",
        description: null,
        assigneeAgentId: null,
        priority: "medium",
        status: "active",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
        variables: [],
      },
      triggers: [{
        id: triggerId,
        kind: "webhook",
        label: "Inbound",
        enabled: true,
        cronExpression: null,
        timezone: null,
        publicId: "routine_webhook_123",
        signingMode: "bearer",
        replayWindowSec: 300,
      }],
    });

    expect(parsed.triggers[0]?.publicId).toBe("routine_webhook_123");
  });

  it("rejects secret-bearing trigger fields in routine revision snapshots", () => {
    expect(() => routineRevisionSnapshotV1Schema.parse({
      version: 1,
      routine: {
        id: routineId,
        companyId,
        projectId: null,
        goalId: null,
        parentIssueId: null,
        title: "Daily triage",
        description: null,
        assigneeAgentId: null,
        priority: "medium",
        status: "active",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
        variables: [],
      },
      triggers: [{
        id: triggerId,
        kind: "webhook",
        label: "Inbound",
        enabled: true,
        cronExpression: null,
        timezone: null,
        publicId: "routine_webhook_123",
        signingMode: "bearer",
        replayWindowSec: 300,
        secretId: "55555555-5555-4555-8555-555555555555",
      }],
    })).toThrow();
  });

  it("accepts optional base revision ids on routine updates", () => {
    expect(updateRoutineSchema.parse({
      title: "Daily triage",
      baseRevisionId,
    }).baseRevisionId).toBe(baseRevisionId);
  });

  it("accepts date variables with valid YYYY-MM-DD defaults", () => {
    expect(routineVariableSchema.parse({
      name: "startDate",
      type: "date",
      defaultValue: "2024-02-29",
    })).toMatchObject({
      name: "startDate",
      type: "date",
      defaultValue: "2024-02-29",
    });
  });

  it("rejects date variables with non-calendar or non-string defaults", () => {
    expect(() => routineVariableSchema.parse({
      name: "startDate",
      type: "date",
      defaultValue: "2024-02-30",
    })).toThrow(/YYYY-MM-DD/);

    expect(() => routineVariableSchema.parse({
      name: "startDate",
      type: "date",
      defaultValue: 20240229,
    })).toThrow(/YYYY-MM-DD/);
  });

  describe("routine execution policy", () => {
    const editorAgentId = "55555555-5555-4555-8555-555555555555";
    const validPolicy = {
      stages: [{ type: "review", participants: [{ type: "agent", agentId: editorAgentId }] }],
    };

    it("accepts stages+mode on routine create", () => {
      const parsed = createRoutineSchema.parse({
        title: "Weekly article",
        executionPolicy: { ...validPolicy, mode: "normal" },
      });
      expect(parsed.executionPolicy?.stages).toHaveLength(1);
      expect(parsed.executionPolicy?.stages[0]?.participants[0]?.agentId).toBe(editorAgentId);
    });

    it("rejects per-issue runtime fields like monitor", () => {
      expect(() => routineExecutionPolicySchema.parse({
        ...validPolicy,
        monitor: { nextCheckAt: new Date(0).toISOString() },
      })).toThrow();
    });

    it("rejects an empty stages array", () => {
      expect(() => routineExecutionPolicySchema.parse({ stages: [] })).toThrow();
    });

    it("rejects a stage with no participants", () => {
      expect(() => routineExecutionPolicySchema.parse({
        stages: [{ type: "review", participants: [] }],
      })).toThrow(/at least one participant/);
    });

    it("rejects duplicate caller-supplied stage ids", () => {
      const stageId = "66666666-6666-4666-8666-666666666666";
      expect(() => routineExecutionPolicySchema.parse({
        stages: [
          { id: stageId, type: "review", participants: [{ type: "agent", agentId: editorAgentId }] },
          { id: stageId, type: "approval", participants: [{ type: "agent", agentId: editorAgentId }] },
        ],
      })).toThrow(/stage ids must be unique/);
    });

    it("rejects agent participants without an agentId", () => {
      expect(() => routineExecutionPolicySchema.parse({
        stages: [{ type: "review", participants: [{ type: "agent" }] }],
      })).toThrow(/agentId/);
    });
  });

  describe("routine approvalKind (fleet issue #687)", () => {
    it("accepts a lowercase snake_case kind on routine create", () => {
      const parsed = createRoutineSchema.parse({
        title: "Weekly content batch",
        approvalKind: "content_batch_approval",
      });
      expect(parsed.approvalKind).toBe("content_batch_approval");
    });

    it("accepts null/absent approvalKind (no kind declared)", () => {
      expect(createRoutineSchema.parse({ title: "Untagged routine" }).approvalKind).toBeUndefined();
      expect(createRoutineSchema.parse({ title: "Untagged routine", approvalKind: null }).approvalKind).toBeNull();
    });

    it("rejects an uppercase kind", () => {
      expect(() => createRoutineSchema.parse({
        title: "Weekly content batch",
        approvalKind: "Content_Batch_Approval",
      })).toThrow();
    });

    it("rejects a kind starting with a digit or underscore", () => {
      expect(() => createRoutineSchema.parse({
        title: "x",
        approvalKind: "1content_batch",
      })).toThrow();
      expect(() => createRoutineSchema.parse({
        title: "x",
        approvalKind: "_content_batch",
      })).toThrow();
    });

    it("rejects an empty-string kind", () => {
      expect(() => createRoutineSchema.parse({ title: "x", approvalKind: "" })).toThrow();
    });

    it("rejects a kind over 64 characters", () => {
      expect(() => createRoutineSchema.parse({
        title: "x",
        approvalKind: "a".repeat(65),
      })).toThrow();
    });

    it("rejects a kind containing spaces or punctuation (not a routing-safe token)", () => {
      expect(() => createRoutineSchema.parse({
        title: "x",
        approvalKind: "content batch approval",
      })).toThrow();
      expect(() => createRoutineSchema.parse({
        title: "x",
        approvalKind: "content-batch-approval",
      })).toThrow();
    });

    it("round-trips through updateRoutineSchema (partial)", () => {
      expect(updateRoutineSchema.parse({ approvalKind: "hire_review" }).approvalKind).toBe("hire_review");
    });

    it("legacy revision snapshots (predating approvalKind) parse to null, not a schema error", () => {
      const parsed = routineRevisionSnapshotV1Schema.parse({
        version: 1,
        routine: {
          id: routineId,
          companyId,
          projectId: null,
          goalId: null,
          parentIssueId: null,
          title: "Daily triage",
          description: null,
          assigneeAgentId: null,
          priority: "medium",
          status: "active",
          concurrencyPolicy: "coalesce_if_active",
          catchUpPolicy: "skip_missed",
          variables: [],
          // approvalKind deliberately omitted — simulates a revision snapshot
          // persisted before this migration/field existed.
        },
        triggers: [],
      });
      expect(parsed.routine.approvalKind).toBeNull();
    });

    it("rejects a malformed approvalKind inside a revision snapshot", () => {
      expect(() => routineRevisionSnapshotV1Schema.parse({
        version: 1,
        routine: {
          id: routineId,
          companyId,
          projectId: null,
          goalId: null,
          parentIssueId: null,
          title: "Daily triage",
          description: null,
          assigneeAgentId: null,
          priority: "medium",
          status: "active",
          concurrencyPolicy: "coalesce_if_active",
          catchUpPolicy: "skip_missed",
          variables: [],
          approvalKind: "Not A Valid Kind!",
        },
        triggers: [],
      })).toThrow();
    });
  });
});
