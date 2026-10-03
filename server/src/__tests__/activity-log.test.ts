import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activityLog, companies, createDb } from "@paperclipai/db";
import { logActivity, type ActivityPublication } from "../services/activity-log.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

// Fleet carry (2026-07-11 live incident): runId comes straight from the
// caller-supplied X-Paperclip-Run-Id header. activity_log.run_id is a uuid
// column AND a foreign key into heartbeat_runs, so a malformed or stale value
// must be dropped to null — never 500 the mutation the row is recording.
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("logActivity run-id guard", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const companyId = randomUUID();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-activity-run-id-guard-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it.each([
    ["a malformed (non-uuid) run id", "manual-20260703T000000Z-123"],
    ["a well-formed but unknown run id", "11111111-1111-4111-8111-111111111111"],
  ])("drops %s to null in the row and every published payload", async (_label, runId) => {
    const entityId = randomUUID();
    const publications: ActivityPublication[] = [];
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: "user-1",
      action: "approval.created",
      entityType: "approval",
      entityId,
      runId,
      details: { type: "request_board_approval" },
    }, publications);

    const row = await db
      .select({ runId: activityLog.runId })
      .from(activityLog)
      .where(eq(activityLog.entityId, entityId))
      .then((rows) => rows[0]);
    expect(row).toBeDefined();
    expect(row?.runId).toBeNull();
    expect(publications[0]?.payload).toMatchObject({ runId: null });
    // Typed plugin event payloads carry the action (discord-fleet demuxes on it).
    expect(publications[0]?.pluginEvent?.payload).toMatchObject({
      action: "approval.created",
      runId: null,
    });
  });
});
