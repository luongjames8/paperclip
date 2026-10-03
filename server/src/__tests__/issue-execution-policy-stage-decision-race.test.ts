/**
 * Real-Postgres concurrency test for the stage-decision compare-and-swap
 * (fleet issue #631 / PR-0, codex round 4): two concurrent PATCH requests
 * racing to resolve the SAME executionPolicy stage must not both succeed.
 *
 * The route-level mocked-DB tests (issue-execution-policy-routes.test.ts)
 * can only simulate the race (a mocked FOR UPDATE read returning a
 * pre-scripted "someone else already decided" state) — they can't prove the
 * actual Postgres row lock serializes two REAL concurrent transactions. This
 * file does, using the same embedded-Postgres harness as
 * issue-stale-execution-lock-routes.test.ts.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueComments,
  issueExecutionDecisions,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres stage-decision race tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("executionPolicy stage-decision race (real Postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-stage-decision-race-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueExecutionDecisions);
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(actor: Express.Request["actor"]) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);
    return app;
  }

  function boardActor(companyId: string): Express.Request["actor"] {
    return {
      type: "board",
      userId: "board-user",
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "admin", status: "active" }],
      isInstanceAdmin: false,
      source: "session",
    };
  }

  async function seedPendingReviewIssue() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const stageId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
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

    const executionPolicy = {
      mode: "normal",
      commentRequired: true,
      stages: [
        {
          id: stageId,
          type: "review",
          approvalsNeeded: 1,
          participants: [{ id: randomUUID(), type: "user", userId: "board-user", agentId: null }],
        },
      ],
    };
    const executionState = {
      status: "pending",
      currentStageId: stageId,
      currentStageIndex: 0,
      currentStageType: "review",
      currentParticipant: { type: "user", userId: "board-user", agentId: null },
      returnAssignee: { type: "agent", agentId, userId: null },
      completedStageIds: [],
      lastDecisionId: null,
      lastDecisionOutcome: null,
    };

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Race the stage decision",
      status: "in_review",
      priority: "high",
      assigneeAgentId: null,
      assigneeUserId: "board-user",
      executionPolicy,
      executionState,
    });

    return { companyId, agentId, stageId, issueId };
  }

  it(
    "exactly one PATCH decision wins the race, the other gets 409 and applies no mutation",
    async () => {
      const { companyId, stageId, issueId } = await seedPendingReviewIssue();
      const app = createApp(boardActor(companyId));

      const [first, second] = await Promise.all([
        request(app)
          .patch(`/api/issues/${issueId}`)
          .send({ status: "done", comment: "Approved (request A)", expectedExecutionStageId: stageId }),
        request(app)
          .patch(`/api/issues/${issueId}`)
          .send({ status: "done", comment: "Approved (request B)", expectedExecutionStageId: stageId }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses, JSON.stringify({ first: first.body, second: second.body })).toEqual([200, 409]);

      // Exactly one decision was recorded — the loser's transaction rolled
      // back before its issueExecutionDecisions insert.
      const decisions = await db
        .select({ id: issueExecutionDecisions.id })
        .from(issueExecutionDecisions)
        .where(eq(issueExecutionDecisions.issueId, issueId));
      expect(decisions).toHaveLength(1);

      // The issue landed in a single, consistent terminal state — not
      // half-applied by the loser.
      const row = await db
        .select({ status: issues.status, executionState: issues.executionState })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0]);
      expect(row?.status).toBe("done");
      expect((row?.executionState as { status?: string } | null)?.status).toBe("completed");
    },
    20_000,
  );
});
