import { z } from "zod";
import { APPROVAL_KIND_PATTERN, APPROVAL_TYPES } from "../constants.js";
import { multilineTextSchema } from "./text.js";

// Shared by routine/issue authoring (config-carried, config/schema.ts
// docs/agents/issue-tracker.md — never accepted as approval-creation input;
// see createApprovalSchema below, which deliberately has no approvalKind
// field: the server always derives it from the linked issue chain).
export const approvalKindSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(new RegExp(APPROVAL_KIND_PATTERN), "approvalKind must be a lowercase snake_case identifier (e.g. content_batch_approval)");

export const createApprovalSchema = z.object({
  type: z.enum(APPROVAL_TYPES),
  requestedByAgentId: z.string().uuid().optional().nullable(),
  payload: z.record(z.string(), z.unknown()),
  issueIds: z.array(z.string().uuid()).optional(),
});

export type CreateApproval = z.infer<typeof createApprovalSchema>;

export const resolveApprovalSchema = z.object({
  decisionNote: multilineTextSchema.optional().nullable(),
});

export type ResolveApproval = z.infer<typeof resolveApprovalSchema>;

export const requestApprovalRevisionSchema = z.object({
  decisionNote: multilineTextSchema.optional().nullable(),
});

export type RequestApprovalRevision = z.infer<typeof requestApprovalRevisionSchema>;

export const resubmitApprovalSchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type ResubmitApproval = z.infer<typeof resubmitApprovalSchema>;

export const addApprovalCommentSchema = z.object({
  body: multilineTextSchema.pipe(z.string().min(1)),
});

export type AddApprovalComment = z.infer<typeof addApprovalCommentSchema>;
