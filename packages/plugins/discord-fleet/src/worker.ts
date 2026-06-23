import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import manifest, { JOB_KEYS } from "./manifest.js";
import type { DiscordFleetConfig } from "./config/schema.js";
import { validateConfig } from "./config/validate.js";
import { createDiscordClient, connectDiscordClient, destroyDiscordClient } from "./discord/client.js";
import { registerSlashCommands, setupInteractionHandler } from "./discord/slash.js";
import { handleIssueCreated } from "./handlers/issue-created.js";
import { handleIssueUpdated } from "./handlers/issue-updated.js";
import { handleApprovalCreated } from "./handlers/approval-created.js";
import { handleApprovalButton } from "./handlers/approval-button.js";
import { runDigest } from "./jobs/digest.js";
import { runStuckDetector } from "./jobs/stuck-detector.js";
import { runRoutineHealth } from "./jobs/routine-health.js";
import { runApprovalsReminder } from "./jobs/approvals-reminder.js";
import { handleStatusCommand } from "./slash/status.js";
import { PaperclipClient } from "./api/paperclip.js";
import { CoalesceBuffer } from "./util/coalesce.js";
import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";

// Module-level state shared across handlers.
//
// Per-company client maps — keyed by companyId for O(1) handler lookup.
// Multiple companies that resolve to the same bot token share ONE Client
// (Discord rejects duplicate gateway connections for the same token). The
// token-keyed map is the dedup layer; the companyId map is the lookup layer.
let clientByCompanyId: Map<string, Client> = new Map();
// Number of companies in the active config — compared against clientByCompanyId.size
// in onHealth so a per-company bot that failed to connect (and was skipped by the
// fault-isolation path) surfaces as "degraded" instead of being hidden.
let configuredCompanyCount = 0;
let savedCtx: PluginContext | null = null;
let eventUnsubscribers: Array<() => void> = [];
const coalescer = new CoalesceBuffer(2000);

async function getConfig(ctx: PluginContext): Promise<DiscordFleetConfig> {
  const raw = await ctx.config.get();
  const cfg = raw as unknown as DiscordFleetConfig;
  validateConfig(cfg);
  return cfg;
}

// Returns the Client for a given companyId, or null if none is registered.
// Handlers should treat null as "not connected" and skip posting.
function getClientForCompany(companyId: string): Client | null {
  return clientByCompanyId.get(companyId) ?? null;
}

// Build the client maps from a resolved config.
// Returns:
//   clientByToken    — deduplicated; one connected Client per unique resolved token
//   byCompanyId      — lookup map; each successfully-connected companyId → its Client
//   tokenByCompanyId — the resolved token per company (reused for slash registration
//                      so it can't diverge from what was used to connect)
//
// FAULT ISOLATION (critical): each company's secret-resolve + connect is wrapped
// so one misconfigured company (e.g. a new per-company bot with a bad/not-in-guild
// token) is logged and SKIPPED — it does NOT throw out of this function. Without
// this, a single bad per-company token would abort setup/onConfigChanged and take
// down the SHARED root client (hinomaru and every other root-token company) with
// it. A skipped company simply has no entry in byCompanyId; downstream handlers
// null-guard on getClientForCompany and quietly skip it.
async function buildClientMaps(
  ctx: PluginContext,
  cfg: DiscordFleetConfig,
): Promise<{
  clientByToken: Map<string, Client>;
  byCompanyId: Map<string, Client>;
  tokenByCompanyId: Map<string, string>;
}> {
  const clientByToken = new Map<string, Client>();
  const byCompanyId = new Map<string, Client>();
  const tokenByCompanyId = new Map<string, string>();

  for (const company of cfg.companies) {
    // Track a client created in THIS iteration so a connect failure can destroy
    // it (otherwise the half-open client leaks a background reconnect loop, and
    // accumulates one zombie per failing onConfigChanged cycle).
    let pendingClient: Client | null = null;
    try {
      const token = company.botTokenSecretRef
        ? await ctx.secrets.resolve(company.botTokenSecretRef)
        : await ctx.secrets.resolve(cfg.botTokenSecretRef);
      tokenByCompanyId.set(company.companyId, token);

      let client = clientByToken.get(token);
      if (!client) {
        pendingClient = createDiscordClient();
        await connectDiscordClient(pendingClient, token);
        client = pendingClient;
        clientByToken.set(token, client);
        pendingClient = null; // registered — no longer this loop's to clean up
      }

      byCompanyId.set(company.companyId, client);
    } catch (err) {
      if (pendingClient) {
        try {
          await destroyDiscordClient(pendingClient);
        } catch {
          /* best-effort cleanup of the failed-connect client */
        }
      }
      ctx.logger.error("discord-fleet: failed to connect Discord client for company; skipping", {
        companyId: company.companyId,
        usesOwnBot: Boolean(company.botTokenSecretRef),
        err: String(err),
      });
    }
  }

  return { clientByToken, byCompanyId, tokenByCompanyId };
}

function bindEventHandlers(
  ctx: PluginContext,
  config: DiscordFleetConfig,
): Array<() => void> {
  return [
    ctx.events.on("issue.created", async (event) => {
      const client = getClientForCompany(event.companyId);
      if (!client) return;
      await handleIssueCreated(ctx, event, client, config);
    }),
    ctx.events.on("issue.updated", async (event) => {
      const client = getClientForCompany(event.companyId);
      if (!client) return;
      await handleIssueUpdated(ctx, event, client, config, coalescer);
    }),
    ctx.events.on("approval.created", async (event) => {
      const client = getClientForCompany(event.companyId);
      if (!client) return;
      await handleApprovalCreated(ctx, event, client, config);
    }),
  ];
}

const plugin = definePlugin({
  async setup(ctx) {
    const config = await getConfig(ctx);
    savedCtx = ctx;

    // Build per-company client maps (deduped by resolved token; per-company
    // connect failures are isolated and skipped inside buildClientMaps).
    const { clientByToken, byCompanyId, tokenByCompanyId } = await buildClientMaps(ctx, config);
    clientByCompanyId = byCompanyId;
    configuredCompanyCount = config.companies.length;
    ctx.logger.info("discord-fleet: Discord gateway(s) connected", {
      uniqueClients: clientByToken.size,
      companiesConnected: byCompanyId.size,
      companiesConfigured: config.companies.length,
    });

    // Register slash commands for each company that actually connected, reusing
    // the token buildClientMaps already resolved (single source of truth).
    for (const company of config.companies) {
      const client = byCompanyId.get(company.companyId);
      if (!client) continue; // company was skipped (connect failed) — nothing to register
      const appId = client.user?.id;
      const token = tokenByCompanyId.get(company.companyId);
      if (appId && token) {
        await registerSlashCommands(token, appId, company.guildId).catch((err) => {
          ctx.logger.warn("discord-fleet: slash command registration failed", { guildId: company.guildId, err: String(err) });
        });
      }
    }

    // Set up interaction handlers on EACH unique client so every bot's buttons
    // and slash commands work. The companyId is resolved from guildId within the
    // shared config, so one setupInteractionHandler call per client suffices —
    // each client routes by guildId into the same config.companies array.
    for (const client of clientByToken.values()) {
      setupInteractionHandler(
        client,
        config,
        async (interaction, companyId) => {
          const companyConfig = config.companies.find((c) => c.companyId === companyId);
          if (!companyConfig) return;
          const apiKey = await ctx.secrets.resolve(companyConfig.paperclipApiKeySecretRef);
          const paperclip = new PaperclipClient(ctx, companyConfig.paperclipApiUrl, apiKey);
          await handleStatusCommand(interaction, ctx, companyConfig, paperclip);
        },
        async (interaction) => {
          await handleApprovalButton(ctx, interaction, config);
        },
      );
    }

    eventUnsubscribers = bindEventHandlers(ctx, config);

    const makePaperclipFactory = (cfg: DiscordFleetConfig) => {
      const cache = new Map<string, PaperclipClient>();
      return async (companyId: string): Promise<PaperclipClient> => {
        if (cache.has(companyId)) return cache.get(companyId)!;
        const company = cfg.companies.find((c) => c.companyId === companyId);
        if (!company) throw new Error(`unknown company: ${companyId}`);
        const apiKey = await ctx.secrets.resolve(company.paperclipApiKeySecretRef);
        const client = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);
        cache.set(companyId, client);
        return client;
      };
    };

    const paperclipFactory = makePaperclipFactory(config);

    // Register job handlers. Jobs loop over companies and use each company's client.
    ctx.jobs.register(JOB_KEYS.digest, async () => {
      for (const company of config.companies) {
        const client = getClientForCompany(company.companyId);
        if (!client) continue;
        const paperclip = await paperclipFactory(company.companyId);
        await runDigest(ctx, company.companyId, client, company, paperclip);
      }
    });

    ctx.jobs.register(JOB_KEYS.stuckDetector, async () => {
      // runStuckDetector loops companies internally; pass the map accessor as the
      // client resolver so each company uses its own (or shared) client.
      await runStuckDetector(ctx, getClientForCompany, config, async (id) => paperclipFactory(id));
    });

    ctx.jobs.register(JOB_KEYS.routineHealth, async () => {
      await runRoutineHealth(ctx, getClientForCompany, config, async (id) => paperclipFactory(id));
    });

    ctx.jobs.register(JOB_KEYS.approvalsReminder, async () => {
      for (const company of config.companies) {
        const client = getClientForCompany(company.companyId);
        if (!client) continue;
        const paperclip = await paperclipFactory(company.companyId);
        await runApprovalsReminder(ctx, company.companyId, client, company, config, paperclip);
      }
    });

    ctx.logger.info("discord-fleet: setup complete", { companies: config.companies.length });
  },

  async onConfigChanged(newConfig) {
    const cfg = newConfig as unknown as DiscordFleetConfig;
    try {
      validateConfig(cfg);
    } catch (err) {
      console.error("discord-fleet: config change rejected:", err);
      return;
    }

    for (const unsub of eventUnsubscribers) unsub();
    eventUnsubscribers = [];

    // Tear down all existing clients (unique set — no double-destroy risk).
    // Destroy-BEFORE-rebuild is intentional: Discord rejects a second gateway
    // connection for a token already connected, so we cannot build new clients
    // for the same tokens while the old ones are live. This is safe because
    // buildClientMaps is fault-isolated (per-company connect failures are caught
    // and skipped, never thrown) — the rebuild below always completes with the
    // companies that connected, so a single bad per-company token can no longer
    // leave the fleet (incl. hinomaru) with an empty client map.
    // AWAIT each unique client's destroy before rebuilding — a config reload that
    // keeps a token unchanged (e.g. just adding a company) reconnects that same
    // token, and Discord rejects a new IDENTIFY while the old session is still
    // closing. Awaiting the close avoids racing the root client offline.
    const destroyed = new Set<Client>();
    for (const client of clientByCompanyId.values()) {
      if (!destroyed.has(client)) {
        destroyed.add(client);
        try {
          await destroyDiscordClient(client);
        } catch {
          /* best-effort: proceed with rebuild even if a destroy hiccups */
        }
      }
    }
    clientByCompanyId = new Map();

    if (!savedCtx) {
      console.error("discord-fleet: onConfigChanged called before setup; cannot reconnect");
      return;
    }

    const { clientByToken, byCompanyId, tokenByCompanyId } = await buildClientMaps(savedCtx, cfg);
    clientByCompanyId = byCompanyId;
    configuredCompanyCount = cfg.companies.length;

    // Re-register slash commands for each connected company. This MUST mirror
    // setup() — config-reload (operator adds a company or a per-company bot) is
    // the feature's primary activation path, and a new bot has a different appId
    // whose guild slash commands were never registered. Without this, /status is
    // missing in the new guild until a full plugin restart.
    for (const company of cfg.companies) {
      const client = byCompanyId.get(company.companyId);
      if (!client) continue;
      const appId = client.user?.id;
      const token = tokenByCompanyId.get(company.companyId);
      if (appId && token) {
        await registerSlashCommands(token, appId, company.guildId).catch((err) => {
          savedCtx?.logger.warn("discord-fleet: slash command registration failed", { guildId: company.guildId, err: String(err) });
        });
      }
    }

    // Re-register interaction handlers on the new clients.
    for (const client of clientByToken.values()) {
      setupInteractionHandler(
        client,
        cfg,
        async (interaction, companyId) => {
          const companyConfig = cfg.companies.find((c) => c.companyId === companyId);
          if (!companyConfig || !savedCtx) return;
          const apiKey = await savedCtx.secrets.resolve(companyConfig.paperclipApiKeySecretRef);
          const paperclip = new PaperclipClient(savedCtx, companyConfig.paperclipApiUrl, apiKey);
          await handleStatusCommand(interaction, savedCtx, companyConfig, paperclip);
        },
        async (interaction) => {
          if (!savedCtx) return;
          await handleApprovalButton(savedCtx, interaction, cfg);
        },
      );
    }

    eventUnsubscribers = bindEventHandlers(savedCtx, cfg);

    savedCtx.logger.info("discord-fleet: config updated and gateway(s) reconnected", {
      uniqueClients: clientByToken.size,
      companies: cfg.companies.length,
    });
  },

  async onHealth() {
    const companiesConnected = clientByCompanyId.size;
    const uniqueClients = new Set(clientByCompanyId.values()).size;
    // ok only when EVERY configured company connected; a skipped per-company bot
    // (fault-isolated in buildClientMaps) drops the count below configured → degraded.
    const ok = configuredCompanyCount > 0 && companiesConnected >= configuredCompanyCount;
    return {
      status: ok ? "ok" : "degraded",
      message: ok
        ? `Discord connected: ${companiesConnected}/${configuredCompanyCount} companies (${uniqueClients} unique client(s))`
        : `Discord degraded: ${companiesConnected}/${configuredCompanyCount} companies connected`,
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
