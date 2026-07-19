import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  approvals,
  companies,
  createDb,
  issueApprovals,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueApprovalService } from "../services/issue-approvals.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

// Fleet issue #687 (codex P2): approvals.approvalKind must stay consistent
// whenever an issue is linked to an approval — not just at creation time.
// resolveApprovalKindFromLinkedIssues (routes/approvals.ts) only covers
// issueIds passed at creation; link()/linkManyForApproval() (this service)
// are the ONLY choke point every other linking path (POST /issues/:id/approvals,
// the hire_agent flow in routes/agents.ts) routes through.
describeEmbeddedPostgres("issueApprovalService approvalKind consistency (fleet issue #687)", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueApprovalService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-approvals-");
    db = createDb(tempDb.connectionString);
    svc = issueApprovalService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueApprovals);
    await db.delete(approvals);
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed(opts: { issueApprovalKind?: string | null; approvalApprovalKind?: string | null } = {}) {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Weekly content batch",
      status: "todo",
      priority: "medium",
      approvalKind: opts.issueApprovalKind ?? null,
    });
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId,
      companyId,
      type: "request_board_approval",
      status: "pending",
      payload: {},
      approvalKind: opts.approvalApprovalKind ?? null,
    });
    return { companyId, issueId, approvalId };
  }

  it("link(): a kind-bearing issue fills in a null approvalKind on the approval", async () => {
    const { issueId, approvalId } = await seed({ issueApprovalKind: "content_batch_approval" });
    await svc.link(issueId, approvalId);
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.approvalKind).toBe("content_batch_approval");
  });

  it("link(): a null-kind issue leaves the approval's existing kind untouched", async () => {
    const { issueId, approvalId } = await seed({
      issueApprovalKind: null,
      approvalApprovalKind: "content_batch_approval",
    });
    await svc.link(issueId, approvalId);
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.approvalKind).toBe("content_batch_approval");
  });

  it("link(): matching kinds is a no-op (not an error)", async () => {
    const { issueId, approvalId } = await seed({
      issueApprovalKind: "content_batch_approval",
      approvalApprovalKind: "content_batch_approval",
    });
    await expect(svc.link(issueId, approvalId)).resolves.toBeTruthy();
  });

  it("link(): rejects a link that would make the approval's approvalKind inconsistent", async () => {
    const { issueId, approvalId } = await seed({
      issueApprovalKind: "hire_review",
      approvalApprovalKind: "content_batch_approval",
    });
    await expect(svc.link(issueId, approvalId)).rejects.toMatchObject({ status: 422 });
    // Rejected before any write — the approval keeps its original kind and no link row is created.
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.approvalKind).toBe("content_batch_approval");
    const links = await db.select().from(issueApprovals).where(eq(issueApprovals.approvalId, approvalId));
    expect(links).toHaveLength(0);
  });

  it("linkManyForApproval(): fills in a null approvalKind from a batch of consistently-kinded issues", async () => {
    const { companyId, approvalId } = await seed();
    const issueA = randomUUID();
    const issueB = randomUUID();
    await db.insert(issues).values([
      { id: issueA, companyId, title: "A", status: "todo", priority: "medium", approvalKind: "content_batch_approval" },
      { id: issueB, companyId, title: "B", status: "todo", priority: "medium", approvalKind: "content_batch_approval" },
    ]);
    await svc.linkManyForApproval(approvalId, [issueA, issueB]);
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.approvalKind).toBe("content_batch_approval");
  });

  it("linkManyForApproval(): rejects a batch whose issues carry conflicting kinds — no link rows created", async () => {
    const { companyId, approvalId } = await seed();
    const issueA = randomUUID();
    const issueB = randomUUID();
    await db.insert(issues).values([
      { id: issueA, companyId, title: "A", status: "todo", priority: "medium", approvalKind: "content_batch_approval" },
      { id: issueB, companyId, title: "B", status: "todo", priority: "medium", approvalKind: "hire_review" },
    ]);
    await expect(svc.linkManyForApproval(approvalId, [issueA, issueB])).rejects.toMatchObject({ status: 422 });
    const links = await db.select().from(issueApprovals).where(eq(issueApprovals.approvalId, approvalId));
    expect(links).toHaveLength(0);
  });
});
