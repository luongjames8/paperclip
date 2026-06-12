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

// Module-level state shared across handlers
let discordClient: Client | null = null;
let savedCtx: PluginContext | null = null;
let eventUnsubscribers: Array<() => void> = [];
const coalescer = new CoalesceBuffer(2000);

async function getConfig(ctx: PluginContext): Promise<DiscordFleetConfig> {
  const raw = await ctx.config.get();
  const cfg = raw as unknown as DiscordFleetConfig;
  validateConfig(cfg);
  return cfg;
}

function bindEventHandlers(ctx: PluginContext, client: Client, config: DiscordFleetConfig): Array<() => void> {
  return [
    ctx.events.on("issue.created", async (event) => {
      await handleIssueCreated(ctx, event, client, config);
    }),
    ctx.events.on("issue.updated", async (event) => {
      await handleIssueUpdated(ctx, event, client, config, coalescer);
    }),
    ctx.events.on("approval.created", async (event) => {
      await handleApprovalCreated(ctx, event, client, config);
    }),
  ];
}

const plugin = definePlugin({
  async setup(ctx) {
    const config = await getConfig(ctx);
    savedCtx = ctx;

    // Resolve bot token and connect Discord gateway
    const botToken = await ctx.secrets.resolve(config.botTokenSecretRef);
    discordClient = createDiscordClient();
    await connectDiscordClient(discordClient, botToken);
    ctx.logger.info("discord-fleet: Discord gateway connected");

    // Register slash commands and interaction handler for each guild
    const appId = discordClient.user?.id;
    if (appId) {
      for (const company of config.companies) {
        await registerSlashCommands(botToken, appId, company.guildId).catch((err) => {
          ctx.logger.warn("discord-fleet: slash command registration failed", { guildId: company.guildId, err: String(err) });
        });
      }
    }

    setupInteractionHandler(
      discordClient,
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

    eventUnsubscribers = bindEventHandlers(ctx, discordClient, config);

    // Register job handlers
    ctx.jobs.register(JOB_KEYS.digest, async () => {
      if (!discordClient) return;
      for (const company of config.companies) {
        const paperclip = await paperclipFactory(company.companyId);
        await runDigest(ctx, company.companyId, discordClient, company, paperclip);
      }
    });

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

    ctx.jobs.register(JOB_KEYS.stuckDetector, async () => {
      if (!discordClient) return;
      await runStuckDetector(ctx, discordClient, config, async (id) => paperclipFactory(id));
    });

    ctx.jobs.register(JOB_KEYS.routineHealth, async () => {
      if (!discordClient) return;
      await runRoutineHealth(ctx, discordClient, config, async (id) => paperclipFactory(id));
    });

    ctx.jobs.register(JOB_KEYS.approvalsReminder, async () => {
      if (!discordClient) return;
      for (const company of config.companies) {
        const paperclip = await paperclipFactory(company.companyId);
        await runApprovalsReminder(ctx, company.companyId, discordClient, company, config, paperclip);
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

    if (discordClient) {
      destroyDiscordClient(discordClient);
      discordClient = null;
    }

    if (!savedCtx) {
      console.error("discord-fleet: onConfigChanged called before setup; cannot reconnect");
      return;
    }

    const botToken = await savedCtx.secrets.resolve(cfg.botTokenSecretRef);
    discordClient = createDiscordClient();
    await connectDiscordClient(discordClient, botToken);

    eventUnsubscribers = bindEventHandlers(savedCtx, discordClient, cfg);

    savedCtx.logger.info("discord-fleet: config updated and gateway reconnected", { companies: cfg.companies.length });
  },

  async onHealth() {
    return {
      status: discordClient ? "ok" : "degraded",
      message: discordClient ? "Discord gateway connected" : "Discord client not connected",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
