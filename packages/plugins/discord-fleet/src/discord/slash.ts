import { REST, Routes, SlashCommandBuilder } from "discord.js";
import type { ButtonInteraction, ChatInputCommandInteraction, Client } from "discord.js";
import type { DiscordFleetConfig } from "../config/schema.js";

const STATUS_COMMAND = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show fleet status for this server");

export async function registerSlashCommands(
  botToken: string,
  appId: string,
  guildId: string,
): Promise<void> {
  const rest = new REST().setToken(botToken);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), {
    body: [STATUS_COMMAND.toJSON()],
  });
}

export function setupInteractionHandler(
  client: Client,
  config: DiscordFleetConfig,
  statusHandler: (interaction: ChatInputCommandInteraction, companyId: string) => Promise<void>,
  buttonHandler: (interaction: ButtonInteraction) => Promise<void>,
): void {
  client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton()) {
      try {
        await buttonHandler(interaction);
      } catch (err) {
        // Defense-in-depth: any exception bubbling out of buttonHandler
        // becomes an unhandledRejection on the async event listener and
        // crashes the plugin worker. Log + swallow.
        console.error("discord-fleet: button handler threw, swallowed to keep worker alive", err);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "status") return;

    const company = config.companies.find((c) => c.guildId === interaction.guildId);
    if (!company) {
      await interaction.reply({ content: "No company configured for this guild.", ephemeral: true });
      return;
    }

    await statusHandler(interaction, company.companyId);
  });
}
