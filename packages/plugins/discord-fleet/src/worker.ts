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

// Build the two maps from a resolved config.
// Returns:
//   clientByToken  — deduplicated; one connected Client per unique resolved token
//   byCompanyId    — lookup map; each companyId → its Client
async function buildClientMaps(
  ctx: PluginContext,
  cfg: DiscordFleetConfig,
): Promise<{ clientByToken: Map<string, Client>; byCompanyId: Map<string, Client> }> {
  const rootToken = await ctx.secrets.resolve(cfg.botTokenSecretRef);

  const clientByToken = new Map<string, Client>();
  const byCompanyId = new Map<string, Client>();

  for (const company of cfg.companies) {
    const token = company.botTokenSecretRef
      ? await ctx.secrets.resolve(company.botTokenSecretRef)
      : rootToken;

    let client = clientByToken.get(token);
    if (!client) {
      client = createDiscordClient();
      await connectDiscordClient(client, token);
      clientByToken.set(token, client);
    }

    byCompanyId.set(company.companyId, client);
  }

  return { clientByToken, byCompanyId };
}

// Destroy all unique clients in the token map (avoids double-destroy for shared clients).
function destroyAllClients(clientByToken: Map<string, Client>): void {
  for (const client of clientByToken.values()) {
    destroyDiscordClient(client);
  }
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

    // Build per-company client maps (deduped by resolved token).
    const { clientByToken, byCompanyId } = await buildClientMaps(ctx, config);
    clientByCompanyId = byCompanyId;
    ctx.logger.info("discord-fleet: Discord gateway(s) connected", {
      uniqueClients: clientByToken.size,
      companies: config.companies.length,
    });

    // Register slash commands and interaction handler for each unique client+guild.
    for (const company of config.companies) {
      const client = byCompanyId.get(company.companyId)!;
      const appId = client.user?.id;
      if (appId) {
        const token = company.botTokenSecretRef
          ? await ctx.secrets.resolve(company.botTokenSecretRef)
          : await ctx.secrets.resolve(config.botTokenSecretRef);
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
    const existingTokens = new Map<Client, true>();
    for (const client of clientByCompanyId.values()) {
      if (!existingTokens.has(client)) {
        destroyDiscordClient(client);
        existingTokens.set(client, true);
      }
    }
    clientByCompanyId = new Map();

    if (!savedCtx) {
      console.error("discord-fleet: onConfigChanged called before setup; cannot reconnect");
      return;
    }

    const { clientByToken, byCompanyId } = await buildClientMaps(savedCtx, cfg);
    clientByCompanyId = byCompanyId;

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
    const connectedCount = new Set(clientByCompanyId.values()).size;
    const ok = connectedCount > 0;
    return {
      status: ok ? "ok" : "degraded",
      message: ok
        ? `Discord gateway(s) connected (${connectedCount} unique client(s))`
        : "No Discord clients connected",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
