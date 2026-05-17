import type { APIEmbed } from "discord.js";

export interface IssueDocsBundle {
  issues: Array<{
    issueId: string;
    identifier: string;
    documents: Array<{ key: string; body: string }>;
  }>;
}

const EMBED_PER_MESSAGE_MAX = 10;
const TOTAL_CHARS_PER_MESSAGE_MAX = 6000;
const DESC_MAX = 4096;
const TITLE_MAX = 256;

function trySafeParseJSON(s: string): unknown {
  let t = s.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/, "");
    t = t.replace(/\s*```$/, "").trim();
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export function renderPostsDoc(body: string, _identifier: string, approvalShort: string): APIEmbed[] {
  const obj = trySafeParseJSON(body) as { weekOf?: string; posts?: any[]; gbp?: any } | null;
  if (!obj || !Array.isArray(obj.posts)) return [];

  const posts = obj.posts.filter((p): p is Record<string, any> => p !== null && typeof p === "object");
  const total = posts.length + (obj.gbp && typeof obj.gbp === "object" ? 1 : 0);
  const out: APIEmbed[] = [];

  posts.forEach((post, i) => {
    const slot = (typeof post.slot === "object" && post.slot !== null
      ? post.slot
      : {}) as Record<string, any>;
    const day = slot.day ?? "";
    const pubDate = typeof slot.publicationDate === "string" ? slot.publicationDate : "";
    const date = pubDate.slice(0, 10);
    const slug = post.slug ?? "";
    const url = post.url ?? "";
    const img = post.mainImage ?? "";
    const tz = slot.timezone ?? "";
    const plat = (post.platforms ?? {}) as Record<string, any>;

    const titleParts = [day, date].filter(Boolean).join(" ");
    const title = (titleParts + (slug ? ` — ${slug}` : "")).trim() || `Post ${i + 1}`;

    const descLines: string[] = [];
    for (const [label, key] of [["Threads", "threads"], ["X", "x"], ["Facebook", "facebook"]] as const) {
      const section = (plat[key] ?? {}) as Record<string, any>;
      const main = section.main ?? section.text ?? "";
      const descs: string[] = Array.isArray(section.descendants) ? section.descendants : [];
      if (!main && descs.length === 0) continue;
      descLines.push(`**${label}**`);
      if (main) descLines.push(main);
      for (const d of descs) descLines.push(`  ↳ ${d}`);
      descLines.push("");
    }
    const description = descLines.join("\n").trim().slice(0, DESC_MAX);

    const embed: APIEmbed = {
      title: title.slice(0, TITLE_MAX),
      description,
      footer: { text: `${i + 1}/${total} · ${tz} · [preview:${approvalShort}]`.trim() },
    };
    if (url) embed.url = url;
    if (img) embed.image = { url: img };
    out.push(embed);
  });

  if (obj.gbp && typeof obj.gbp === "object") {
    const gbp = obj.gbp as Record<string, any>;
    const desc = String(gbp.text ?? "").slice(0, DESC_MAX);
    const embed: APIEmbed = {
      title: `GBP — ${gbp.variant ?? "post"}`.slice(0, TITLE_MAX),
      description: desc,
      footer: { text: `GBP · ${gbp.timezone ?? ""} · [preview:${approvalShort}]`.trim() },
    };
    if (gbp.url) embed.url = gbp.url;
    if (gbp.mainImage) embed.image = { url: gbp.mainImage };
    out.push(embed);
  }

  return out;
}

function embedCharCount(e: APIEmbed): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.footer?.text?.length ?? 0) +
    (e.author?.name?.length ?? 0) +
    (e.fields ?? []).reduce(
      (sum, f) => sum + (f.name?.length ?? 0) + (f.value?.length ?? 0),
      0,
    )
  );
}

/** Pack a flat list of embeds into Discord-message-sized groups (≤10 embeds, ≤6000 chars per group). */
export function chunkEmbedsForDiscord(embeds: APIEmbed[]): APIEmbed[][] {
  const out: APIEmbed[][] = [];
  let batch: APIEmbed[] = [];
  let chars = 0;
  for (const e of embeds) {
    const c = embedCharCount(e);
    if (
      batch.length >= EMBED_PER_MESSAGE_MAX ||
      (batch.length > 0 && chars + c > TOTAL_CHARS_PER_MESSAGE_MAX)
    ) {
      out.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(e);
    chars += c;
  }
  if (batch.length > 0) out.push(batch);
  return out;
}

export function renderIssueDocs(bundle: IssueDocsBundle, _approvalShort: string): APIEmbed[][] {
  const flat: APIEmbed[] = [];
  for (const issue of bundle.issues) {
    for (const doc of issue.documents) {
      switch (doc.key) {
        case "posts":
          flat.push(...renderPostsDoc(doc.body, issue.identifier, _approvalShort));
          break;
        case "slides":
          // Task 8: flat.push(...renderSlidesDoc(doc.body, issue.identifier, _approvalShort));
          break;
        default:
          // skip
      }
    }
  }
  return chunkEmbedsForDiscord(flat);
}
