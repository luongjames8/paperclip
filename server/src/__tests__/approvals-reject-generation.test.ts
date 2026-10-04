import { expect, it } from "vitest";
import { approvals } from "@paperclipai/db";
import { approvalService } from "../services/approvals.ts";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

// Fleet carry: reject's optional expectedUpdatedAt makes an automated decision
// (discord-fleet auto-expiry) conditional on the generation it read, so it
// cannot land on a resubmission that happened after the read.
describeEmbeddedPostgres("approval resolve expectedUpdatedAt precondition", () => {
  const pg = useEmbeddedPostgres("approvals-reject-generation", {
    resetEach: async (db) => {
      await db.delete(approvals);
      await resetCompanyIssueFixtures(db);
    },
  });

  async function seedPending() {
    const { companyId } = await seedCompanyWithBoardAccess(pg.db, "reject-generation");
    // No explicit updatedAt: the column default (now()) carries microseconds,
    // which a caller's ISO string (ms) must still match.
    return approvalService(pg.db).create(companyId, {
      type: "request_board_approval",
      status: "pending",
      payload: { title: "Carousel week 27" },
    });
  }

  it("applies when updatedAt still matches the generation the caller read", async () => {
    const created = await seedPending();
    const svc = approvalService(pg.db);
    const read = await svc.getById(created.id);

    const result = await svc.reject(created.id, "board", "expired", read!.updatedAt.toISOString());

    expect(result.applied).toBe(true);
    expect(result.approval.status).toBe("rejected");
  });

  it("refuses (422) and leaves the resubmitted approval pending when the generation moved", async () => {
    const created = await seedPending();
    const svc = approvalService(pg.db);
    const staleRead = (await svc.getById(created.id))!.updatedAt.toISOString();

    await new Promise((r) => setTimeout(r, 5));
    await svc.requestRevision(created.id, "board", "fix the hook");
    await svc.resubmit(created.id);

    await expect(svc.reject(created.id, "board", "expired", staleRead)).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("expectedUpdatedAt mismatch"),
    });
    expect((await svc.getById(created.id))!.status).toBe("pending");
  });

  it("approve honors the same precondition", async () => {
    const created = await seedPending();
    const svc = approvalService(pg.db);
    const staleRead = (await svc.getById(created.id))!.updatedAt.toISOString();

    await new Promise((r) => setTimeout(r, 5));
    await svc.requestRevision(created.id, "board", "fix the hook");
    await svc.resubmit(created.id);

    await expect(svc.approve(created.id, "board", "ok", staleRead)).rejects.toMatchObject({ status: 422 });
    expect((await svc.getById(created.id))!.status).toBe("pending");
  });

  it("stays unconditional when expectedUpdatedAt is omitted", async () => {
    const created = await seedPending();
    const result = await approvalService(pg.db).reject(created.id, "board", "no");
    expect(result.applied).toBe(true);
  });
});
