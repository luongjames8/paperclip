import type { PluginContext } from "@paperclipai/plugin-sdk";

export interface ThreadEntry {
  channelId: string;
  threadId: string;
  createdAt: string; // ISO timestamp
}

type ThreadMap = Record<string, ThreadEntry>;

async function loadMap(ctx: PluginContext, companyId: string): Promise<ThreadMap> {
  const value = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: "thread-mappings",
  });
  return (value as ThreadMap | null) ?? {};
}

export async function getThreadForIssue(
  ctx: PluginContext,
  companyId: string,
  issueId: string,
): Promise<ThreadEntry | null> {
  const map = await loadMap(ctx, companyId);
  return map[issueId] ?? null;
}

export async function setThreadForIssue(
  ctx: PluginContext,
  companyId: string,
  issueId: string,
  entry: ThreadEntry,
): Promise<void> {
  const map = await loadMap(ctx, companyId);
  map[issueId] = entry;
  await ctx.state.set(
    { scopeKind: "company", scopeId: companyId, stateKey: "thread-mappings" },
    map,
  );
}

export async function getThreadForAncestors(
  ctx: PluginContext,
  companyId: string,
  ancestorIds: string[],
): Promise<ThreadEntry | null> {
  const map = await loadMap(ctx, companyId);
  for (const id of ancestorIds) {
    if (id in map) return map[id];
  }
  return null;
}
