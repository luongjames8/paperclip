import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  requestRevision: vi.fn(),
  resubmit: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  listIssuesForApproval: vi.fn(),
  linkManyForApproval: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeHireApprovalPayloadForPersistence: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn(),
}));

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    accessService: () => mockAccessService,
    approvalService: () => mockApprovalService,
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => mockIssueApprovalService,
    logActivity: mockLogActivity,
    secretService: () => mockSecretService,
  }));
}

async function createApp(actorOverrides: Record<string, unknown> = {}) {
  const [{ errorHandler }, { approvalRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/approvals.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
      ...actorOverrides,
    };
    next();
  });
  app.use("/api", approvalRoutes({} as any));
  app.use(errorHandler);
  return app;
}

async function createAgentApp() {
  const [{ errorHandler }, { approvalRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/approvals.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "api_key",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", approvalRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("approval routes idempotent retries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/approvals.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockApprovalService.list.mockReset();
    mockApprovalService.getById.mockReset();
    mockApprovalService.create.mockReset();
    mockApprovalService.approve.mockReset();
    mockApprovalService.reject.mockReset();
    mockApprovalService.requestRevision.mockReset();
    mockApprovalService.resubmit.mockReset();
    mockApprovalService.listComments.mockReset();
    mockApprovalService.addComment.mockReset();
    mockAgentService.getById.mockReset();
    mockHeartbeatService.wakeup.mockReset();
    mockIssueApprovalService.listIssuesForApproval.mockReset();
    mockIssueApprovalService.linkManyForApproval.mockReset();
    mockSecretService.normalizeHireApprovalPayloadForPersistence.mockReset();
    mockLogActivity.mockReset();
    mockAccessService.decide.mockReset();
    mockAccessService.decide.mockResolvedValue({
      allowed: true,
      action: "company_scope:read",
      reason: "allow_test",
      explanation: "Allowed by test mock.",
    });
    // Default: agent belongs to the same company as the approval.
    mockAgentService.getById.mockResolvedValue({ id: "agent-42", companyId: "company-1" });
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "wake-1" });
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([{ id: "issue-1", status: "backlog", assigneeAgentId: "agent-42" }]);
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("does not emit duplicate approval side effects when approve is already resolved", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "approved",
      payload: {},
      requestedByAgentId: "agent-1",
    });
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-1",
        companyId: "company-1",
        type: "hire_agent",
        status: "approved",
        payload: {},
        requestedByAgentId: "agent-1",
      },
      applied: false,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-1/approve")
      .send({});

    expect(res.status).toBe(200);
    expect(mockIssueApprovalService.listIssuesForApproval).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("does not emit duplicate rejection logs when reject is already resolved", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "rejected",
      payload: {},
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-1",
        companyId: "company-1",
        type: "hire_agent",
        status: "rejected",
        payload: {},
      },
      applied: false,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-1/reject")
      .send({});

    expect(res.status).toBe(200);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("rejects approval decisions for companies outside the caller scope", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-2",
      companyId: "company-2",
      type: "hire_agent",
      status: "pending",
      payload: {},
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-2/approve")
      .send({});

    expect(res.status).toBe(403);
    expect(mockApprovalService.approve).not.toHaveBeenCalled();
  });

  it("rejects approval revision requests for companies outside the caller scope", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-3",
      companyId: "company-2",
      type: "hire_agent",
      status: "pending",
      payload: {},
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-3/request-revision")
      .send({ decisionNote: "Need changes" });

    expect(res.status).toBe(403);
    expect(mockApprovalService.requestRevision).not.toHaveBeenCalled();
  });

  it("derives approval attribution from the authenticated actor on approve", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-4",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: {},
      requestedByAgentId: null,
    });
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-4",
        companyId: "company-1",
        type: "hire_agent",
        status: "approved",
        payload: {},
        requestedByAgentId: null,
      },
      applied: true,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-4/approve")
      .send({ decidedByUserId: "forged-user", decisionNote: "ship it" });

    expect(res.status).toBe(200);
    expect(mockApprovalService.approve).toHaveBeenCalledWith("approval-4", "user-1", "ship it");
  });

  it("derives approval attribution from the authenticated actor on reject", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-5",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: {},
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-5",
        companyId: "company-1",
        type: "hire_agent",
        status: "rejected",
        payload: {},
      },
      applied: true,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-5/reject")
      .send({ decidedByUserId: "forged-user", decisionNote: "not now" });

    expect(res.status).toBe(200);
    expect(mockApprovalService.reject).toHaveBeenCalledWith("approval-5", "user-1", "not now");
  });

  it("wakes the requesting agent with approval_rejected reason when reject is applied", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-7",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-42",
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-7",
        companyId: "company-1",
        type: "request_board_approval",
        status: "rejected",
        payload: {},
        requestedByAgentId: "agent-42",
      },
      applied: true,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-7/reject")
      .send({ decisionNote: "not aligned with strategy" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "agent-42",
      expect.objectContaining({
        reason: "approval_rejected",
        payload: expect.objectContaining({
          approvalId: "approval-7",
          approvalStatus: "rejected",
          decisionNote: "not aligned with strategy",
          issueId: "issue-1",
          issueIds: ["issue-1"],
        }),
        contextSnapshot: expect.objectContaining({
          wakeReason: "approval_rejected",
          approvalId: "approval-7",
          approvalStatus: "rejected",
          decisionNote: "not aligned with strategy",
        }),
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "approval.requester_wakeup_queued",
        details: expect.objectContaining({
          wakeReason: "approval_rejected",
          requesterAgentId: "agent-42",
        }),
      }),
    );
  });

  it("does not wake when reject is already applied (applied=false)", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-8",
      companyId: "company-1",
      type: "request_board_approval",
      status: "rejected",
      payload: {},
      requestedByAgentId: "agent-42",
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-8",
        companyId: "company-1",
        type: "request_board_approval",
        status: "rejected",
        payload: {},
        requestedByAgentId: "agent-42",
      },
      applied: false,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-8/reject")
      .send({});

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("does not wake on reject when requestedByAgentId is null", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-9",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: null,
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-9",
        companyId: "company-1",
        type: "request_board_approval",
        status: "rejected",
        payload: {},
        requestedByAgentId: null,
      },
      applied: true,
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-9/reject")
      .send({ decisionNote: "no agent, no wake" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("derives approval attribution from the authenticated actor on request revision", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-6",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: {},
    });
    mockApprovalService.requestRevision.mockResolvedValue({
      id: "approval-6",
      companyId: "company-1",
      type: "hire_agent",
      status: "revision_requested",
      payload: {},
    });

    const res = await request(await createApp())
      .post("/api/approvals/approval-6/request-revision")
      .send({ decidedByUserId: "forged-user", decisionNote: "Need changes" });

    expect(res.status).toBe(200);
    expect(mockApprovalService.requestRevision).toHaveBeenCalledWith(
      "approval-6",
      "user-1",
      "Need changes",
    );
  });

  it("does not wake a cross-company agent on reject", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-10",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-foreign",
    });
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-10",
        companyId: "company-1",
        type: "request_board_approval",
        status: "rejected",
        payload: {},
        requestedByAgentId: "agent-foreign",
      },
      applied: true,
    });
    // Agent belongs to a different company — guard must block the wake.
    mockAgentService.getById.mockResolvedValue({ id: "agent-foreign", companyId: "company-other" });

    const res = await request(await createApp())
      .post("/api/approvals/approval-10/reject")
      .send({ decisionNote: "cross-company reject" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("uses the first non-terminal linked issue as the wake anchor (done first, backlog second)", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-20",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-42",
    });
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-20",
        companyId: "company-1",
        type: "request_board_approval",
        status: "approved",
        payload: {},
        requestedByAgentId: "agent-42",
      },
      applied: true,
    });
    // Editor issue is done; parent issue (backlog) should be the anchor.
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([
      { id: "editor-done", status: "done" },
      { id: "parent-backlog", status: "backlog", assigneeAgentId: "agent-42" },
    ]);

    const res = await request(await createApp())
      .post("/api/approvals/approval-20/approve")
      .send({});

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "agent-42",
      expect.objectContaining({
        payload: expect.objectContaining({
          issueId: "parent-backlog",
          issueIds: ["editor-done", "parent-backlog"],
        }),
        contextSnapshot: expect.objectContaining({
          issueId: "parent-backlog",
          taskId: "parent-backlog",
        }),
      }),
    );
  });

  it("does not anchor to a non-terminal issue owned by a DIFFERENT agent (would be cancelled as stale)", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-21",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-42",
    });
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-21",
        companyId: "company-1",
        type: "request_board_approval",
        status: "approved",
        payload: {},
        requestedByAgentId: "agent-42",
      },
      applied: true,
    });
    // Requester's own issue is done; the only live issue belongs to another
    // agent — anchoring there would get the queued run cancelled as stale
    // (assigneeAgentId !== run.agentId). Expect an agent-level wake instead.
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([
      { id: "editor-done", status: "done", assigneeAgentId: "agent-42" },
      { id: "poster-backlog", status: "backlog", assigneeAgentId: "agent-publisher" },
    ]);

    const res = await request(await createApp())
      .post("/api/approvals/approval-21/approve")
      .send({});

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "agent-42",
      expect.objectContaining({
        payload: expect.objectContaining({ issueId: null }),
      }),
    );
  });

  it("uses null anchor (agent-level wake) when all linked issues are terminal", async () => {
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-21",
      companyId: "company-1",
      type: "request_board_approval",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-42",
    });
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-21",
        companyId: "company-1",
        type: "request_board_approval",
        status: "approved",
        payload: {},
        requestedByAgentId: "agent-42",
      },
      applied: true,
    });
    // All linked issues terminal — anchor must be null so the run is not cancelled.
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([
      { id: "issue-done", status: "done" },
      { id: "issue-cancelled", status: "cancelled" },
    ]);

    const res = await request(await createApp())
      .post("/api/approvals/approval-21/approve")
      .send({});

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "agent-42",
      expect.objectContaining({
        payload: expect.objectContaining({
          issueId: null,
          issueIds: ["issue-done", "issue-cancelled"],
        }),
        contextSnapshot: expect.objectContaining({
          issueId: null,
          taskId: null,
        }),
      }),
    );
  });

  it("lets agents create generic issue-linked board approval requests", async () => {
    mockApprovalService.create.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "request_board_approval",
      requestedByAgentId: "agent-1",
      requestedByUserId: null,
      status: "pending",
      payload: { title: "Approve hosting spend", proposedComment: "## Section\nProposed body" },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: new Date("2026-04-06T00:00:00.000Z"),
      updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    });

    const res = await request(await createAgentApp())
      .post("/api/companies/company-1/approvals")
      .send({
        type: "request_board_approval",
        issueIds: ["00000000-0000-0000-0000-000000000001"],
        payload: { title: "Approve hosting spend", proposedComment: "## Section\nProposed body" },
      });

    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body).toMatchObject({
      companyId: "company-1",
      type: "request_board_approval",
      requestedByAgentId: "agent-1",
      requestedByUserId: null,
      status: "pending",
    });
    expect(mockSecretService.normalizeHireApprovalPayloadForPersistence).not.toHaveBeenCalled();
    expect(mockIssueApprovalService.linkManyForApproval).toHaveBeenCalledWith(
      "approval-1",
      ["00000000-0000-0000-0000-000000000001"],
      { agentId: "agent-1", userId: null },
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "agent",
        actorId: "agent-1",
        action: "approval.created",
        // Downstream consumers (discord-fleet plugin's approvalsChannelsByType
        // regex routing + chunked-comment posting) match on details.title and
        // read details.proposedComment; if either is dropped from the emit,
        // routes fall through to the orphan fallback and the proposedComment
        // is silently dropped.
        details: expect.objectContaining({
          type: "request_board_approval",
          issueIds: ["00000000-0000-0000-0000-000000000001"],
          title: "Approve hosting spend",
          proposedComment: "## Section\nProposed body",
        }),
      }),
    );
  
});
});
