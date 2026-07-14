import { generateKeyPairSync } from "node:crypto";

// The ONE device-key generator. Previously duplicated verbatim in
// routes/agents.ts and routes/access.ts, with a third ad-hoc ensure in the
// access join flow — imported agents missed all three because the import path
// calls the agent SERVICE directly, landing them "pairing required".
export function generateEd25519PrivateKeyPem(): string {
  const generated = generateKeyPairSync("ed25519");
  return generated.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
}

function disableDeviceAuthRequested(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

function hasDeviceKey(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// Idempotent: mints a devicePrivateKeyPem for openclaw_gateway-class agents
// unless one is present or device auth is explicitly disabled. Lives at the
// SERVICE layer so every caller — API routes, company import, access flows,
// future callers — inherits it; no route can forget the mint again.
export function ensureGatewayDeviceKey(
  adapterType: string | null | undefined,
  adapterConfig: Record<string, unknown>,
): Record<string, unknown> {
  if (adapterType !== "openclaw_gateway") return adapterConfig;
  if (disableDeviceAuthRequested(adapterConfig.disableDeviceAuth)) return adapterConfig;
  if (hasDeviceKey(adapterConfig.devicePrivateKeyPem)) return adapterConfig;
  return { ...adapterConfig, devicePrivateKeyPem: generateEd25519PrivateKeyPem() };
}
