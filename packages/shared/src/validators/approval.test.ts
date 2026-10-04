import { describe, expect, it } from "vitest";
import {
  addApprovalCommentSchema,
  createApprovalSchema,
  requestApprovalRevisionSchema,
  resolveApprovalSchema,
  resubmitApprovalSchema,
} from "./approval.js";

describe("approval validators", () => {
  // GH #501 / codex P1 class (see packages/shared/src/validators/issue.ts's
  // requestConfirmationPayloadSchema.carouselBatch comment): validate()
  // REPLACES req.body with the zod parse result, and a STRICT z.object parse
  // strips unknown keys — so an unenumerated payload field can silently never
  // persist. createApprovalSchema/resubmitApprovalSchema's `payload` field is
  // z.record(z.string(), z.unknown()) (NOT a strict object), which preserves
  // every key including postsBatch — no schema change was needed for the
  // discord-fleet postsBatch structured render contract to survive the parse.
  // This test pins that record-preserves-unknown-keys behavior so a future
  // tightening to a strict object (which WOULD reintroduce the strip-class
  // bug) is caught immediately.
  it("createApprovalSchema.payload is a record — preserves postsBatch and any other unknown key through parse", () => {
    const parsed = createApprovalSchema.parse({
      type: "request_board_approval",
      payload: {
        title: "Weekly posts batch",
        proposedComment: "prose artifact",
        postsBatch: {
          version: 1,
          weekOf: "2026-07-13",
          items: [{ slug: "akihabara", day: "Sat", postTime: null, imageUrl: "https://r2.example.com/a1.jpg", hook: "Electric town.", platforms: { threads: "..." } }],
        },
      },
    });

    const payload = parsed.payload as Record<string, unknown>;
    expect(payload.postsBatch).toMatchObject({ version: 1, weekOf: "2026-07-13" });
    expect((payload.postsBatch as Record<string, unknown>).items).toHaveLength(1);
  });

  it("resubmitApprovalSchema.payload is also a record — preserves postsBatch through the resubmit (request-changes) cycle", () => {
    const parsed = resubmitApprovalSchema.parse({
      payload: {
        postsBatch: { version: 1, items: [] },
      },
    });

    const payload = parsed.payload as Record<string, unknown>;
    expect(payload.postsBatch).toMatchObject({ version: 1, items: [] });
  });

  it("passes real line breaks through unchanged", () => {
    expect(addApprovalCommentSchema.parse({ body: "Looks good\n\nApproved." }).body)
      .toBe("Looks good\n\nApproved.");
    expect(resolveApprovalSchema.parse({ decisionNote: "Decision\n\nApproved." }).decisionNote)
      .toBe("Decision\n\nApproved.");
  });

  it("accepts null and omitted optional decision notes", () => {
    expect(resolveApprovalSchema.parse({ decisionNote: null }).decisionNote).toBeNull();
    expect(resolveApprovalSchema.parse({}).decisionNote).toBeUndefined();
    expect(requestApprovalRevisionSchema.parse({ decisionNote: null }).decisionNote).toBeNull();
    expect(requestApprovalRevisionSchema.parse({}).decisionNote).toBeUndefined();
  });

  it("normalizes escaped line breaks in approval comments and decision notes", () => {
    expect(addApprovalCommentSchema.parse({ body: "Looks good\\n\\nApproved." }).body)
      .toBe("Looks good\n\nApproved.");
    expect(resolveApprovalSchema.parse({ decisionNote: "Decision\\n\\nApproved." }).decisionNote)
      .toBe("Decision\n\nApproved.");
    expect(requestApprovalRevisionSchema.parse({ decisionNote: "Decision\\r\\nRevise." }).decisionNote)
      .toBe("Decision\nRevise.");
  });
});
