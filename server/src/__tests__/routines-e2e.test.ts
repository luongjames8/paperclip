import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  companies,
  companyMemberships,
  createDb,
  documentAnnotationAnchorSnapshots,
  documentAnnotationComments,
  documentAnnotationThreads,
  documentRevisions,
  documents,
  executionWorkspaces,
  heartbeatRunEvents,
  heartbeatRuns,
  instanceSettings,
  issueComments,
  issueExecutionDecisions,
  issues,
  principalPermissionGrants,
  projectWorkspaces,
  projects,
  routineDocuments,
  routineRuns,
  routines,
  routineTriggers,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { accessService } from "../services/access.js";

function registerRoutineServiceMock() {
  vi.doMock("../services/routines.js", async () => {
    const actual = await vi.importActual<typeof import("../services/routines.js")>("../services/routines.js");

    return {
      ...actual,
      routineService: (db: any) =>
        actual.routineService(db, {
          heartbeat: {
            wakeup: async (agentId: string, wakeupOpts: any) => {
              const issueId =
                (typeof wakeupOpts?.payload?.issueId === "string" && wakeupOpts.payload.issueId) ||
                (typeof wakeupOpts?.contextSnapshot?.issueId === "string" && wakeupOpts.contextSnapshot.issueId) ||
                null;
              if (!issueId) return null;

              const issue = await db
                .select({ companyId: issues.companyId })
                .from(issues)
                .where(eq(issues.id, issueId))
                .then((rows: Array<{ companyId: string }>) => rows[0] ?? null);
              if (!issue) return null;

              const queuedRunId = randomUUID();
              await db.insert(heartbeatRuns).values({
                id: queuedRunId,
                companyId: issue.companyId,
                agentId,
                invocationSource: wakeupOpts?.source ?? "assignment",
                triggerDetail: wakeupOpts?.triggerDetail ?? null,
                status: "queued",
                contextSnapshot: { ...(wakeupOpts?.contextSnapshot ?? {}), issueId },
              });
              await db
                .update(issues)
                .set({
                  executionRunId: queuedRunId,
                  executionLockedAt: new Date(),
                })
                .where(eq(issues.id, issueId));
              return { id: queuedRunId };
            },
          },
        }),
    };
  });
}

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres routine route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("routine routes end-to-end", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-routines-e2e-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(documentAnnotationAnchorSnapshots);
    await db.delete(documentAnnotationComments);
    await db.delete(documentAnnotationThreads);
    await db.delete(routineRuns);
    await db.delete(routineTriggers);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issueExecutionDecisions);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(routineDocuments);
    await db.delete(routines);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@paperclipai/shared/telemetry");
    vi.doUnmock("../telemetry.js");
    vi.doUnmock("../services/access.js");
    vi.doUnmock("../services/issues.js");
    vi.doUnmock("../services/companies.js");
    vi.doUnmock("../services/projects.js");
    vi.doUnmock("../services/company-skills.js");
    vi.doUnmock("../services/assets.js");
    vi.doUnmock("../services/agent-instructions.js");
    vi.doUnmock("../services/workspace-runtime.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../services/routines.js");
    vi.doUnmock("../routes/routines.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerRoutineServiceMock();
    vi.doMock("../routes/authz.js", async () => vi.importActual("../routes/authz.js"));
    vi.clearAllMocks();
  });

  async function createApp(actor: Record<string, unknown>) {
    const [{ routineRoutes }, { errorHandler }] = await Promise.all([
      import("../routes/routines.js"),
      import("../middleware/index.js"),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use("/api", routineRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function postRoutineRun(
    app: express.Express,
    routineId: string,
    body: Record<string, unknown>,
  ) {
    let response = await request(app)
      .post(`/api/routines/${routineId}/run`)
      .send(body);
    if (response.status === 500) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      response = await request(app)
        .post(`/api/routines/${routineId}/run`)
        .send(body);
    }
    return response;
  }

  async function seedFixture() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Routine Project",
      status: "in_progress",
    });

    const access = accessService(db);
    const membership = await access.ensureMembership(companyId, "user", userId, "owner", "active");
    await access.setMemberPermissions(
      companyId,
      membership.id,
      [{ permissionKey: "tasks:assign" }],
      userId,
    );

    return { companyId, agentId, projectId, userId };
  }

  it("supports creating, scheduling, and manually running a routine through the API", async () => {
    const { companyId, agentId, projectId, userId } = await seedFixture();
    const app = await createApp({
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    });

    const createRes = await request(app)
      .post(`/api/companies/${companyId}/routines`)
      .send({
        projectId,
        title: "Daily standup prep",
        description: "Summarize blockers and open PRs",
        assigneeAgentId: agentId,
        priority: "high",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
      });

    expect([200, 201]).toContain(createRes.status);
    expect(createRes.body.title).toBe("Daily standup prep");
    expect(createRes.body.assigneeAgentId).toBe(agentId);

    const routineId = createRes.body.id as string;

    const triggerRes = await request(app)
      .post(`/api/routines/${routineId}/triggers`)
      .send({
        kind: "schedule",
        label: "Weekday morning",
        cronExpression: "0 10 * * 1-5",
        timezone: "UTC",
      });

    expect([200, 201], JSON.stringify(triggerRes.body)).toContain(triggerRes.status);
    const createdTrigger = triggerRes.body.trigger ?? triggerRes.body;
    expect(createdTrigger.kind).toBe("schedule");
    expect(createdTrigger.enabled).toBe(true);
    expect(triggerRes.body.secretMaterial).toBeNull();

    const runRes = await postRoutineRun(app, routineId, {
      source: "manual",
      payload: { origin: "e2e-test" },
    });

    expect(runRes.status).toBe(202);
    expect(runRes.body.status).toBe("issue_created");
    expect(runRes.body.source).toBe("manual");
    expect(runRes.body.linkedIssueId).toBeTruthy();

    const listRes = await request(app).get(`/api/companies/${companyId}/routines`);
    expect(listRes.status).toBe(200);
    const listed = listRes.body.find((r: { id: string }) => r.id === routineId);
    expect(listed).toBeDefined();
    expect(listed.triggers).toHaveLength(1);
    expect(listed.triggers[0].cronExpression).toBe("0 10 * * 1-5");
    expect(listed.triggers[0].timezone).toBe("UTC");

    const detailRes = await request(app).get(`/api/routines/${routineId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.triggers).toHaveLength(1);
    expect(detailRes.body.triggers[0]?.id).toBe(createdTrigger.id);
    expect(detailRes.body.recentRuns).toHaveLength(1);
    expect(detailRes.body.recentRuns[0]?.id).toBe(runRes.body.id);
    expect(detailRes.body.activeIssue?.id).toBe(runRes.body.linkedIssueId);

    const runsRes = await request(app).get(`/api/routines/${routineId}/runs?limit=10`);
    expect(runsRes.status).toBe(200);
    const [persistedRun] = await db
      .select({ id: routineRuns.id })
      .from(routineRuns)
      .where(eq(routineRuns.id, runRes.body.id));
    expect(persistedRun?.id).toBe(runRes.body.id);

    const [issue] = await db
      .select({
        id: issues.id,
        originId: issues.originId,
        originKind: issues.originKind,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(eq(issues.id, runRes.body.linkedIssueId));

    expect(issue).toMatchObject({
      id: runRes.body.linkedIssueId,
      originId: routineId,
      originKind: "routine_execution",
    });
    expect(issue?.executionRunId).toBeTruthy();

    const actions = await db
      .select({
        action: activityLog.action,
      })
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId));

    expect(actions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "routine.created",
        "routine.trigger_created",
        "routine.run_triggered",
      ]),
    );
  }, 15_000);

  it("runs routines with variable inputs and interpolates the execution issue description", async () => {
    const { companyId, agentId, projectId, userId } = await seedFixture();
    const app = await createApp({
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    });

    const createRes = await request(app)
      .post(`/api/companies/${companyId}/routines`)
      .send({
        projectId,
        title: "Repository triage",
        description: "Review {{repo}} for {{priority}} bugs",
        assigneeAgentId: agentId,
        variables: [
          { name: "repo", type: "text", required: true },
          { name: "priority", type: "select", required: true, defaultValue: "high", options: ["high", "low"] },
        ],
      });

    expect([200, 201], JSON.stringify(createRes.body)).toContain(createRes.status);

    const runRes = await postRoutineRun(app, createRes.body.id, {
      source: "manual",
      variables: { repo: "paperclip" },
    });

    expect(runRes.status).toBe(202);
    expect(runRes.body.triggerPayload).toEqual({
      variables: {
        repo: "paperclip",
        priority: "high",
      },
    });

    const [issue] = await db
      .select({ description: issues.description })
      .from(issues)
      .where(eq(issues.id, runRes.body.linkedIssueId));

    expect(issue?.description).toBe("Review paperclip for high bugs");
  });

  it("allows drafting a routine without defaults and running it with one-off overrides", async () => {
    const { companyId, agentId, projectId, userId } = await seedFixture();
    const app = await createApp({
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    });

    const createRes = await request(app)
      .post(`/api/companies/${companyId}/routines`)
      .send({
        title: "Draft routine",
        description: "No saved defaults",
      });

    expect([200, 201], JSON.stringify(createRes.body)).toContain(createRes.status);
    expect(createRes.body.projectId ?? null).toBeNull();
    expect(createRes.body.assigneeAgentId ?? null).toBeNull();
    expect(createRes.body.status).toBe("paused");

    const runRes = await postRoutineRun(app, createRes.body.id, {
      source: "manual",
      projectId,
      assigneeAgentId: agentId,
    });

    expect(runRes.status).toBe(202);
    expect(runRes.body.status).toBe("issue_created");

    const [issue] = await db
      .select({
        projectId: issues.projectId,
        assigneeAgentId: issues.assigneeAgentId,
      })
      .from(issues)
      .where(eq(issues.id, runRes.body.linkedIssueId));

    expect(issue).toEqual({
      projectId,
      assigneeAgentId: agentId,
    });
  });

  it("persists execution workspace selections from manual routine runs", async () => {
    const { companyId, agentId, projectId, userId } = await seedFixture();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();
    const app = await createApp({
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      companyId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
      sharedWorkspaceKey: "routine-primary",
    });
    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      companyId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Routine worktree",
      status: "active",
      providerType: "git_worktree",
    });
    await db
      .update(projects)
      .set({
        executionWorkspacePolicy: {
          enabled: true,
          defaultMode: "shared_workspace",
          defaultProjectWorkspaceId: projectWorkspaceId,
        },
      })
      .where(eq(projects.id, projectId));
    await db.insert(instanceSettings).values({
      experimental: { enableIsolatedWorkspaces: true },
    });

    const createRes = await request(app)
      .post(`/api/companies/${companyId}/routines`)
      .send({
        projectId,
        title: "Workspace-aware routine",
        assigneeAgentId: agentId,
      });

    expect([200, 201], JSON.stringify(createRes.body)).toContain(createRes.status);

    const runRes = await postRoutineRun(app, createRes.body.id, {
      source: "manual",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: { mode: "isolated_workspace" },
    });

    expect(runRes.status).toBe(202);

    const [issue] = await db
      .select({
        projectWorkspaceId: issues.projectWorkspaceId,
        executionWorkspaceId: issues.executionWorkspaceId,
        executionWorkspacePreference: issues.executionWorkspacePreference,
        executionWorkspaceSettings: issues.executionWorkspaceSettings,
      })
      .from(issues)
      .where(eq(issues.id, runRes.body.linkedIssueId));

    expect(issue).toEqual({
      projectWorkspaceId,
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: { mode: "isolated_workspace" },
    });
  });

  it("carries the routine execution policy onto the spawned issue and hands completion to the stage-1 reviewer with a wake", async () => {
    const { companyId, agentId: writerAgentId, projectId, userId } = await seedFixture();
    const editorAgentId = randomUUID();
    await db.insert(agents).values({
      id: editorAgentId,
      companyId,
      name: "Editor",
      role: "editor",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const boardApp = await createApp({
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    });

    const createRes = await request(boardApp)
      .post(`/api/companies/${companyId}/routines`)
      .send({
        projectId,
        title: "Weekly article",
        description: "Draft, then editor QC",
        assigneeAgentId: writerAgentId,
        executionPolicy: {
          stages: [{ type: "review", participants: [{ type: "agent", agentId: editorAgentId }] }],
        },
      });
    expect([200, 201], JSON.stringify(createRes.body)).toContain(createRes.status);
    const stageId = createRes.body.executionPolicy?.stages?.[0]?.id;
    expect(stageId).toBeTruthy();

    const runRes = await postRoutineRun(boardApp, createRes.body.id, { source: "manual" });
    expect(runRes.status).toBe(202);
    const issueId = runRes.body.linkedIssueId as string;
    expect(issueId).toBeTruthy();

    const [spawned] = await db
      .select({ executionPolicy: issues.executionPolicy, executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, issueId));
    expect(spawned?.executionPolicy).toEqual(createRes.body.executionPolicy);

    const [{ issueRoutes }, { errorHandler }] = await Promise.all([
      import("../routes/issues.js"),
      import("../middleware/index.js"),
    ]);
    const issueApp = express();
    issueApp.use(express.json());
    issueApp.use((req, _res, next) => {
      (req as any).actor = {
        type: "agent",
        agentId: writerAgentId,
        companyId,
        runId: spawned?.executionRunId ?? null,
        source: "agent_jwt",
      };
      next();
    });
    issueApp.use("/api", issueRoutes(db, {} as any));
    issueApp.use(errorHandler);

    const patchRes = await request(issueApp)
      .patch(`/api/issues/${issueId}`)
      .send({ status: "done", comment: "draft ready for QC" });
    expect(patchRes.status, JSON.stringify(patchRes.body)).toBe(200);

    const [afterPatch] = await db
      .select({
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
        executionState: issues.executionState,
      })
      .from(issues)
      .where(eq(issues.id, issueId));
    expect(afterPatch?.status).toBe("in_review");
    expect(afterPatch?.assigneeAgentId).toBe(editorAgentId);
    expect(afterPatch?.executionState).toMatchObject({
      status: "pending",
      currentStageId: stageId,
      currentParticipant: { type: "agent", agentId: editorAgentId },
    });

    // The stage wake is dispatched fire-and-forget after the PATCH responds — poll briefly.
    // The writer's execution run (seeded by the routine-dispatch wake mock) is still
    // active, so the engine parks the editor's wake in deferred_issue_execution; it is
    // released natively when that run completes. The review-request context must ride
    // the deferred payload so the editor's eventual heartbeat still sees the stage.
    let editorWake: { reason: string | null; status: string; payload: Record<string, unknown> | null } | undefined;
    for (let attempt = 0; attempt < 40 && !editorWake; attempt += 1) {
      const wakes = await db
        .select({
          reason: agentWakeupRequests.reason,
          status: agentWakeupRequests.status,
          payload: agentWakeupRequests.payload,
        })
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.agentId, editorAgentId));
      editorWake = wakes[0];
      if (!editorWake) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(editorWake?.status).toBe("deferred_issue_execution");
    expect(editorWake?.payload?.issueId).toBe(issueId);
    expect(editorWake?.payload?.executionStage).toMatchObject({
      stageId,
      stageType: "review",
      wakeRole: "reviewer",
    });
  }, 20_000);
});
