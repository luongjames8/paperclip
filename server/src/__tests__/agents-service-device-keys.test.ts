import os from "node:os";
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentService } from "../services/agents.ts";
import { ensureGatewayDeviceKey, generateEd25519PrivateKeyPem } from "../services/agent-device-keys.ts";

describe("ensureGatewayDeviceKey (unit)", () => {
  it("mints a device key for openclaw_gateway configs without one", () => {
    const next = ensureGatewayDeviceKey("openclaw_gateway", {});
    expect(String(next.devicePrivateKeyPem)).toContain("BEGIN PRIVATE KEY");
  });

  it("keeps an existing key", () => {
    const pem = generateEd25519PrivateKeyPem();
    const next = ensureGatewayDeviceKey("openclaw_gateway", { devicePrivateKeyPem: pem });
    expect(next.devicePrivateKeyPem).toBe(pem);
  });

  it("respects disableDeviceAuth", () => {
    expect(ensureGatewayDeviceKey("openclaw_gateway", { disableDeviceAuth: true }).devicePrivateKeyPem).toBeUndefined();
    expect(ensureGatewayDeviceKey("openclaw_gateway", { disableDeviceAuth: "true" }).devicePrivateKeyPem).toBeUndefined();
  });

  it("ignores non-gateway adapters", () => {
    expect(ensureGatewayDeviceKey("codex_local", {}).devicePrivateKeyPem).toBeUndefined();
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres agent device key tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("agent service device key minting", () => {
  let stopDb: (() => Promise<void>) | undefined;
  let db!: ReturnType<typeof createDb>;
  const previousKeyFile = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const secretsTmpDir = path.join(os.tmpdir(), `paperclip-agent-device-keys-${randomUUID()}`);

  beforeAll(async () => {
    mkdirSync(secretsTmpDir, { recursive: true });
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(secretsTmpDir, "master.key");
    const started = await startEmbeddedPostgresTestDatabase("agent-device-keys");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
    if (previousKeyFile === undefined) {
      delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    } else {
      process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = previousKeyFile;
    }
    rmSync(secretsTmpDir, { recursive: true, force: true });
  });

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  // The import-path regression: company import creates agents through THIS
  // service (bypassing the route layer where the mint used to live), which is
  // how imported gateway agents landed "pairing required".
  it("mints a device key for openclaw_gateway agents created through the service", async () => {
    const companyId = await seedCompany();
    const svc = agentService(db);
    const created = await svc.create(companyId, {
      name: "Imported Gateway Agent",
      role: "engineer",
      status: "idle",
      adapterType: "openclaw_gateway",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    const config = created.adapterConfig as Record<string, unknown>;
    expect(String(config.devicePrivateKeyPem)).toContain("BEGIN PRIVATE KEY");
  });

  it("re-mints when an update replaces adapterConfig without a key", async () => {
    const companyId = await seedCompany();
    const svc = agentService(db);
    const created = await svc.create(companyId, {
      name: "Gateway Agent",
      role: "engineer",
      status: "idle",
      adapterType: "openclaw_gateway",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    const updated = await svc.update(created.id, { adapterConfig: { paperclipApiUrl: "http://paperclip:3100" } });
    const config = updated?.adapterConfig as Record<string, unknown>;
    expect(String(config.devicePrivateKeyPem)).toContain("BEGIN PRIVATE KEY");
    expect(config.paperclipApiUrl).toBe("http://paperclip:3100");
  });

  it("does not mint for non-gateway agents", async () => {
    const companyId = await seedCompany();
    const svc = agentService(db);
    const created = await svc.create(companyId, {
      name: "Local Agent",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    expect((created.adapterConfig as Record<string, unknown>).devicePrivateKeyPem).toBeUndefined();
  });
});
