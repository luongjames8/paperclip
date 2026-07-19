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

  it("unlink(): clears approvalKind when the last kind-bearing issue is unlinked", async () => {
    const { issueId, approvalId } = await seed({ issueApprovalKind: "content_batch_approval" });
    await svc.link(issueId, approvalId);
    await svc.unlink(issueId, approvalId);
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.approvalKind).toBeNull();
  });

  it("unlink(): recomputes to the remaining issue's kind, not left stale", async () => {
    const { companyId, issueId: issueA, approvalId } = await seed({ issueApprovalKind: "content_batch_approval" });
    const issueB = randomUUID();
    await db.insert(issues).values({
      id: issueB, companyId, title: "B", status: "todo", priority: "medium", approvalKind: "content_batch_approval",
    });
    await svc.linkManyForApproval(approvalId, [issueA, issueB]);
    await svc.unlink(issueA, approvalId);
    // issueB is still linked and carries the same kind — approvalKind survives.
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.approvalKind).toBe("content_batch_approval");
  });

  it("unlink(): a previously-cleared approval can now link to a DIFFERENT kind — no stale-value 422", async () => {
    const { companyId, issueId, approvalId } = await seed({ issueApprovalKind: "content_batch_approval" });
    await svc.link(issueId, approvalId);
    await svc.unlink(issueId, approvalId);

    const otherIssue = randomUUID();
    await db.insert(issues).values({
      id: otherIssue, companyId, title: "Other", status: "todo", priority: "medium", approvalKind: "hire_review",
    });
    await expect(svc.link(otherIssue, approvalId)).resolves.toBeTruthy();
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.approvalKind).toBe("hire_review");
  });

  // codex P2 round 3 (both findings pin one comprehensive pass, not two
  // more reactive patches): linkManyForApproval must hand its resolved kind
  // back to callers that already captured their own approval object before
  // calling it (routes/agents.ts's hire flow), and every approval/issue
  // listing this service exposes must actually project approvalKind.

  it("linkManyForApproval(): returns the resolved approvalKind so a caller holding a stale local approval object can refresh it", async () => {
    const { companyId, approvalId } = await seed();
    const issueA = randomUUID();
    await db.insert(issues).values({
      id: issueA, companyId, title: "A", status: "todo", priority: "medium", approvalKind: "content_batch_approval",
    });
    const result = await svc.linkManyForApproval(approvalId, [issueA]);
    expect(result).toEqual({ approvalKind: "content_batch_approval" });
  });

  it("linkManyForApproval(): with zero issueIds returns the approval's CURRENT approvalKind, not null", async () => {
    const { approvalId } = await seed({ approvalApprovalKind: "content_batch_approval" });
    const result = await svc.linkManyForApproval(approvalId, []);
    expect(result).toEqual({ approvalKind: "content_batch_approval" });
  });

  it("listApprovalsForIssue(): includes approvalKind in each returned approval", async () => {
    const { issueId, approvalId } = await seed({ issueApprovalKind: "content_batch_approval" });
    await svc.link(issueId, approvalId);
    const [approval] = await svc.listApprovalsForIssue(issueId);
    expect(approval).toMatchObject({ id: approvalId, approvalKind: "content_batch_approval" });
  });

  it("listIssuesForApproval(): includes approvalKind in each returned issue", async () => {
    const { issueId, approvalId } = await seed({ issueApprovalKind: "content_batch_approval" });
    await svc.link(issueId, approvalId);
    const [issue] = await svc.listIssuesForApproval(approvalId);
    expect(issue).toMatchObject({ id: issueId, approvalKind: "content_batch_approval" });
  });

  // codex P2 round 5 (adversarial pass, treadmill halt — closes the class by
  // construction rather than patching one more edge): two concurrent link()
  // calls linking DIFFERENTLY-kinded issues to the SAME approval must not
  // both silently "succeed" with the last write winning. The row lock
  // serializes them: whichever acquires it first commits its kind: the
  // second then sees that committed value and correctly rejects as a
  // conflict, rather than each reading the same pre-link null and racing.
  it("link(): concurrent links of conflicting-kind issues to the same approval serialize — exactly one succeeds, none corrupt the stored kind", async () => {
    const { companyId, approvalId } = await seed();
    const issueA = randomUUID();
    const issueB = randomUUID();
    await db.insert(issues).values([
      { id: issueA, companyId, title: "A", status: "todo", priority: "medium", approvalKind: "content_batch_approval" },
      { id: issueB, companyId, title: "B", status: "todo", priority: "medium", approvalKind: "hire_review" },
    ]);

    const results = await Promise.allSettled([
      svc.link(issueA, approvalId),
      svc.link(issueB, approvalId),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 422 });

    // The stored kind matches whichever issue's link actually committed —
    // never corrupted, never the loser's kind, never both/neither.
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(["content_batch_approval", "hire_review"]).toContain(row!.approvalKind);
    const links = await db.select().from(issueApprovals).where(eq(issueApprovals.approvalId, approvalId));
    expect(links).toHaveLength(1);
    const linkedIssueKind = links[0]!.issueId === issueA ? "content_batch_approval" : "hire_review";
    expect(row!.approvalKind).toBe(linkedIssueKind);
  });
});
