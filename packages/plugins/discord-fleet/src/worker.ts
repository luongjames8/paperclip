import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import manifest, { JOB_KEYS } from "./manifest.js";
import type { DiscordFleetConfig } from "./config/schema.js";
import { validateConfig } from "./config/validate.js";
import { createDiscordClient, connectDiscordClient, destroyDiscordClient } from "./discord/client.js";
import { registerSlashCommands, setupInteractionHandler } from "./discord/slash.js";
import { handleIssueCreated } from "./handlers/issue-created.js";
import { handleIssueUpdated } from "./handlers/issue-updated.js";
import { handleApprovalCreated } from "./handlers/approval-created.js";
import { handleApprovalButton, handleApprovalRevisionModal } from "./handlers/approval-button.js";
import { runDigest } from "./jobs/digest.js";
import { runStuckDetector } from "./jobs/stuck-detector.js";
import { runRoutineHealth } from "./jobs/routine-health.js";
import { runApprovalsReminder } from "./jobs/approvals-reminder.js";
import { runConfirmationSweep } from "./jobs/confirmation-sweep.js";
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
// Deduplicated token → Client map. Kept at module level so reloadClients can
// REUSE a client whose resolved token is unchanged across a config reload
// (Finding 2: preserves hinomaru's root client on unrelated reload).
let tokenToClient: Map<string, Client> = new Map();
// Number of companies in the active config — compared against clientByCompanyId.size
// in onHealth so a per-company bot that failed to connect (and was skipped by the
// fault-isolation path) surfaces as "degraded" instead of being hidden.
let configuredCompanyCount = 0;
let savedCtx: PluginContext | null = null;
let eventUnsubscribers: Array<() => void> = [];
const coalescer = new CoalesceBuffer(2000);

// Module-level current config + factory (Finding 1: jobs read THESE, not setup's locals).
// Set in both setup() and onConfigChanged() so jobs always see the latest state.
let currentConfig: DiscordFleetConfig | null = null;
// Factory function: companyId → PaperclipClient (cached per config epoch).
let currentPaperclipFactory: ((companyId: string) => Promise<PaperclipClient>) | null = null;

// Builds a per-config PaperclipClient factory. Extracted to module scope so both
// setup() and onConfigChanged() can construct and assign currentPaperclipFactory.
function makePaperclipFactory(
  ctx: PluginContext,
  cfg: DiscordFleetConfig,
): (companyId: string) => Promise<PaperclipClient> {
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
}

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

// Returns a config view containing ONLY the companies served by `client`.
// Interaction handlers resolve the company by interaction.guildId; scoping the
// config to this client's companies means a bot that also happens to be in
// another company's guild resolves no company there and REJECTS the /status or
// approval click instead of servicing it with the wrong company's Paperclip
// credentials (e.g. during a root → per-company-bot transition).
function scopeConfigToClient(
  config: DiscordFleetConfig,
  byCompanyId: Map<string, Client>,
  client: Client,
): DiscordFleetConfig {
  return {
    ...config,
    companies: config.companies.filter((c) => byCompanyId.get(c.companyId) === client),
  };
}

// Build the client maps from a resolved config, reusing existing live clients
// for tokens that are unchanged (Finding 2: preserves hinomaru's root client on
// an unrelated config reload such as adding a per-company bot for a different company).
//
// Parameters:
//   ctx            — plugin context (for secret resolution + logging)
//   cfg            — new config to apply
//   existingByToken — the current token→Client map; a client whose token still
//                     appears in the new config is REUSED rather than reconnected.
//                     Pass an empty Map on first call (setup).
//
// Returns:
//   newByToken       — deduplicated; one connected Client per unique resolved token
//                      (mix of reused + newly-connected clients)
//   byCompanyId      — lookup map; each successfully-connected companyId → its Client
//   tokenByCompanyId — the resolved token per company (reused for slash registration
//                      so it can't diverge from what was used to connect)
//   tokensToDestroy  — tokens present in existingByToken that are NO LONGER used by
//                      any company in the new config; caller must destroy these AFTER
//                      updating module state so nothing races the old clients.
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
  existingByToken: Map<string, Client>,
): Promise<{
  newByToken: Map<string, Client>;
  byCompanyId: Map<string, Client>;
  tokenByCompanyId: Map<string, string>;
  tokensToDestroy: Map<string, Client>;
}> {
  const newByToken = new Map<string, Client>();
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

      let client = newByToken.get(token);
      if (!client) {
        // Reuse an existing live client if its token is unchanged — avoids
        // briefly disconnecting hinomaru (or any root-token company) when only
        // an unrelated per-company bot was added/removed.
        const existing = existingByToken.get(token);
        if (existing) {
          client = existing;
        } else {
          pendingClient = createDiscordClient();
          await connectDiscordClient(pendingClient, token);
          client = pendingClient;
          pendingClient = null; // registered — no longer this loop's to clean up
        }
        newByToken.set(token, client);
      }

      // Verify the bot is actually a member of this company's guild. A valid
      // token whose bot was never invited to company.guildId logs in fine and
      // would otherwise be counted as connected — but it cannot post to or
      // receive events from that guild, a SILENT failure (gates never reach
      // Discord while onHealth reports ok). Skip the company so it surfaces as
      // degraded (connected < configured) and handlers don't post into a void.
      //
      // Cache-first, then an AUTHORITATIVE fetch on a miss: guilds.cache can
      // briefly lag a bot just invited to a newly-configured guild (the
      // GUILD_CREATE gateway event hasn't arrived yet). Without the fetch, a
      // reload right after inviting the bot would permanently skip that guild
      // until the next reload/restart. fetch confirms membership against the
      // API so we only skip when the bot is genuinely absent.
      let inGuild = client.guilds.cache.has(company.guildId);
      if (!inGuild) {
        try {
          await client.guilds.fetch(company.guildId);
          inGuild = true;
        } catch {
          inGuild = false;
        }
      }
      if (!inGuild) {
        ctx.logger.error("discord-fleet: bot is not a member of company guild; skipping company", {
          companyId: company.companyId,
          guildId: company.guildId,
          usesOwnBot: Boolean(company.botTokenSecretRef),
        });
        continue;
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

  // Drop any client that ended up serving NO company — its bot is in none of
  // its configured guilds (a misconfig: valid token, never invited). Otherwise
  // it would hold an idle gateway session and receive an empty interaction
  // handler. A NEWLY-connected such client is destroyed here; a REUSED one is
  // left in existingByToken so the tokensToDestroy pass below catches it (the
  // caller destroys it after the module-state swap) — avoids double-destroy.
  const servingClients = new Set(byCompanyId.values());
  for (const [token, client] of [...newByToken]) {
    if (servingClients.has(client)) continue;
    newByToken.delete(token);
    if (existingByToken.get(token) !== client) {
      try {
        await destroyDiscordClient(client);
      } catch {
        /* best-effort cleanup of an unused newly-connected client */
      }
    }
  }

  // Tokens that were live before but are no longer used by any company in the
  // new config (removed, or dropped above as serving no company) must be
  // destroyed. Tokens still in newByToken are reused — skip them.
  const tokensToDestroy = new Map<string, Client>();
  for (const [token, client] of existingByToken) {
    if (!newByToken.has(token)) {
      tokensToDestroy.set(token, client);
    }
  }

  return { newByToken, byCompanyId, tokenByCompanyId, tokensToDestroy };
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

    // Set module-level current state (Finding 1: jobs read these, not captured locals).
    currentConfig = config;
    currentPaperclipFactory = makePaperclipFactory(ctx, config);

    // Build per-company client maps (deduped by resolved token; per-company
    // connect failures are isolated and skipped inside buildClientMaps).
    // Pass empty existingByToken on first call — nothing to reuse yet.
    const { newByToken, byCompanyId, tokenByCompanyId } = await buildClientMaps(
      ctx,
      config,
      new Map(),
    );
    clientByCompanyId = byCompanyId;
    tokenToClient = newByToken;
    configuredCompanyCount = config.companies.length;
    ctx.logger.info("discord-fleet: Discord gateway(s) connected", {
      uniqueClients: newByToken.size,
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

    // Set up interaction handlers on EACH unique client, scoped to ONLY the
    // companies that client serves (so a bot never services another company's
    // guild it happens to be in — see scopeConfigToClient).
    for (const client of newByToken.values()) {
      const clientConfig = scopeConfigToClient(config, byCompanyId, client);
      setupInteractionHandler(
        client,
        clientConfig,
        async (interaction, companyId) => {
          const companyConfig = clientConfig.companies.find((c) => c.companyId === companyId);
          if (!companyConfig) return;
          const apiKey = await ctx.secrets.resolve(companyConfig.paperclipApiKeySecretRef);
          const paperclip = new PaperclipClient(ctx, companyConfig.paperclipApiUrl, apiKey);
          await handleStatusCommand(interaction, ctx, companyConfig, paperclip);
        },
        async (interaction) => {
          await handleApprovalButton(ctx, interaction, clientConfig);
        },
        async (interaction) => {
          await handleApprovalRevisionModal(ctx, interaction, clientConfig);
        },
      );
    }

    eventUnsubscribers = bindEventHandlers(ctx, config);

    // Register job handlers. Jobs read module-level currentConfig + currentPaperclipFactory
    // + clientByCompanyId (Finding 1) so a config reload via onConfigChanged updates what
    // the jobs see without re-registering them. Each run SNAPSHOTS those three globals into
    // locals at the start (codex): otherwise a reload mid-run would mix the old company list
    // with a new client map/factory — skipping companies, posting via the wrong client, or
    // throwing "unknown company" for one removed by the reload. onConfigChanged replaces the
    // global references (it doesn't mutate the old maps), so a snapshot stays self-consistent
    // for the whole run.
    ctx.jobs.register(JOB_KEYS.digest, async () => {
      const cfg = currentConfig;
      const factory = currentPaperclipFactory;
      if (!cfg || !factory) return;
      const clients = clientByCompanyId;
      for (const company of cfg.companies) {
        const client = clients.get(company.companyId);
        if (!client) continue;
        const paperclip = await factory(company.companyId);
        await runDigest(ctx, company.companyId, client, company, paperclip);
      }
    });

    ctx.jobs.register(JOB_KEYS.stuckDetector, async () => {
      const cfg = currentConfig;
      const factory = currentPaperclipFactory;
      if (!cfg || !factory) return;
      const clients = clientByCompanyId;
      // runStuckDetector loops companies internally; pass a snapshot-bound resolver.
      await runStuckDetector(ctx, (id) => clients.get(id) ?? null, cfg, async (id) => factory(id));
    });

    ctx.jobs.register(JOB_KEYS.routineHealth, async () => {
      const cfg = currentConfig;
      const factory = currentPaperclipFactory;
      if (!cfg || !factory) return;
      const clients = clientByCompanyId;
      await runRoutineHealth(ctx, (id) => clients.get(id) ?? null, cfg, async (id) => factory(id));
    });

    ctx.jobs.register(JOB_KEYS.approvalsReminder, async () => {
      const cfg = currentConfig;
      const factory = currentPaperclipFactory;
      if (!cfg || !factory) return;
      const clients = clientByCompanyId;
      for (const company of cfg.companies) {
        const client = clients.get(company.companyId);
        if (!client) continue;
        const paperclip = await factory(company.companyId);
        await runApprovalsReminder(ctx, company.companyId, client, company, cfg, paperclip);
      }
    });

    ctx.jobs.register(JOB_KEYS.confirmationSweep, async () => {
      const cfg = currentConfig;
      const factory = currentPaperclipFactory;
      if (!cfg || !factory) return;
      const clients = clientByCompanyId;
      await runConfirmationSweep(ctx, (id) => clients.get(id) ?? null, cfg, async (id) => factory(id));
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

    if (!savedCtx) {
      console.error("discord-fleet: onConfigChanged called before setup; cannot reconnect");
      return;
    }

    for (const unsub of eventUnsubscribers) unsub();
    eventUnsubscribers = [];

    // Pass the current tokenToClient map so buildClientMaps can REUSE clients
    // whose resolved token is unchanged (Finding 2). Only genuinely-new tokens
    // get a new connect, and only obsolete tokens are destroyed. This means
    // hinomaru's root-token client survives a reload that only adds a per-company
    // bot for an unrelated company — no disconnect/IDENTIFY race for the root token.
    const { newByToken, byCompanyId, tokenByCompanyId, tokensToDestroy } =
      await buildClientMaps(savedCtx, cfg, tokenToClient);

    // Update module state before destroying obsolete clients so no window exists
    // where a job or handler reads a stale/destroyed client reference.
    clientByCompanyId = byCompanyId;
    tokenToClient = newByToken;
    configuredCompanyCount = cfg.companies.length;

    // Update module-level current config + factory (Finding 1: jobs read these).
    currentConfig = cfg;
    currentPaperclipFactory = makePaperclipFactory(savedCtx, cfg);

    // Now safely destroy only the clients whose token is no longer used by any
    // company in the new config. Reused clients (including hinomaru's root client
    // when only a new per-company bot was added) are NOT destroyed here.
    for (const [, client] of tokensToDestroy) {
      try {
        await destroyDiscordClient(client);
      } catch {
        /* best-effort: proceed even if a destroy hiccups */
      }
    }

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

    // Re-register interaction handlers on the new clients, scoped to ONLY the
    // companies each client serves (see scopeConfigToClient).
    for (const client of newByToken.values()) {
      const clientConfig = scopeConfigToClient(cfg, byCompanyId, client);
      setupInteractionHandler(
        client,
        clientConfig,
        async (interaction, companyId) => {
          const companyConfig = clientConfig.companies.find((c) => c.companyId === companyId);
          if (!companyConfig || !savedCtx) return;
          const apiKey = await savedCtx.secrets.resolve(companyConfig.paperclipApiKeySecretRef);
          const paperclip = new PaperclipClient(savedCtx, companyConfig.paperclipApiUrl, apiKey);
          await handleStatusCommand(interaction, savedCtx, companyConfig, paperclip);
        },
        async (interaction) => {
          if (!savedCtx) return;
          await handleApprovalButton(savedCtx, interaction, clientConfig);
        },
        async (interaction) => {
          if (!savedCtx) return;
          await handleApprovalRevisionModal(savedCtx, interaction, clientConfig);
        },
      );
    }

    eventUnsubscribers = bindEventHandlers(savedCtx, cfg);

    savedCtx.logger.info("discord-fleet: config updated and gateway(s) reconnected", {
      uniqueClients: newByToken.size,
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
