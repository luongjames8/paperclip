import { ThreadAutoArchiveDuration } from "discord.js";
import type { Client, TextChannel, ThreadChannel } from "discord.js";
import type { APIEmbed } from "discord.js";
import type { ThreadEntry } from "../routing/thread-state.js";

const THREAD_NAME_MAX = 100;

export async function createThread(
  client: Client,
  channelId: string,
  threadName: string,
  firstEmbedOrText: string | APIEmbed,
): Promise<ThreadEntry> {
  const channel = (await client.channels.fetch(channelId)) as TextChannel;
  if (!channel) throw new Error(`channel not found: ${channelId}`);

  const name = threadName.length > THREAD_NAME_MAX ? threadName.slice(0, THREAD_NAME_MAX) : threadName;

  const thread = await channel.threads.create({
    name,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: "discord-fleet issue",
  });

  if (typeof firstEmbedOrText === "string") {
    await thread.send({ content: firstEmbedOrText });
  } else {
    await thread.send({ embeds: [firstEmbedOrText] });
  }

  return {
    channelId,
    threadId: thread.id,
    createdAt: new Date().toISOString(),
  };
}

// Recovers an existing thread or recreates it if gone (404/410).
// Always returns a usable ThreadEntry — never null.
// Pass threadName + firstContent so recreation produces a meaningful thread.
export async function recoverThread(
  client: Client,
  channelId: string,
  threadId: string,
  threadName: string,
  firstContent: string | APIEmbed = "",
): Promise<ThreadEntry> {
  let thread: ThreadChannel;
  try {
    const fetched = await client.channels.fetch(threadId);
    if (!fetched) {
      return createThread(client, channelId, threadName, firstContent);
    }
    thread = fetched as ThreadChannel;
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    const code = (err as { code?: number }).code;
    // 410 or code 10003 (not 404): thread is permanently deleted, recreate immediately.
    if (status === 410 || (code === 10003 && status !== 404)) {
      return createThread(client, channelId, threadName, firstContent);
    }
    // 404: Discord hides archived threads from fetch — try to unarchive via REST PATCH.
    if (status === 404) {
      try {
        await client.rest.patch(`/channels/${threadId}` as `/${string}`, { body: { archived: false } });
        return { channelId, threadId, createdAt: new Date().toISOString() };
      } catch (patchErr: unknown) {
        const ps = (patchErr as { status?: number }).status;
        const pc = (patchErr as { code?: number }).code;
        if (ps === 404 || ps === 410 || pc === 10003) {
          return createThread(client, channelId, threadName, firstContent);
        }
        throw patchErr;
      }
    }
    throw err;
  }

  if (thread.archived) {
    await thread.edit({ archived: false });
  }

  return {
    channelId,
    threadId: thread.id,
    createdAt: new Date().toISOString(),
  };
}
