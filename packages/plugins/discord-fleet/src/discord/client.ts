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

// Returns the destroy promise so callers can AWAIT the gateway session closing
// before opening a new connection for the same token (Discord rejects a second
// IDENTIFY while the prior session is still closing).
export async function destroyDiscordClient(client: Client): Promise<void> {
  await client.destroy();
}
