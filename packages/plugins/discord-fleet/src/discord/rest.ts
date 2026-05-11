import type { Client, TextChannel, ThreadChannel } from "discord.js";
import type { APIActionRowComponent, APIEmbed, APIComponentInMessageActionRow } from "discord.js";
import { stripSecrets } from "../render/secrets.js";
import { truncate } from "../render/plain.js";
import { ChannelRateLimit } from "../util/ratelimit.js";

const rateLimit = new ChannelRateLimit(200);

async function fetchTextChannel(client: Client, channelId: string): Promise<TextChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new Error(`channel not found: ${channelId}`);
  return channel as TextChannel;
}

async function fetchThreadChannel(client: Client, threadId: string): Promise<ThreadChannel> {
  const channel = await client.channels.fetch(threadId);
  if (!channel) throw new Error(`channel not found: ${threadId}`);
  return channel as ThreadChannel;
}

export async function postToChannel(client: Client, channelId: string, text: string): Promise<string> {
  return rateLimit.enqueue(channelId, async () => {
    const channel = await fetchTextChannel(client, channelId);
    const msg = await channel.send({ content: truncate(stripSecrets(text)) });
    return msg.id;
  });
}

export async function postEmbedToChannel(
  client: Client,
  channelId: string,
  embed: APIEmbed,
  components?: Array<APIActionRowComponent<APIComponentInMessageActionRow>>,
): Promise<string> {
  return rateLimit.enqueue(channelId, async () => {
    const channel = await fetchTextChannel(client, channelId);
    const msg = await channel.send({ embeds: [embed], components });
    return msg.id;
  });
}

export async function postToThread(client: Client, threadId: string, text: string): Promise<string> {
  return rateLimit.enqueue(threadId, async () => {
    const thread = await fetchThreadChannel(client, threadId);
    const msg = await thread.send({ content: truncate(stripSecrets(text)) });
    return msg.id;
  });
}

export async function postEmbedToThread(client: Client, threadId: string, embed: APIEmbed): Promise<string> {
  return rateLimit.enqueue(threadId, async () => {
    const thread = await fetchThreadChannel(client, threadId);
    const msg = await thread.send({ embeds: [embed] });
    return msg.id;
  });
}
