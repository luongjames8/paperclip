import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.ts";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  assertCheckoutOwner: vi.fn(),
  update: vi.fn(),
  createChild: vi.fn(),
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
  getRelationSummaries: vi.fn(),
  listWakeableBlockedDependents: vi.fn(),
  getWakeableParentAfterChildCompletion: vi.fn(),
  getCurrentScheduledRetry: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  triggerIssueMonitor: vi.fn(async () => ({ outcome: "triggered" as const })),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(async () => false),
  decide: vi.fn(),
  hasPermission: vi.fn(async () => false),
}));
const mockDbSelectWhere = vi.hoisted(() => vi.fn(() => ({
  then: (onFulfilled: (rows: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve([{
      companyId: "company-1",
      agentId: "33333333-3333-4333-8333-333333333333",
      contextSnapshot: null,
      permissions: null,
    }]).then(onFulfilled, onRejected),
})));
const mockDbSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockDbSelectWhere })));
const mockDbSelect = vi.hoisted(() => vi.fn(() => ({ from: mockDbSelectFrom })));
// A completed decision (approve/changes-request) commits via db.transaction —
// needed once a test drives a stage all the way to a recorded decision (the
// expectedExecutionStageId compare-and-swap tests do). Mirrors
// issue-comment-reopen-routes.test.ts's mockTx pattern.
const mockTxInsertValues = vi.hoisted(() => vi.fn(async () => undefined));
const mockTxInsert = vi.hoisted(() => vi.fn(() => ({ values: mockTxInsertValues })));
// The row-lock re-verification (assertExecutionStageStillPendingForUpdate,
// routes/issues.ts) does tx.select(...).from(issues).where(...).for("update")
// as the FIRST thing inside the decision-committing transaction — tests that
// drive a real decision through the transaction must mock this chain too.
const mockTxSelectFor = vi.hoisted(() => vi.fn(async () => [] as Array<{ executionState: unknown }>));
const mockTxSelectWhere = vi.hoisted(() => vi.fn(() => ({ for: mockTxSelectFor })));
const mockTxSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockTxSelectWhere })));
const mockTxSelect = vi.hoisted(() => vi.fn(() => ({ from: mockTxSelectFrom })));
const mockTx = vi.hoisted(() => ({
  insert: mockTxInsert,
  select: mockTxSelect,
}));
const mockDb = vi.hoisted(() => ({
  select: mockDbSelect,
  transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));
const mockPublishPluginDomainEvent = vi.hoisted(() => vi.fn());
const mockIssueThreadInteractionService = vi.hoisted(() => ({
  listForIssue: vi.fn(async () => []),
  expireRequestConfirmationsSupersededByComment: vi.fn(async () => []),
}));
const mockIssueApprovalService = vi.hoisted(() => ({
  listApprovalsForIssue: vi.fn(async () => []),
}));

function registerModuleMocks() {
  // Routes import publishPluginDomainEvent directly from activity-log.js (not
  // through the ../services/index.js barrel below, which only re-exports
  // logActivity) — mocked separately so tests can assert on the
  // issue.execution_stage.pending event without a real plugin event bus.
  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
    publishPluginDomainEvent: mockPublishPluginDomainEvent,
  }));
  vi.doMock("../services/index.js", () => ({
    companyService: () => ({
      getById: vi.fn(async () => ({ id: "company-1", attachmentMaxBytes: 10 * 1024 * 1024 })),
    }),
    accessService: () => mockAccessService,
    agentService: () => ({
      getById: vi.fn(async (agentId: string) => ({
        id: agentId,
        companyId: "company-1",
        permissions: null,
      })),
      resolveByReference: vi.fn(async (_companyId: string, reference: string) => ({
        ambiguous: false,
        agent: {
          id: reference,
          companyId: "company-1",
          status: "idle",
          orgChainHealth: { status: "healthy" },
        },
      })),
    }),
    documentAnnotationService: () => ({ remapOpenThreadsForDocument: async () => [] }),
    documentService: () => ({}),
    executionWorkspaceService: () => ({}),
    feedbackService: () => ({
      listIssueVotesForUser: vi.fn(async () => []),
      saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
    }),
    goalService: () => ({}),
    heartbeatService: () => mockHeartbeatService,
    environmentService: () => ({
      getById: vi.fn(async () => null),
    }),
    instanceSettingsService: () => ({
      get: vi.fn(async () => ({
        id: "instance-settings-1",
        general: {
          censorUsernameInLogs: false,
          feedbackDataSharingPreference: "prompt",
        },
      })),
      listCompanyIds: vi.fn(async () => ["company-1"]),
    }),
    issueApprovalService: () => mockIssueApprovalService,
    issueReferenceService: () => ({
      deleteDocumentSource: async () => undefined,
      diffIssueReferenceSummary: () => ({
        addedReferencedIssues: [],
        removedReferencedIssues: [],
        currentReferencedIssues: [],
      }),
      emptySummary: () => ({ outbound: [], inbound: [] }),
      listIssueReferenceSummary: async () => ({ outbound: [], inbound: [] }),
      syncComment: async () => undefined,
      syncDocument: async () => undefined,
      syncIssue: async () => undefined,
    }),
    issueRecoveryActionService: () => ({
      getActiveForIssue: vi.fn(async () => null),
      listActiveForIssues: vi.fn(async () => new Map()),
    }),
    issueService: () => mockIssueService,
    issueThreadInteractionService: () => mockIssueThreadInteractionService,
    logActivity: mockLogActivity,
    projectService: () => ({}),
    routineService: () => ({
      syncRunStatusForIssue: vi.fn(async () => undefined),
    }),
    workProductService: () => ({}),
  }));
}

type TestActor =
  | {
      type: "board";
      userId: string;
      companyIds: string[];
      source: "local_implicit";
      isInstanceAdmin: boolean;
    }
  | {
      type: "agent";
      agentId: string;
      companyId: string;
      runId: string | null;
    };

async function createApp(actor?: TestActor) {
  const [{ errorHandler }, { issueRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/issues.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor ?? {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes(mockDb as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue execution policy routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.getRelationSummaries.mockResolvedValue({ blockedBy: [], blocks: [] });
    mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
    mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
    mockIssueThreadInteractionService.listForIssue.mockResolvedValue([]);
    mockIssueThreadInteractionService.expireRequestConfirmationsSupersededByComment.mockResolvedValue([]);
    mockIssueApprovalService.listApprovalsForIssue.mockResolvedValue([]);
    mockIssueService.addComment.mockResolvedValue({ id: "comment-1", body: "", createdAt: new Date().toISOString() });
    mockIssueService.getCurrentScheduledRetry.mockResolvedValue(null);
    mockTxInsertValues.mockResolvedValue(undefined);
    mockTxInsert.mockImplementation(() => ({ values: mockTxInsertValues }));
    mockTxSelectFor.mockResolvedValue([]);
    mockTxSelectWhere.mockImplementation(() => ({ for: mockTxSelectFor }));
    mockTxSelectFrom.mockImplementation(() => ({ where: mockTxSelectWhere }));
    mockTxSelect.mockImplementation(() => ({ from: mockTxSelectFrom }));
    mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));
    mockDbSelect.mockImplementation(() => ({ from: mockDbSelectFrom }));
    mockDbSelectFrom.mockImplementation(() => ({ where: mockDbSelectWhere }));
    mockDbSelectWhere.mockImplementation(() => ({
      then: (onFulfilled: (rows: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve([{
          companyId: "company-1",
          agentId: "33333333-3333-4333-8333-333333333333",
          contextSnapshot: null,
          permissions: null,
        }]).then(onFulfilled, onRejected),
    }));
    mockIssueService.createChild.mockResolvedValue({
      issue: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        companyId: "company-1",
        identifier: "PAP-1002",
        title: "Child issue",
      },
      parentBlockerAdded: false,
    });
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.decide.mockImplementation(async (input: { actor?: { type?: string; source?: string }; action?: string }) => {
      const allowed = input.actor?.type === "board" && input.actor.source === "local_implicit"
        ? true
        : input.actor?.type === "agent" && [
            "company_scope:read",
            "issue:read",
            "issue:mutate",
            "runtime:manage",
          ].includes(input.action ?? "")
          ? true
          : Boolean(await mockAccessService.canUser() || await mockAccessService.hasPermission());
      return {
        allowed,
        action: input.action,
        reason: allowed ? "allow_explicit_grant" : "deny_missing_grant",
        explanation: allowed ? "Allowed by test grant." : `Missing permission: ${input.action ?? "action"}`,
      };
    });
    mockAccessService.hasPermission.mockResolvedValue(false);
  });

  it("rejects an agent-authored in_review transition without a review path", async () => {
    const issue = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-1003",
      title: "Missing review path",
      executionPolicy: null,
      executionState: null,
    };
    mockIssueService.getById.mockResolvedValue(issue);

    const res = await request(await createApp({
      type: "agent",
      agentId: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      runId: "run-1",
    }))
      .patch("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .send({ status: "in_review" });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("invalid_issue_disposition");
    expect(res.body.error).toContain("request_confirmation");
    expect(res.body.details).toMatchObject({
      code: "invalid_issue_disposition",
      missing: "review_path",
    });
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });

  it("allows an agent-authored in_review transition with a pending confirmation interaction", async () => {
    const issue = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-1004",
      title: "Pending confirmation",
      executionPolicy: null,
      executionState: null,
    };
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueThreadInteractionService.listForIssue.mockResolvedValue([
      { id: "interaction-1", kind: "request_confirmation", status: "pending" },
    ]);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp({
      type: "agent",
      agentId: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      runId: "run-1",
    }))
      .patch("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .send({ status: "in_review" });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expect.objectContaining({ status: "in_review" }),
    );
  });

  it("allows an agent-authored in_review transition with a typed execution participant", async () => {
    const issue = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-1005",
      title: "Execution participant",
      executionPolicy: null,
      executionState: null,
    };
    const policy = normalizeIssueExecutionPolicy({
      stages: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          type: "review",
          participants: [{ type: "agent", agentId: "44444444-4444-4444-8444-444444444444" }],
        },
      ],
    })!;
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp({
      type: "agent",
      agentId: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      runId: "run-1",
    }))
      .patch("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .send({ status: "in_review", executionPolicy: policy });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expect.objectContaining({
        status: "in_review",
        executionState: expect.objectContaining({
          status: "pending",
          currentParticipant: expect.objectContaining({
            type: "agent",
            agentId: "44444444-4444-4444-8444-444444444444",
          }),
        }),
      }),
    );
  });

  // fleet issue #631 / PR-0: a review/approval stage becoming pending must
  // emit a dedicated issue.execution_stage.pending plugin event so discord-fleet
  // can render an Approve / Request-changes card — see buildExecutionStagePendingEvent
  // (routes/issues.ts). Unlike buildExecutionStageWakeup (agent participants
  // only), this fires for a "user" participant too — the case a Discord card
  // actually needs.
  it("emits issue.execution_stage.pending when a review stage becomes pending for a user participant", async () => {
    const issue = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-1631",
      title: "Carousel batch review",
      projectId: "project-1",
      executionPolicy: null,
      executionState: null,
    };
    const policy = normalizeIssueExecutionPolicy({
      stages: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          type: "review",
          participants: [{ type: "user", userId: "local-board" }],
        },
      ],
    })!;
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp({
      type: "agent",
      agentId: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      runId: "run-1",
    }))
      .patch("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .send({ status: "in_review", executionPolicy: policy });

    expect(res.status).toBe(200);
    expect(mockPublishPluginDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "issue.execution_stage.pending",
        companyId: "company-1",
        entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        payload: expect.objectContaining({
          issueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          identifier: "PAP-1631",
          stageId: "11111111-1111-4111-8111-111111111111",
          stageType: "review",
          // First-ever pending instance for this issue — no decision has
          // been recorded yet, so lastDecisionId is still null (codex round 5).
          lastDecisionId: null,
          participant: expect.objectContaining({ type: "user", userId: "local-board" }),
        }),
      }),
    );
  });

  it("does not emit issue.execution_stage.pending when attaching a policy without (re)starting the workflow", async () => {
    // Mirrors "does not auto-start execution review when reviewers are added
    // to an already in_review issue" above: attaching executionPolicy alone
    // (no status:"in_review"/"done") never activates a stage — nextExecutionState
    // stays null, so no stage has "newly become pending" and no event fires.
    const policy = normalizeIssueExecutionPolicy({
      stages: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          type: "review",
          participants: [{ type: "user", userId: "local-board" }],
        },
      ],
    })!;
    const issue = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "in_review",
      assigneeAgentId: null,
      assigneeUserId: "local-board",
      createdByUserId: "local-board",
      identifier: "PAP-1632",
      title: "Execution policy edit",
      executionPolicy: null,
      executionState: null,
    };
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp())
      .patch("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .send({ executionPolicy: policy });

    expect(res.status).toBe(200);
    expect(mockPublishPluginDomainEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "issue.execution_stage.pending" }),
    );
  });

  // fleet issue #631 / PR-0, codex P1 round 3 (treadmill / adversarial-seam-
  // hardening pass): a Discord button's customId carries the stageId it was
  // rendered for; expectedExecutionStageId lets the caller assert "resolve
  // THIS stage" and closes the client GET-then-PATCH round-trip race a
  // separate client-side pre-check could never fully close.
  describe("expectedExecutionStageId compare-and-swap", () => {
    const STAGE_ID = "11111111-1111-4111-8111-111111111111";
    function pendingReviewIssue(overrides: Partial<Record<string, unknown>> = {}) {
      const policy = normalizeIssueExecutionPolicy({
        stages: [
          { id: STAGE_ID, type: "review", participants: [{ type: "user", userId: "local-board" }] },
        ],
      })!;
      return {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        companyId: "company-1",
        status: "in_review",
        assigneeAgentId: null,
        assigneeUserId: "local-board",
        createdByUserId: "local-board",
        identifier: "PAP-1634",
        title: "Stage CAS check",
        executionPolicy: policy,
        executionState: {
          status: "pending",
          currentStageId: STAGE_ID,
          currentStageIndex: 0,
          currentStageType: "review",
          currentParticipant: { type: "user", userId: "local-board", agentId: null },
          returnAssignee: { type: "agent", agentId: "33333333-3333-4333-8333-333333333333", userId: null },
          completedStageIds: [],
          lastDecisionId: null,
          lastDecisionOutcome: null,
        },
        ...overrides,
      };
    }

    it("matching expectedExecutionStageId → approves normally", async () => {
      const issue = pendingReviewIssue();
      mockIssueService.getById.mockResolvedValue(issue);
      mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
        ...issue,
        ...patch,
        updatedAt: new Date(),
      }));
      // The transaction's own row-lock re-verification re-reads the SAME
      // still-pending state — mirrors what a real, uncontested Postgres
      // FOR UPDATE read would see.
      mockTxSelectFor.mockResolvedValue([{ executionState: issue.executionState }]);

      const res = await request(await createApp())
        .patch(`/api/issues/${issue.id}`)
        .send({ status: "done", comment: "Approved via test", expectedExecutionStageId: STAGE_ID });

      expect(res.status).toBe(200);
      expect(mockIssueService.update).toHaveBeenCalled();
      expect(mockTxSelectFor).toHaveBeenCalledWith("update");
    });

    it("row lock re-verification catches a stage that advanced BETWEEN the pre-transaction read and the lock (concurrent-decision race) → 409, no mutation", async () => {
      const issue = pendingReviewIssue();
      mockIssueService.getById.mockResolvedValue(issue);
      mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
        ...issue,
        ...patch,
        updatedAt: new Date(),
      }));
      // Simulates a second concurrent decision that landed and completed the
      // stage in the gap between this request's pre-transaction read (which
      // still saw "pending") and this request's own FOR UPDATE lock
      // acquisition — the exact race codex flagged in round 4. The
      // transaction-scoped re-check must catch what the pre-transaction
      // check alone cannot.
      mockTxSelectFor.mockResolvedValue([{
        executionState: { ...issue.executionState, status: "completed", currentStageId: null },
      }]);

      const res = await request(await createApp())
        .patch(`/api/issues/${issue.id}`)
        .send({ status: "done", comment: "Approved via test", expectedExecutionStageId: STAGE_ID });

      expect(res.status).toBe(409);
      expect(mockIssueService.update).not.toHaveBeenCalled();
    });

    it("mismatched expectedExecutionStageId → 409, no mutation applied", async () => {
      const issue = pendingReviewIssue();
      mockIssueService.getById.mockResolvedValue(issue);
      mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
        ...issue,
        ...patch,
        updatedAt: new Date(),
      }));

      const res = await request(await createApp())
        .patch(`/api/issues/${issue.id}`)
        .send({
          status: "done",
          comment: "Stale click",
          expectedExecutionStageId: "99999999-9999-4999-8999-999999999999",
        });

      expect(res.status).toBe(409);
      expect(mockIssueService.update).not.toHaveBeenCalled();
    });

    it("stage in changes_requested (same stageId, executor hasn't resubmitted) → 409, no mutation", async () => {
      const issue = pendingReviewIssue({
        status: "in_progress",
        assigneeAgentId: "33333333-3333-4333-8333-333333333333",
        assigneeUserId: null,
        executionState: {
          status: "changes_requested",
          currentStageId: STAGE_ID,
          currentStageIndex: 0,
          currentStageType: "review",
          currentParticipant: { type: "user", userId: "local-board", agentId: null },
          returnAssignee: { type: "agent", agentId: "33333333-3333-4333-8333-333333333333", userId: null },
          completedStageIds: [],
          lastDecisionId: "decision-1",
          lastDecisionOutcome: "changes_requested",
        },
      });
      mockIssueService.getById.mockResolvedValue(issue);
      mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
        ...issue,
        ...patch,
        updatedAt: new Date(),
      }));

      const res = await request(await createApp())
        .patch(`/api/issues/${issue.id}`)
        .send({ status: "done", comment: "Stale approve while changes are outstanding", expectedExecutionStageId: STAGE_ID });

      expect(res.status).toBe(409);
      expect(mockIssueService.update).not.toHaveBeenCalled();
    });

    it("absent expectedExecutionStageId (existing/non-Discord callers) → unaffected, behaves exactly as before", async () => {
      const issue = pendingReviewIssue();
      mockIssueService.getById.mockResolvedValue(issue);
      mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
        ...issue,
        ...patch,
        updatedAt: new Date(),
      }));

      const res = await request(await createApp())
        .patch(`/api/issues/${issue.id}`)
        .send({ status: "done", comment: "Approved via web UI, no stage token" });

      expect(res.status).toBe(200);
      expect(mockIssueService.update).toHaveBeenCalled();
      // No client-observed stage to assert -> the row-lock re-verification
      // never runs (would be pure overhead for a caller with nothing to check).
      expect(mockTxSelectFor).not.toHaveBeenCalled();
    });

    // codex round 5 (adversarial-seam-hardening pass): stageId+status alone
    // don't distinguish a stage's pending instance from a LATER pending
    // instance of the SAME stage after a changes-requested-then-resubmit
    // cycle — both have identical (status: "pending", currentStageId).
    // expectedLastDecisionToken closes this: it's derived from
    // executionState.lastDecisionId, which the route layer stamps to a fresh
    // value every time ANY decision is recorded for the issue.
    describe("expectedLastDecisionToken (pending-generation token)", () => {
      it("matching token ('none', no decision recorded yet) → approves normally", async () => {
        const issue = pendingReviewIssue();
        mockIssueService.getById.mockResolvedValue(issue);
        mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
          ...issue,
          ...patch,
          updatedAt: new Date(),
        }));
        mockTxSelectFor.mockResolvedValue([{ executionState: issue.executionState }]);

        const res = await request(await createApp())
          .patch(`/api/issues/${issue.id}`)
          .send({
            status: "done",
            comment: "Approved via test",
            expectedExecutionStageId: STAGE_ID,
            expectedLastDecisionToken: "none",
          });

        expect(res.status).toBe(200);
        expect(mockIssueService.update).toHaveBeenCalled();
      });

      it("stale token from BEFORE a changes-requested-then-resubmit cycle → 409, no mutation (the exact codex round-5 scenario)", async () => {
        // Same stageId, status back to "pending" (executor resubmitted), but
        // lastDecisionId is now the changes-request decision's id — a card
        // rendered for the ORIGINAL pending instance (token "none") is stale.
        const issue = pendingReviewIssue({
          executionState: {
            status: "pending",
            currentStageId: STAGE_ID,
            currentStageIndex: 0,
            currentStageType: "review",
            currentParticipant: { type: "user", userId: "local-board", agentId: null },
            returnAssignee: { type: "agent", agentId: "33333333-3333-4333-8333-333333333333", userId: null },
            completedStageIds: [],
            lastDecisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            lastDecisionOutcome: "changes_requested",
          },
        });
        mockIssueService.getById.mockResolvedValue(issue);
        mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
          ...issue,
          ...patch,
          updatedAt: new Date(),
        }));

        const res = await request(await createApp())
          .patch(`/api/issues/${issue.id}`)
          .send({
            status: "done",
            comment: "Approved from a stale, pre-changes-request card",
            expectedExecutionStageId: STAGE_ID,
            expectedLastDecisionToken: "none",
          });

        expect(res.status).toBe(409);
        expect(mockIssueService.update).not.toHaveBeenCalled();
      });

      it("row lock re-verification catches a decision recorded BETWEEN the pre-transaction read and the lock → 409, no mutation", async () => {
        const issue = pendingReviewIssue();
        mockIssueService.getById.mockResolvedValue(issue);
        mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
          ...issue,
          ...patch,
          updatedAt: new Date(),
        }));
        // Pre-transaction read saw lastDecisionId: null ("none"); by the time
        // this request's own lock acquires, a concurrent decision already
        // landed and stamped a fresh lastDecisionId — same stageId+status
        // (changes-requested loop back to pending), different generation.
        mockTxSelectFor.mockResolvedValue([{
          executionState: { ...issue.executionState, lastDecisionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
        }]);

        const res = await request(await createApp())
          .patch(`/api/issues/${issue.id}`)
          .send({
            status: "done",
            comment: "Approved via test",
            expectedExecutionStageId: STAGE_ID,
            expectedLastDecisionToken: "none",
          });

        expect(res.status).toBe(409);
        expect(mockIssueService.update).not.toHaveBeenCalled();
      });

      it("absent expectedLastDecisionToken (stageId provided but no token) → falls back to stageId-only check, behaves as before", async () => {
        const issue = pendingReviewIssue();
        mockIssueService.getById.mockResolvedValue(issue);
        mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
          ...issue,
          ...patch,
          updatedAt: new Date(),
        }));
        mockTxSelectFor.mockResolvedValue([{ executionState: issue.executionState }]);

        const res = await request(await createApp())
          .patch(`/api/issues/${issue.id}`)
          .send({ status: "done", comment: "Approved via test", expectedExecutionStageId: STAGE_ID });

        expect(res.status).toBe(200);
        expect(mockIssueService.update).toHaveBeenCalled();
      });
    });
  });

  it("allows an agent-authored in_review transition with a scheduled monitor", async () => {
    const issue = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-1006",
      title: "External review monitor",
      executionPolicy: null,
      executionState: null,
      monitorAttemptCount: 0,
      monitorNextCheckAt: null,
      monitorLastTriggeredAt: null,
      monitorNotes: null,
      monitorScheduledBy: null,
    };
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp({
      type: "agent",
      agentId: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      runId: "run-1",
    }))
      .patch("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .send({
        status: "in_review",
        executionPolicy: {
          monitor: {
            nextCheckAt: "2026-12-01T12:00:00.000Z",
            scheduledBy: "assignee",
            notes: "Wait for external QA report.",
          },
        },
      });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expect.objectContaining({
        status: "in_review",
        monitorNextCheckAt: new Date("2026-12-01T12:00:00.000Z"),
      }),
    );
  });

  it("allows board-authored in_review repair updates without a review path", async () => {
    const issue = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-1007",
      title: "Board repair",
      executionPolicy: null,
      executionState: null,
    };
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp())
      .patch("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .send({ status: "in_review" });

    expect(res.status).toBe(200);
    expect(mockIssueThreadInteractionService.listForIssue).not.toHaveBeenCalled();
    expect(mockIssueApprovalService.listApprovalsForIssue).not.toHaveBeenCalled();
  });

  it("does not auto-start execution review when reviewers are added to an already in_review issue", async () => {
    const policy = normalizeIssueExecutionPolicy({
      stages: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          type: "review",
          participants: [{ type: "agent", agentId: "33333333-3333-4333-8333-333333333333" }],
        },
      ],
    })!;
    const issue = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "in_review",
      assigneeAgentId: null,
      assigneeUserId: "local-board",
      createdByUserId: "local-board",
      identifier: "PAP-999",
      title: "Execution policy edit",
      executionPolicy: null,
      executionState: null,
    };
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp())
      .patch("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .send({ executionPolicy: policy });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expect.objectContaining({
        executionPolicy: policy,
        actorAgentId: null,
        actorUserId: "local-board",
      }),
    );
    const updatePatch = mockIssueService.update.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updatePatch.status).toBeUndefined();
    expect(updatePatch.assigneeAgentId).toBeUndefined();
    expect(updatePatch.assigneeUserId).toBeUndefined();
    expect(updatePatch.executionState).toBeUndefined();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("triggers a scheduled monitor immediately from the dedicated route", async () => {
    const issue = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "in_progress",
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-1001",
      title: "Manual monitor trigger",
      executionPolicy: normalizeIssueExecutionPolicy({
        monitor: {
          nextCheckAt: "2026-04-11T12:30:00.000Z",
          notes: "Check deployment",
          scheduledBy: "board",
        },
      }),
      executionState: null,
    };
    mockIssueService.getById.mockResolvedValue(issue);

    const res = await request(await createApp())
      .post("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/monitor/check-now")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockHeartbeatService.triggerIssueMonitor).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expect.objectContaining({
        actorType: "user",
        actorId: "local-board",
        agentId: null,
      }),
    );
  });

  it("lets a board user create a child issue with a scheduled monitor", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "in_progress",
      assigneeAgentId: "11111111-1111-4111-8111-111111111111",
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-1001",
      title: "Parent issue",
      executionPolicy: null,
      executionState: null,
    });

    const res = await request(await createApp())
      .post("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/children")
      .send({
        title: "Child monitor",
        status: "in_review",
        assigneeAgentId: "33333333-3333-4333-8333-333333333333",
        executionPolicy: {
          monitor: {
            nextCheckAt: "2026-04-11T12:30:00.000Z",
            scheduledBy: "assignee",
          },
        },
      });

    expect(res.status).toBe(201);
    const createPayload = mockIssueService.createChild.mock.calls[0]?.[1] as {
      executionPolicy: { monitor: { scheduledBy: string } };
    };
    expect(createPayload.executionPolicy.monitor.scheduledBy).toBe("board");
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.monitor_scheduled",
        details: expect.objectContaining({
          scheduledBy: "board",
        }),
      }),
    );
  });

  it("rejects child monitor scheduling by a non-assignee agent even with task assignment permission", async () => {
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockIssueService.getById.mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "in_progress",
      assigneeAgentId: "11111111-1111-4111-8111-111111111111",
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-1001",
      title: "Parent issue",
      executionPolicy: null,
      executionState: null,
    });

    const res = await request(await createApp({
      type: "agent",
      agentId: "22222222-2222-4222-8222-222222222222",
      companyId: "company-1",
      runId: null,
    }))
      .post("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/children")
      .send({
        title: "Child monitor",
        status: "in_review",
        assigneeAgentId: "33333333-3333-4333-8333-333333333333",
        executionPolicy: {
          monitor: {
            nextCheckAt: "2026-04-11T12:30:00.000Z",
            scheduledBy: "board",
          },
        },
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Only the assignee agent or a board user can manage issue monitors");
    expect(mockIssueService.createChild).not.toHaveBeenCalled();
  });

  it("normalizes spoofed child monitor scheduledBy to the assignee actor", async () => {
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockIssueService.getById.mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      status: "in_progress",
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-1001",
      title: "Parent issue",
      executionPolicy: null,
      executionState: null,
    });

    const res = await request(await createApp({
      type: "agent",
      agentId: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      runId: "99999999-9999-4999-8999-999999999999",
    }))
      .post("/api/issues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/children")
      .send({
        title: "Child monitor",
        status: "in_review",
        assigneeAgentId: "33333333-3333-4333-8333-333333333333",
        executionPolicy: {
          monitor: {
            nextCheckAt: "2026-04-11T12:30:00.000Z",
            scheduledBy: "board",
            externalRef: "https://example.test/deploy?token=secret",
          },
        },
      });

    expect(res.status).toBe(201);
    const createPayload = mockIssueService.createChild.mock.calls[0]?.[1] as {
      executionPolicy: { monitor: { scheduledBy: string; externalRef: string | null } };
    };
    expect(createPayload.executionPolicy.monitor.scheduledBy).toBe("assignee");
    expect(createPayload.executionPolicy.monitor.externalRef).toBe("[redacted]");
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.monitor_scheduled",
        entityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        details: expect.not.objectContaining({ externalRef: expect.anything() }),
      }),
    );
  });
});
