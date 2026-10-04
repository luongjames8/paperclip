import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { SecretRef } from "./schema.js";

export function isSecretRef(value: unknown): value is SecretRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "secret_ref" &&
    typeof (value as { secretId?: unknown }).secretId === "string"
  );
}

// Resolves a company-bound secret ref. The host requires the owning company
// and, when one secret is bound at several config paths (e.g. the same board
// key as paperclipApiKeySecretRef and a user's boardApiKeySecretRef), the path.
export async function resolveSecret(ctx: Pick<PluginContext, "secrets">, ref: SecretRef): Promise<string> {
  const { companyId, configPath, ...secretRef } = ref;
  return ctx.secrets.resolve(secretRef, { companyId, configPath });
}
