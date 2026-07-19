import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvals, issueApprovals, issues } from "@paperclipai/db";
import { notFound, unprocessable } from "../errors.js";
import { redactEventPayload } from "../redaction.js";

interface LinkActor {
  agentId?: string | null;
  userId?: string | null;
}

export function issueApprovalService(db: Db) {
  async function getIssue(issueId: string) {
    return db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
  }

  async function getApproval(approvalId: string) {
    return db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .then((rows) => rows[0] ?? null);
  }

  async function assertIssueAndApprovalSameCompany(issueId: string, approvalId: string) {
    const issue = await getIssue(issueId);
    if (!issue) throw notFound("Issue not found");

    const approval = await getApproval(approvalId);
    if (!approval) throw notFound("Approval not found");

    if (issue.companyId !== approval.companyId) {
      throw unprocessable("Issue and approval must belong to the same company");
    }

    return { issue, approval };
  }

  // Keeps approvals.approvalKind consistent at every point an issue gets
  // linked to an approval, not just at creation (codex P2 on fleet issue
  // #687): routes/approvals.ts's create-time resolveApprovalKindFromLinkedIssues
  // only covers issueIds passed at creation — POST /issues/:id/approvals
  // (link, below) and the hire_agent flow (routes/agents.ts) both link
  // issues to an approval through THIS service without ever going through
  // that check, which could otherwise leave a stale/null approvalKind on an
  // approval that's since been linked to a kind-bearing issue (silently
  // misrouting reminders and any future re-render). One rule, computed once
  // here so link() and linkManyForApproval() can't diverge: the approval's
  // current kind plus every linked issue's kind must reduce to at most one
  // distinct non-null value — conflicting kinds reject the link loudly
  // rather than silently keeping a stale value.
  function pickConsistentApprovalKind(
    currentApprovalKind: string | null,
    issueApprovalKinds: Array<string | null>,
  ): string | null {
    const kinds = new Set(
      [currentApprovalKind, ...issueApprovalKinds].filter((kind): kind is string => Boolean(kind)),
    );
    if (kinds.size > 1) {
      throw unprocessable("Linking this issue would make the approval's approvalKind inconsistent", {
        kinds: [...kinds],
      });
    }
    return kinds.size === 1 ? [...kinds][0]! : null;
  }

  return {
    listApprovalsForIssue: async (issueId: string) => {
      const issue = await getIssue(issueId);
      if (!issue) throw notFound("Issue not found");

      const result = await db
        .select({
          id: approvals.id,
          companyId: approvals.companyId,
          type: approvals.type,
          requestedByAgentId: approvals.requestedByAgentId,
          requestedByUserId: approvals.requestedByUserId,
          status: approvals.status,
          payload: approvals.payload,
          decisionNote: approvals.decisionNote,
          decidedByUserId: approvals.decidedByUserId,
          decidedAt: approvals.decidedAt,
          createdAt: approvals.createdAt,
          updatedAt: approvals.updatedAt,
        })
        .from(issueApprovals)
        .innerJoin(approvals, eq(issueApprovals.approvalId, approvals.id))
        .where(eq(issueApprovals.issueId, issueId))
        .orderBy(desc(issueApprovals.createdAt));
      return result.map((approval) => ({
        ...approval,
        payload: redactEventPayload(approval.payload) ?? {},
      }));
    },

    listIssuesForApproval: async (approvalId: string) => {
      const approval = await getApproval(approvalId);
      if (!approval) throw notFound("Approval not found");

      return db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          projectId: issues.projectId,
          goalId: issues.goalId,
          parentId: issues.parentId,
          title: issues.title,
          description: issues.description,
          status: issues.status,
          priority: issues.priority,
          assigneeAgentId: issues.assigneeAgentId,
          createdByAgentId: issues.createdByAgentId,
          createdByUserId: issues.createdByUserId,
          issueNumber: issues.issueNumber,
          identifier: issues.identifier,
          requestDepth: issues.requestDepth,
          billingCode: issues.billingCode,
          startedAt: issues.startedAt,
          completedAt: issues.completedAt,
          cancelledAt: issues.cancelledAt,
          createdAt: issues.createdAt,
          updatedAt: issues.updatedAt,
        })
        .from(issueApprovals)
        .innerJoin(issues, eq(issueApprovals.issueId, issues.id))
        .where(eq(issueApprovals.approvalId, approvalId))
        .orderBy(desc(issueApprovals.createdAt));
    },

    link: async (issueId: string, approvalId: string, actor?: LinkActor) => {
      const { issue, approval } = await assertIssueAndApprovalSameCompany(issueId, approvalId);

      const nextApprovalKind = pickConsistentApprovalKind(approval.approvalKind, [issue.approvalKind]);
      if (nextApprovalKind !== approval.approvalKind) {
        await db
          .update(approvals)
          .set({ approvalKind: nextApprovalKind, updatedAt: new Date() })
          .where(eq(approvals.id, approvalId));
      }

      await db
        .insert(issueApprovals)
        .values({
          companyId: issue.companyId,
          issueId,
          approvalId,
          linkedByAgentId: actor?.agentId ?? null,
          linkedByUserId: actor?.userId ?? null,
        })
        .onConflictDoNothing();

      return db
        .select()
        .from(issueApprovals)
        .where(and(eq(issueApprovals.issueId, issueId), eq(issueApprovals.approvalId, approvalId)))
        .then((rows) => rows[0] ?? null);
    },

    unlink: async (issueId: string, approvalId: string) => {
      await assertIssueAndApprovalSameCompany(issueId, approvalId);
      await db
        .delete(issueApprovals)
        .where(and(eq(issueApprovals.issueId, issueId), eq(issueApprovals.approvalId, approvalId)));
    },

    linkManyForApproval: async (approvalId: string, issueIds: string[], actor?: LinkActor) => {
      if (issueIds.length === 0) return;

      const approval = await getApproval(approvalId);
      if (!approval) throw notFound("Approval not found");

      const uniqueIssueIds = Array.from(new Set(issueIds));
      const rows = await db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          approvalKind: issues.approvalKind,
        })
        .from(issues)
        .where(inArray(issues.id, uniqueIssueIds));

      if (rows.length !== uniqueIssueIds.length) {
        throw notFound("One or more issues not found");
      }

      for (const row of rows) {
        if (row.companyId !== approval.companyId) {
          throw unprocessable("Issue and approval must belong to the same company");
        }
      }

      const nextApprovalKind = pickConsistentApprovalKind(
        approval.approvalKind,
        rows.map((row) => row.approvalKind),
      );
      if (nextApprovalKind !== approval.approvalKind) {
        await db
          .update(approvals)
          .set({ approvalKind: nextApprovalKind, updatedAt: new Date() })
          .where(eq(approvals.id, approvalId));
      }

      await db
        .insert(issueApprovals)
        .values(
          uniqueIssueIds.map((issueId) => ({
            companyId: approval.companyId,
            issueId,
            approvalId,
            linkedByAgentId: actor?.agentId ?? null,
            linkedByUserId: actor?.userId ?? null,
          })),
        )
        .onConflictDoNothing();
    },
  };
}
