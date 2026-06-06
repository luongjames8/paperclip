import { Client, GatewayIntentBits } from "discord.js";

export function createDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });
}

export async function connectDiscordClient(client: Client, token: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.once("ready", () => resolve());
    client.once("error", reject);
    client.login(token).catch(reject);
  });
}

export function destroyDiscordClient(client: Client): void {
  client.destroy();
}
