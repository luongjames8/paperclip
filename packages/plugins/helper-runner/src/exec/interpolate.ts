import type { PluginContext } from "@paperclipai/plugin-sdk";

export interface InterpolationVars {
  issueId: string;
  issueIdentifier: string;
  routineId: string;
  routineRunId: string;
  // Approval-trigger fields (empty for routine-triggered helpers)
  approvalId?: string;
  approvalType?: string;
  approvalStatus?: string;
  approvalIssueIds?: string;
}

const SECRET_RE = /\$\{secret:([^}]+)\}/g;
const VAR_RE = /\$\{([^}]+)\}/g;

export async function interpolate(
  template: string,
  vars: InterpolationVars,
  ctx: Pick<PluginContext, "secrets">
): Promise<string> {
  // First pass: resolve ${secret:UUID} — these are async
  const secretRefs: string[] = [];
  let m: RegExpExecArray | null;
  SECRET_RE.lastIndex = 0;
  while ((m = SECRET_RE.exec(template)) !== null) {
    secretRefs.push(m[1]);
  }

  const resolvedSecrets = new Map<string, string>();
  await Promise.all(
    secretRefs.map(async (ref) => {
      let value: string;
      try {
        value = await ctx.secrets.resolve(ref);
      } catch (err) {
        throw new Error(`Failed to resolve secret ref "${ref}": ${(err as Error).message ?? String(err)}`);
      }
      resolvedSecrets.set(ref, value);
    })
  );

  // Second pass: replace all variables
  return template.replace(VAR_RE, (match, key: string) => {
    if (key.startsWith("secret:")) {
      const ref = key.slice("secret:".length);
      const val = resolvedSecrets.get(ref);
      if (val === undefined) {
        throw new Error(`Secret ref not resolved: "${ref}"`);
      }
      return val;
    }
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

export async function interpolateRecord(
  record: Record<string, string>,
  vars: InterpolationVars,
  ctx: Pick<PluginContext, "secrets">
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  await Promise.all(
    Object.entries(record).map(async ([k, v]) => {
      result[k] = await interpolate(v, vars, ctx);
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
