import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { HelperSecretRef } from "../config/schema.js";
import { isHelperSecretRef } from "../config/validate.js";

export interface InterpolationVars {
  issueId: string;
  issueIdentifier: string;
  routineId: string;
  routineRunId: string;
  // Company whose event fired the helper — secret refs resolve against it.
  companyId?: string;
  // Approval-trigger fields (empty for routine-triggered helpers)
  approvalId?: string;
  approvalType?: string;
  approvalStatus?: string;
  approvalIssueIds?: string;
}

const VAR_RE = /\$\{([^}]+)\}/g;

export async function interpolate(
  template: string,
  vars: InterpolationVars,
  _ctx?: Pick<PluginContext, "secrets">
): Promise<string> {
  return template.replace(VAR_RE, (_match, key: string) => {
    switch (key) {
      case "issue.id":
        return vars.issueId;
      case "issue.identifier":
        return vars.issueIdentifier;
      case "routine.id":
        return vars.routineId;
      case "routine.run.id":
        return vars.routineRunId;
      case "approval.id":
        return vars.approvalId ?? "";
      case "approval.type":
        return vars.approvalType ?? "";
      case "approval.status":
        return vars.approvalStatus ?? "";
      case "approval.issueIds":
        return vars.approvalIssueIds ?? "";
      default:
        throw new Error(`Unknown interpolation variable: "\${${key}}"`);
    }
  });
}

async function resolveSecretRef(
  ref: HelperSecretRef,
  vars: InterpolationVars,
  ctx: Pick<PluginContext, "secrets">
): Promise<string> {
  const { configPath, ...secretRef } = ref;
  try {
    return await ctx.secrets.resolve(secretRef, { companyId: vars.companyId, configPath });
  } catch (err) {
    throw new Error(`Failed to resolve secret ref "${ref.secretId}": ${(err as Error).message ?? String(err)}`);
  }
}

export async function interpolateRecord(
  record: Record<string, string | HelperSecretRef>,
  vars: InterpolationVars,
  ctx: Pick<PluginContext, "secrets">
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  await Promise.all(
    Object.entries(record).map(async ([k, v]) => {
      result[k] = isHelperSecretRef(v) ? await resolveSecretRef(v, vars, ctx) : await interpolate(v, vars, ctx);
    })
  );
  return result;
}

export async function interpolateArray(
  arr: string[],
  vars: InterpolationVars,
  ctx: Pick<PluginContext, "secrets">
): Promise<string[]> {
  return Promise.all(arr.map((s) => interpolate(s, vars, ctx)));
}
