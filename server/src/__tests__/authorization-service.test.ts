import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  instanceUserRoles,
  issues,
  principalPermissionGrants,
  projects,
} from "@paperclipai/db";
import { LOW_TRUST_REVIEW_PRESET } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { authorizationService } from "../services/authorization.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createCompany(db: ReturnType<typeof createDb>, label: string) {
  return db
    .insert(companies)
    .values({
      name: `Authorization ${label} ${randomUUID()}`,
      issuePrefix: `AZ${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function createAgent(
  db: ReturnType<typeof createDb>,
  companyId: string,
  input: { role?: string; reportsTo?: string | null; permissions?: Record<string, unknown> } = {},
) {
  return db
    .insert(agents)
    .values({
      companyId,
      name: `Agent ${randomUUID()}`,
      role: input.role ?? "engineer",
      reportsTo: input.reportsTo ?? null,
      permissions: input.permissions ?? {},
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function createProject(db: ReturnType<typeof createDb>, companyId: string, label: string) {
  return db
    .insert(projects)
    .values({
      companyId,
      name: `Project ${label} ${randomUUID()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function createIssue(
  db: ReturnType<typeof createDb>,
  companyId: string,
  input: {
    id?: string;
    title?: string;
    projectId?: string | null;
    parentId?: string | null;
    assigneeAgentId?: string | null;
  } = {},
) {
  return db
    .insert(issues)
    .values({
      id: input.id ?? randomUUID(),
      companyId,
      title: input.title ?? `Issue ${randomUUID()}`,
      status: "todo",
      priority: "medium",
      projectId: input.projectId ?? null,
      parentId: input.parentId ?? null,
      assigneeAgentId: input.assigneeAgentId ?? null,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function grantAgentPermission(
  db: ReturnType<typeof createDb>,
  companyId: string,
  agentId: string,
  permissionKey: "tasks:assign" | "tasks:assign_scope",
  scope: Record<string, unknown> | null = null,
) {
  await db.insert(companyMemberships).values({
    companyId,
    principalType: "agent",
    principalId: agentId,
    status: "active",
    membershipRole: "member",
  });
  await db.insert(principalPermissionGrants).values({
    companyId,
    principalType: "agent",
    principalId: agentId,
    permissionKey,
    scope,
    grantedByUserId: null,
  });
}

describeEmbeddedPostgres("authorization service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-authorization-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(instanceUserRoles);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("allows active user role grants and explains the grant source", async () => {
    const company = await createCompany(db, "UserGrant");
    const userId = `user-${randomUUID()}`;
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      permissionKey: "tasks:assign",
      grantedByUserId: "owner",
    });

    const decision = await authorizationService(db).decidePrincipalGrant({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      action: "tasks:assign",
      permissionKey: "tasks:assign",
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_explicit_grant",
      grant: {
        principalType: "user",
        principalId: userId,
        permissionKey: "tasks:assign",
      },
    });
    expect(decision.explanation).toContain("Allowed by explicit grant tasks:assign");
  });

  it("allows agent grants for agent configuration decisions", async () => {
    const company = await createCompany(db, "AgentGrant");
    const actorAgent = await createAgent(db, company.id);
    const targetAgent = await createAgent(db, company.id);
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      permissionKey: "agents:create",
      grantedByUserId: null,
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, companyId: company.id, source: "agent_key" },
      action: "agent_config:read",
      resource: { type: "agent", companyId: company.id, agentId: targetAgent.id },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.grant?.permissionKey).toBe("agents:create");
  });

  it("denies cross-company agent decisions before grant evaluation", async () => {
    const sourceCompany = await createCompany(db, "Source");
    const targetCompany = await createCompany(db, "Target");
    const actorAgent = await createAgent(db, sourceCompany.id);

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, companyId: sourceCompany.id, source: "agent_jwt" },
      action: "tasks:assign",
      resource: { type: "company", companyId: targetCompany.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_company_boundary",
    });
    expect(decision.explanation).toContain("Agent key cannot access another company");
  });

  it("allows simple-mode task assignment between same-company agents without explicit grants", async () => {
    const company = await createCompany(db, "AssignmentDefault");
    const actorAgent = await createAgent(db, company.id, { role: "engineer" });
    const targetAgent = await createAgent(db, company.id, { role: "engineer" });
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      status: "active",
      membershipRole: "member",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, companyId: company.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", companyId: company.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_simple_company_member",
    });
    expect(decision.explanation).toContain("simple mode");
  });

  it("limits low-trust issue reads to the configured project and root issue boundary", async () => {
    const company = await createCompany(db, "LowTrustIssueReads");
    const project = await createProject(db, company.id, "Allowed");
    const otherProject = await createProject(db, company.id, "Denied");
    const rootIssueId = randomUUID();
    const actorAgent = await createAgent(db, company.id, {
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            projectIds: [project.id],
            rootIssueId,
          },
        },
      },
    });
    const rootIssue = await createIssue(db, company.id, {
      id: rootIssueId,
      projectId: project.id,
      assigneeAgentId: actorAgent.id,
    });
    const childIssue = await createIssue(db, company.id, {
      projectId: project.id,
      parentId: rootIssue.id,
    });
    const unrelatedIssue = await createIssue(db, company.id, {
      projectId: otherProject.id,
    });

    const authorization = authorizationService(db);
    const actor = { type: "agent" as const, agentId: actorAgent.id, companyId: company.id, source: "agent_key" as const };
    const rootDecision = await authorization.decide({
      actor,
      action: "issue:read",
      resource: {
        type: "issue",
        companyId: company.id,
        issueId: rootIssue.id,
        projectId: rootIssue.projectId,
        parentIssueId: rootIssue.parentId,
        assigneeAgentId: rootIssue.assigneeAgentId,
        status: rootIssue.status,
      },
    });
    const childDecision = await authorization.decide({
      actor,
      action: "issue:read",
      resource: {
        type: "issue",
        companyId: company.id,
        issueId: childIssue.id,
        projectId: childIssue.projectId,
        parentIssueId: childIssue.parentId,
        status: childIssue.status,
      },
    });
    const unrelatedDecision = await authorization.decide({
      actor,
      action: "issue:read",
      resource: {
        type: "issue",
        companyId: company.id,
        issueId: unrelatedIssue.id,
        projectId: unrelatedIssue.projectId,
        parentIssueId: unrelatedIssue.parentId,
        status: unrelatedIssue.status,
      },
    });

    expect(rootDecision).toMatchObject({ allowed: true, reason: "allow_low_trust_boundary" });
    expect(childDecision).toMatchObject({ allowed: true, reason: "allow_low_trust_boundary" });
    expect(unrelatedDecision).toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
  });

  it("blocks low-trust project, agent, company-wide, and outside-boundary assignment access", async () => {
    const company = await createCompany(db, "LowTrustOtherResources");
    const project = await createProject(db, company.id, "Allowed");
    const otherProject = await createProject(db, company.id, "Denied");
    const collaborator = await createAgent(db, company.id);
    const higherTrustAgent = await createAgent(db, company.id, { role: "cto" });
    const actorAgent = await createAgent(db, company.id, {
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            projectIds: [project.id],
            allowedAgentIds: [collaborator.id],
          },
        },
      },
    });

    const authorization = authorizationService(db);
    const actor = { type: "agent" as const, agentId: actorAgent.id, companyId: company.id, source: "agent_key" as const };

    await expect(authorization.decide({
      actor,
      action: "project:read",
      resource: { type: "project", companyId: company.id, projectId: project.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "project:read",
      resource: { type: "project", companyId: company.id, projectId: otherProject.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "agent:read",
      resource: { type: "agent", companyId: company.id, agentId: collaborator.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "agent:read",
      resource: { type: "agent", companyId: company.id, agentId: higherTrustAgent.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "company_scope:read",
      resource: { type: "company", companyId: company.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "tasks:assign",
      resource: {
        type: "issue",
        companyId: company.id,
        projectId: project.id,
        assigneeAgentId: higherTrustAgent.id,
      },
      scope: { projectId: project.id, assigneeAgentId: higherTrustAgent.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
  });

  it("denies simple-mode assignment when the target agent requires protected-assignment approval", async () => {
    const company = await createCompany(db, "ProtectedAssignment");
    const actorAgent = await createAgent(db, company.id, { role: "engineer" });
    const targetAgent = await createAgent(db, company.id, {
      role: "engineer",
      permissions: {
        authorizationPolicy: {
          assignmentPolicy: {
            mode: "protected",
            protectedAgentRequiresApproval: true,
          },
          protectedAgent: {
            requiresApproval: true,
            approvalReason: "Production deployment authority",
          },
          managedBy: "permissions-extension",
        },
      },
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, companyId: company.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", companyId: company.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    expect(decision.explanation).toContain("requires approval");
  });

  it("requires an explicit grant before assigning to a private target agent", async () => {
    const company = await createCompany(db, "PrivateAssignment");
    const actorAgent = await createAgent(db, company.id, { role: "engineer" });
    const targetAgent = await createAgent(db, company.id, {
      role: "engineer",
      permissions: {
        authorizationPolicy: {
          agentVisibility: {
            mode: "private",
            hiddenFromDefaultDirectory: true,
          },
          assignmentPolicy: {
            mode: "company_default",
            protectedAgentRequiresApproval: false,
          },
          protectedAgent: {
            requiresApproval: false,
          },
          managedBy: "permissions-extension",
        },
      },
    });

    const denied = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, companyId: company.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", companyId: company.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    await grantAgentPermission(db, company.id, actorAgent.id, "tasks:assign_scope", {
      assigneeAgentId: targetAgent.id,
    });

    const allowed = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, companyId: company.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", companyId: company.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(denied).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    expect(denied.explanation).toContain("private");
    expect(allowed).toMatchObject({
      allowed: true,
      reason: "allow_explicit_grant",
      grant: { permissionKey: "tasks:assign_scope" },
    });
  });

  it("allows simple-mode task assignment for active same-company board operators without explicit grants", async () => {
    const company = await createCompany(db, "BoardAssignmentDefault");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, company.id, { role: "engineer" });
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "board", userId, source: "session" },
      action: "tasks:assign",
      resource: { type: "issue", companyId: company.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_simple_company_member",
    });
  });

  it("allows null-mapped visibility actions for active same-company board members", async () => {
    const company = await createCompany(db, "BoardVisibility");
    const userId = `user-${randomUUID()}`;
    const project = await createProject(db, company.id, "Visible");
    const targetAgent = await createAgent(db, company.id, { role: "engineer" });
    const issue = await createIssue(db, company.id, { projectId: project.id });
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "member",
    });

    const authorization = authorizationService(db);
    const actor = { type: "board" as const, userId, source: "session" as const };

    await expect(authorization.decide({
      actor,
      action: "agent:read",
      resource: { type: "agent", companyId: company.id, agentId: targetAgent.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_company_member" });
    await expect(authorization.decide({
      actor,
      action: "company_scope:read",
      resource: { type: "company", companyId: company.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_company_member" });
    await expect(authorization.decide({
      actor,
      action: "project:read",
      resource: { type: "project", companyId: company.id, projectId: project.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_company_member" });
    await expect(authorization.decide({
      actor,
      action: "issue:read",
      resource: {
        type: "issue",
        companyId: company.id,
        issueId: issue.id,
        projectId: issue.projectId,
        parentIssueId: issue.parentId,
        status: issue.status,
      },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_company_member" });
    await expect(authorization.decide({
      actor,
      action: "runtime:manage",
      resource: { type: "company", companyId: company.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_company_member" });
    await expect(authorization.decide({
      actor,
      action: "secrets:read",
      resource: { type: "company", companyId: company.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_company_member" });
  });

  it("denies null-mapped visibility actions for board users without an active membership", async () => {
    const memberCompany = await createCompany(db, "BoardVisibilityMember");
    const otherCompany = await createCompany(db, "BoardVisibilityOther");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, otherCompany.id, { role: "engineer" });
    const inactiveUserId = `user-${randomUUID()}`;
    await db.insert(companyMemberships).values({
      companyId: memberCompany.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(companyMemberships).values({
      companyId: otherCompany.id,
      principalType: "user",
      principalId: inactiveUserId,
      status: "removed",
      membershipRole: "member",
    });

    const authorization = authorizationService(db);

    await expect(authorization.decide({
      actor: { type: "board", userId, source: "session" },
      action: "agent:read",
      resource: { type: "agent", companyId: otherCompany.id, agentId: targetAgent.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_membership" });
    await expect(authorization.decide({
      actor: { type: "board", userId: inactiveUserId, source: "session" },
      action: "company_scope:read",
      resource: { type: "company", companyId: otherCompany.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_membership" });
  });

  it("keeps denying self-gated null-mapped actions for board members", async () => {
    const company = await createCompany(db, "BoardWakeDenied");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, company.id, { role: "engineer" });
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "member",
    });

    const authorization = authorizationService(db);

    await expect(authorization.decide({
      actor: { type: "board", userId, source: "session" },
      action: "agent:wake",
      resource: { type: "agent", companyId: company.id, agentId: targetAgent.id },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_unsupported_action",
    });
    const issue = await createIssue(db, company.id, { title: "Wake denied issue" });
    await expect(authorization.decide({
      actor: { type: "board", userId, source: "session" },
      action: "issue:mutate",
      resource: { type: "issue", companyId: company.id, issueId: issue.id },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_unsupported_action",
    });
  });

  it("limits viewer members to read-only visibility actions", async () => {
    const company = await createCompany(db, "BoardViewerVisibility");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, company.id, { role: "engineer" });
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "viewer",
    });

    const authorization = authorizationService(db);
    const actor = { type: "board", userId, source: "session" } as const;

    await expect(authorization.decide({
      actor,
      action: "agent:read",
      resource: { type: "agent", companyId: company.id, agentId: targetAgent.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_company_member" });
    await expect(authorization.decide({
      actor,
      action: "company_scope:read",
      resource: { type: "company", companyId: company.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_company_member" });
    await expect(authorization.decide({
      actor,
      action: "runtime:manage",
      resource: { type: "company", companyId: company.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_grant" });
    await expect(authorization.decide({
      actor,
      action: "secrets:read",
      resource: { type: "company", companyId: company.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_grant" });
  });

  it("denies legacy board assignment context for viewers", async () => {
    const company = await createCompany(db, "BoardViewerAssignment");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, company.id, { role: "engineer" });
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "viewer",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "board", userId, companyIds: [company.id], source: "session" },
      action: "tasks:assign",
      resource: { type: "issue", companyId: company.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_missing_grant",
    });
  });

  it("never elevates cloud_tenant actors through stale instance_admin rows", async () => {
    const tenantCompany = await createCompany(db, "CloudTenantStale");
    const otherCompany = await createCompany(db, "CloudTenantOther");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, otherCompany.id, { role: "engineer" });
    await db.insert(companyMemberships).values({
      companyId: tenantCompany.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    // Stale grant left behind by a pre-hardening cloud_tenant deployment.
    await db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });

    const decision = await authorizationService(db).decide({
      actor: {
        type: "board",
        userId,
        companyIds: [tenantCompany.id],
        isInstanceAdmin: false,
        source: "cloud_tenant",
      },
      action: "tasks:assign",
      resource: { type: "issue", companyId: otherCompany.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).not.toBe("allow_instance_admin");

    // Control: the instanceUserRoles lookup still elevates non-cloud_tenant
    // board actors, so the carve-out is scoped to the tenant contract only.
    const sessionDecision = await authorizationService(db).decide({
      actor: { type: "board", userId, companyIds: [tenantCompany.id], source: "session" },
      action: "tasks:assign",
      resource: { type: "issue", companyId: otherCompany.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });
    expect(sessionDecision).toMatchObject({ allowed: true, reason: "allow_instance_admin" });
  });

  it("denies simple-mode assignment to a target agent from another company", async () => {
    const sourceCompany = await createCompany(db, "AssignmentSource");
    const targetCompany = await createCompany(db, "AssignmentTarget");
    const actorAgent = await createAgent(db, sourceCompany.id, { role: "engineer" });
    const targetAgent = await createAgent(db, targetCompany.id, { role: "engineer" });
    await db.insert(companyMemberships).values({
      companyId: sourceCompany.id,
      principalType: "agent",
      principalId: actorAgent.id,
      status: "active",
      membershipRole: "member",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, companyId: sourceCompany.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", companyId: sourceCompany.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_company_boundary",
    });
  });

  it("preserves legacy CEO agent creator authority", async () => {
    const company = await createCompany(db, "Legacy");
    const actorAgent = await createAgent(db, company.id, { role: "ceo" });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, companyId: company.id, source: "agent_jwt" },
      action: "agents:create",
      resource: { type: "company", companyId: company.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_legacy_agent_creator",
    });
  });

  it("allows scoped assignment inside a granted project and denies other projects", async () => {
    const company = await createCompany(db, "ProjectScope");
    const project = await createProject(db, company.id, "Allowed");
    const otherProject = await createProject(db, company.id, "Denied");
    const actorAgent = await createAgent(db, company.id);
    const targetAgent = await createAgent(db, company.id);
    await grantAgentPermission(db, company.id, actorAgent.id, "tasks:assign_scope", {
      projectIds: [project.id],
    });

    const allowed = await authorizationService(db).decidePrincipalGrant({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { projectId: project.id, assigneeAgentId: targetAgent.id },
    });
    const denied = await authorizationService(db).decidePrincipalGrant({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { projectId: otherProject.id, assigneeAgentId: targetAgent.id },
    });

    expect(allowed).toMatchObject({
      allowed: true,
      grant: { permissionKey: "tasks:assign_scope" },
    });
    expect(denied).toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });
    expect(denied.explanation).toContain("does not cover the requested scope");
  });

  it("treats unknown grant scope metadata as unconstrained", async () => {
    const company = await createCompany(db, "UnknownScopeMetadata");
    const actorAgent = await createAgent(db, company.id);
    const targetAgent = await createAgent(db, company.id);
    await grantAgentPermission(db, company.id, actorAgent.id, "tasks:assign_scope", {
      note: "CEO-approved",
    });

    const decision = await authorizationService(db).decidePrincipalGrant({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      grant: { permissionKey: "tasks:assign_scope" },
    });
  });

  it("allows scoped assignment to agents inside a managed subtree only", async () => {
    const company = await createCompany(db, "SubtreeScope");
    const actorAgent = await createAgent(db, company.id);
    const managerAgent = await createAgent(db, company.id);
    const childAgent = await createAgent(db, company.id, { reportsTo: managerAgent.id });
    const grandchildAgent = await createAgent(db, company.id, { reportsTo: childAgent.id });
    const outsideAgent = await createAgent(db, company.id);
    await grantAgentPermission(db, company.id, actorAgent.id, "tasks:assign_scope", {
      managedSubtreeAgentIds: [managerAgent.id],
    });

    const allowed = await authorizationService(db).decidePrincipalGrant({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: grandchildAgent.id },
    });
    const denied = await authorizationService(db).decidePrincipalGrant({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: outsideAgent.id },
    });

    expect(allowed.allowed).toBe(true);
    expect(allowed.grant?.permissionKey).toBe("tasks:assign_scope");
    expect(denied).toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });
  });

  it("allows scoped assignment to an explicit target-agent allowlist only", async () => {
    const company = await createCompany(db, "AllowlistScope");
    const actorAgent = await createAgent(db, company.id);
    const allowedTarget = await createAgent(db, company.id);
    const deniedTarget = await createAgent(db, company.id);
    await grantAgentPermission(db, company.id, actorAgent.id, "tasks:assign_scope", {
      assigneeAgentIds: [allowedTarget.id],
    });

    const allowed = await authorizationService(db).decidePrincipalGrant({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: allowedTarget.id },
    });
    const denied = await authorizationService(db).decidePrincipalGrant({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: deniedTarget.id },
    });

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
  });

  it("preserves unscoped tasks:assign compatibility for assignment decisions", async () => {
    const company = await createCompany(db, "BroadAssign");
    const actorAgent = await createAgent(db, company.id);
    const targetAgent = await createAgent(db, company.id);
    await grantAgentPermission(db, company.id, actorAgent.id, "tasks:assign");

    const decision = await authorizationService(db).decidePrincipalGrant({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign",
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      grant: { permissionKey: "tasks:assign" },
    });
  });

  // ─── Malformed/stale X-Paperclip-Run-Id on access.decide() (codex round 4)
  // ───────────────────────────────────────────────────────────────────────
  //
  // access.decide()'s resolveActorTrust runs on every agent decision. Same
  // live-incident class as resolveAgentTrustForIssue in routes/issues.ts: a
  // malformed OR well-formed-but-stale/nonexistent run id must not silently
  // resolve to "no run" when the low-trust boundary lives ONLY in the run's
  // contextSnapshot.executionPolicy — that would raise effective trust and
  // bypass the low-trust boundary. Fails closed (denied) UNCONDITIONALLY
  // whenever the header is present but unverifiable and agent/project/issue
  // policy alone would otherwise resolve `standard` (codex ceiling round: an
  // earlier version of this guard additionally required SOME trust-related
  // config to be present anywhere before denying — that left the run-only
  // trust boundary case, exactly what this guard exists for, unprotected).
  // The header's PRESENCE is itself a claim of run context; an unverifiable
  // claim fails closed regardless of what else is configured — including an
  // ordinary agent/issue with zero trust config anywhere. A visible deny
  // beats a silent trust elevation; recovery is dropping/fixing the header.
  describe("malformed/stale X-Paperclip-Run-Id on access.decide()", () => {
    async function seedRunOnlyLowTrustFixture(runId: string) {
      const company = await createCompany(db, "RunOnlyTrust");
      const [agent] = await db.insert(agents).values({
        companyId: company.id,
        name: `Run-context-only Reviewer ${randomUUID()}`,
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
        // Marker only (parses fine, does NOT itself imply low_trust_review) —
        // the actual boundary lives ONLY on the run's contextSnapshot below.
        permissions: { authorizationPolicy: {} },
      }).returning();
      const issue = await createIssue(db, company.id, { assigneeAgentId: agent!.id });
      const executionPolicy = {
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            companyId: company.id,
            rootIssueId: issue.id,
          },
        },
      };
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId: company.id,
        agentId: agent!.id,
        status: "running",
        contextSnapshot: { issueId: issue.id, executionPolicy },
      });
      return { company, agent: agent!, issue };
    }

    it("a malformed run id header fails closed (denied), never a silent standard-trust resolution", async () => {
      const fixture = await seedRunOnlyLowTrustFixture(randomUUID());

      const decision = await authorizationService(db).decide({
        actor: { type: "agent", agentId: fixture.agent.id, companyId: fixture.company.id, runId: "not-a-uuid", source: "agent_jwt" },
        action: "issue:read",
        resource: { type: "issue", companyId: fixture.company.id, issueId: fixture.issue.id },
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("deny_policy_restricted");
      expect(decision.explanation).toMatch(/X-Paperclip-Run-Id/);
    });

    it("a well-formed but STALE (nonexistent) run id header ALSO fails closed (denied)", async () => {
      const fixture = await seedRunOnlyLowTrustFixture(randomUUID());
      const staleRunId = randomUUID(); // well-formed uuid, never inserted into heartbeat_runs

      const decision = await authorizationService(db).decide({
        actor: { type: "agent", agentId: fixture.agent.id, companyId: fixture.company.id, runId: staleRunId, source: "agent_jwt" },
        action: "issue:read",
        resource: { type: "issue", companyId: fixture.company.id, issueId: fixture.issue.id },
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("deny_policy_restricted");
      expect(decision.explanation).toMatch(/X-Paperclip-Run-Id/);
      expect(decision.explanation).toMatch(new RegExp(staleRunId));
    });

    it("the SAME actor with the real run id attached resolves low-trust and is NOT bypassed", async () => {
      const runId = randomUUID();
      const fixture = await seedRunOnlyLowTrustFixture(runId);

      const decision = await authorizationService(db).decide({
        actor: { type: "agent", agentId: fixture.agent.id, companyId: fixture.company.id, runId, source: "agent_jwt" },
        action: "issue:read",
        resource: { type: "issue", companyId: fixture.company.id, issueId: fixture.issue.id },
      });

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe("allow_low_trust_boundary");
    });

    it("an ABSENT run id header (legitimate no-run caller) is unaffected — still allowed, no deny", async () => {
      const fixture = await seedRunOnlyLowTrustFixture(randomUUID());

      const decision = await authorizationService(db).decide({
        actor: { type: "agent", agentId: fixture.agent.id, companyId: fixture.company.id, source: "agent_jwt" },
        action: "issue:read",
        resource: { type: "issue", companyId: fixture.company.id, issueId: fixture.issue.id },
      });

      expect(decision.allowed).toBe(true);
    });

    // REVERSED (codex ceiling round): this test previously asserted that an
    // ordinary agent/issue with ZERO trust config anywhere was NOT denied by
    // a stray malformed run header — that was exactly the
    // isPlausibleLowTrustCandidate narrowing this fix removes. The header's
    // presence is itself a claim of run context; an unverifiable claim now
    // fails closed unconditionally, even with no trust config anywhere else.
    // A visible deny beats a silent trust elevation; the caller recovers by
    // dropping or fixing the header (exactly what the live incident agent
    // did).
    it("an ordinary agent/issue with ZERO trust config anywhere IS denied by a stray malformed run header (visible deny beats silent trust elevation)", async () => {
      const company = await createCompany(db, "OrdinaryNoTrustConfig");
      const actorAgent = await createAgent(db, company.id);
      const issue = await createIssue(db, company.id, { assigneeAgentId: actorAgent.id });

      const decision = await authorizationService(db).decide({
        actor: { type: "agent", agentId: actorAgent.id, companyId: company.id, runId: "not-a-uuid", source: "agent_jwt" },
        action: "issue:read",
        resource: { type: "issue", companyId: company.id, issueId: issue.id },
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("deny_policy_restricted");
      expect(decision.explanation).toMatch(/X-Paperclip-Run-Id/);
      expect(decision.explanation).toMatch(/not-a-uuid/);
    });
  });
});
