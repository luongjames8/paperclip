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

export async function postEmbedsToChannel(
  client: Client,
  channelId: string,
  embeds: APIEmbed[],
  components?: Array<APIActionRowComponent<APIComponentInMessageActionRow>>,
): Promise<string> {
  return rateLimit.enqueue(channelId, async () => {
    const channel = await fetchTextChannel(client, channelId);
    const msg = await channel.send({ embeds, components });
    return msg.id;
  });
}

export function postEmbedToChannel(
  client: Client,
  channelId: string,
  embed: APIEmbed,
  components?: Array<APIActionRowComponent<APIComponentInMessageActionRow>>,
): Promise<string> {
  return postEmbedsToChannel(client, channelId, [embed], components);
}

// Edit an already-posted channel message's embeds/components in place — used
// to best-effort disable a superseded carousel-batch trailer (strip buttons +
// annotate) when a hashChanged re-post makes it stale. Never throws on a
// "message not found/already deleted" style failure classification here —
// callers are expected to catch and log (this is a best-effort layer; the
// customId version-token check is the authoritative stale-click guard).
export async function editMessageInChannel(
  client: Client,
  channelId: string,
  messageId: string,
  opts: { embeds?: APIEmbed[]; components?: Array<APIActionRowComponent<APIComponentInMessageActionRow>> },
): Promise<void> {
  await rateLimit.enqueue(channelId, async () => {
    const channel = await fetchTextChannel(client, channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({ embeds: opts.embeds, components: opts.components });
  });
}

// PROBE (adopt-don't-duplicate): find a recently-posted message in the
// channel carrying a button with the given customId. Used when a prior
// trailer send's outcome is UNKNOWN — the send threw, but the message may
// have landed on Discord's side (timeout-after-send). The sweep adopts the
// found message as the anchor instead of posting a duplicate live-button
// trailer. Returns the message id or null; throws on fetch failure (callers
// treat that as "retry next sweep", never as "safe to post").
// limit defaults to Discord's per-fetch maximum (100). A message buried
// deeper than that within one sweep window is not adoptable — callers treat
// null as "post fresh" (trailer adopt) or "nothing to retire" (retirement
// probe); the click-time version-token guard still refuses any buried
// stale-generation card, so the residual is a dead-looking card, never a
// wrong decision.
export async function findRecentMessageWithCustomId(
  client: Client,
  channelId: string,
  customId: string,
  limit = 100,
): Promise<string | null> {
  return rateLimit.enqueue(channelId, async () => {
    const channel = await fetchTextChannel(client, channelId);
    const messages = await channel.messages.fetch({ limit });
    for (const msg of messages.values()) {
      for (const row of msg.components ?? []) {
        const comps = (row as { components?: Array<{ customId?: string | null }> }).components ?? [];
        if (comps.some((c) => c && c.customId === customId)) return msg.id;
      }
    }
    return null;
  });
}

export async function postToThread(client: Client, threadId: string, text: string): Promise<string> {
  return rateLimit.enqueue(threadId, async () => {
    const thread = await fetchThreadChannel(client, threadId);
    const msg = await thread.send({ content: truncate(stripSecrets(text)) });
    return msg.id;
  });
}

export async function postEmbedToThread(
  client: Client,
  threadId: string,
  embed: APIEmbed,
  components?: Array<APIActionRowComponent<APIComponentInMessageActionRow>>,
): Promise<string> {
  return rateLimit.enqueue(threadId, async () => {
    const thread = await fetchThreadChannel(client, threadId);
    const msg = await thread.send({ embeds: [embed], components });
    return msg.id;
  });
}
