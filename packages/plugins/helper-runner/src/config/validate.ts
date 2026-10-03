import path from "node:path";
import type { HelperConfig, HelperSecretRef, PluginConfig } from "./schema.js";

const LEGACY_SECRET_TOKEN = "${secret:";

export function isHelperSecretRef(value: unknown): value is HelperSecretRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "secret_ref" &&
    typeof (value as { secretId?: unknown }).secretId === "string"
  );
}

// Identity of a helper: its name + EVERY trigger field, so two helpers that differ in any
// discriminator (approval event, titleContains, ...) are distinct. Also the semaphore key.
export function helperKey(helper: HelperConfig): string {
  return `${JSON.stringify(helper.trigger)}:${helper.name}`;
}

export function validateConfig(config: PluginConfig): void {
  const seen = new Set<string>();
  for (const helper of config.helpers) {
    validateHelper(helper);
    const key = helperKey(helper);
    if (seen.has(key)) {
      throw new Error(`Duplicate helper: name "${helper.name}" + trigger ${JSON.stringify(helper.trigger)} appears more than once`);
    }
    seen.add(key);
  }
}

function validateHelper(helper: HelperConfig): void {
  if (!path.isAbsolute(helper.exec.command)) {
    throw new Error(
      `Helper "${helper.name}": exec.command must be an absolute path, got "${helper.exec.command}"`
    );
  }
  // Paperclip >= v2026.720.0 resolves only company-bound {type:"secret_ref"}
  // objects; a legacy ${secret:UUID} string would silently reach the helper's
  // environment unresolved. Fail closed so a stale config is inert, not wrong.
  const strings = [
    helper.exec.command,
    helper.exec.cwd ?? "",
    ...(helper.exec.args ?? []),
    ...Object.values(helper.exec.env ?? {}).filter((v): v is string => typeof v === "string"),
  ];
  if (strings.some((value) => value.includes(LEGACY_SECRET_TOKEN))) {
    throw new Error(
      `Helper "${helper.name}": legacy \${secret:UUID} references are no longer supported; ` +
        `set the env value to {"type":"secret_ref","secretId":"<uuid>"}`
    );
  }
  for (const [key, value] of Object.entries(helper.exec.env ?? {})) {
    if (typeof value !== "string" && !isHelperSecretRef(value)) {
      throw new Error(`Helper "${helper.name}": exec.env.${key} must be a string or a secret_ref object`);
    }
  }
}

// Validates a company's raw config and stamps each env secret_ref with the
// config path the host bound it at — the same secret is commonly bound at
// several paths, and resolution is ambiguous without it.
export function normalizeConfig(raw: Record<string, unknown> | null | undefined): PluginConfig {
  const config = structuredClone({ helpers: [], ...(raw ?? {}) }) as unknown as PluginConfig;
  validateConfig(config);
  config.helpers.forEach((helper, index) => {
    for (const [key, value] of Object.entries(helper.exec.env ?? {})) {
      if (isHelperSecretRef(value)) value.configPath = `helpers.${index}.exec.env.${key}`;
    }
  });
  return config;
}

