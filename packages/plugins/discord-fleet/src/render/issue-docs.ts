import type { APIEmbed } from "discord.js";
import { EMBED_TOTAL_MAX, embedCharCount, enforceEmbedLimits } from "./embeds.js";
import { stripSecrets } from "./secrets.js";

// A URL is "embeddable" iff it's an http(s) absolute URL AND contains no
// secret pattern. Discord rejects the entire embed message for invalid
// embed URLs (relative paths, file://, javascript:, malformed schemes), so
// one bad doc URL would prevent the rich preview group from posting at all.
// stripSecrets-is-a-noop check ensures no token leaks to Discord; the scheme
// check protects against writer agents producing relative paths.
function isUrlEmbeddable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (stripSecrets(url) !== url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export interface IssueDocsBundle {
  issues: Array<{
    issueId: string;
    identifier: string;
    documents: Array<{ key: string; body: string }>;
  }>;
}

interface PostsDocShape {
  weekOf?: string;
  posts?: unknown[];
  gbp?: unknown;
}

interface SlidesDocShape {
  slug?: string;
  theme?: string;
  slides?: unknown[];
}

const EMBED_PER_MESSAGE_MAX = 10;
const DESC_MAX = 4096;
const TITLE_MAX = 256;

// Escape raw control chars inside JSON string literals only — leaves structural
// whitespace between fields untouched. Tracks in-string state and counts
// consecutive backslashes so escaped quotes don't close the string prematurely.
// Used as a lenient fallback when strict JSON.parse rejects bodies produced by
// upstream writers that embed literal newlines/tabs inside string values.
function escapeControlCharsInJsonStrings(s: string): string {
  const out: string[] = [];
  let inString = false;
  let backslashRun = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inString) {
      out.push(c);
      if (c === '"') inString = true;
      backslashRun = 0;
      continue;
    }
    if (c === '"' && backslashRun % 2 === 0) {
      inString = false;
      out.push(c);
      backslashRun = 0;
      continue;
    }
    const code = c.charCodeAt(0);
    if (code < 0x20) {
      if (c === "\n") out.push("\\n");
      else if (c === "\r") out.push("\\r");
      else if (c === "\t") out.push("\\t");
      backslashRun = 0;
    } else {
      out.push(c);
      backslashRun = c === "\\" ? backslashRun + 1 : 0;
    }
  }
  return out.join("");
}

function trySafeParseJSON(s: string): unknown {
  let t = s.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/, "");
    t = t.replace(/\s*```$/, "").trim();
  }
  try {
    return JSON.parse(t);
  } catch {
    try {
      return JSON.parse(escapeControlCharsInJsonStrings(t));
    } catch {
      return null;
    }
  }
}

export function renderPostsDoc(body: string, approvalShort: string): APIEmbed[] {
  const obj = trySafeParseJSON(body) as PostsDocShape | null;
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
    // Doc bodies are written by writer agents — strip any secrets that might have
    // landed in post text fields before they reach Discord (matches the
    // proposedComment fallback path's stripSecrets call in approval-created.ts).
    const description = stripSecrets(descLines.join("\n").trim()).slice(0, DESC_MAX);

    const embed: APIEmbed = {
      title: stripSecrets(title).slice(0, TITLE_MAX),
      description,
      footer: { text: `${i + 1}/${total} · ${tz} · [preview:${approvalShort}]`.trim() },
    };
    if (url && isUrlEmbeddable(url)) embed.url = url;
    if (img && isUrlEmbeddable(img)) embed.image = { url: img };
    out.push(enforceEmbedLimits(embed));
  });

  if (obj.gbp && typeof obj.gbp === "object") {
    const gbp = obj.gbp as Record<string, any>;
    const desc = stripSecrets(String(gbp.text ?? "")).slice(0, DESC_MAX);
    const embed: APIEmbed = {
      title: stripSecrets(`GBP — ${gbp.variant ?? "post"}`).slice(0, TITLE_MAX),
      description: desc,
      footer: { text: `GBP · ${gbp.timezone ?? ""} · [preview:${approvalShort}]`.trim() },
    };
    if (typeof gbp.url === "string" && isUrlEmbeddable(gbp.url)) embed.url = gbp.url;
    if (typeof gbp.mainImage === "string" && isUrlEmbeddable(gbp.mainImage)) embed.image = { url: gbp.mainImage };
    out.push(enforceEmbedLimits(embed));
  }

  return out;
}

export function renderSlidesDoc(body: string, approvalShort: string): APIEmbed[] {
  const obj = trySafeParseJSON(body) as SlidesDocShape | null;
  if (!obj || !Array.isArray(obj.slides) || obj.slides.length === 0) return [];

  const slug = typeof obj.slug === "string" ? obj.slug : "";
  const theme = typeof obj.theme === "string" ? obj.theme : "";
  const total = obj.slides.length;
  const out: APIEmbed[] = [];

  obj.slides.forEach((s, i) => {
    if (s === null || typeof s !== "object") return;
    const slide = s as Record<string, any>;
    const url = typeof slide.url === "string" ? slide.url : "";
    const label = typeof slide.slide === "string" ? slide.slide : (typeof slide.title === "string" ? slide.title : "");
    const baseTitle = `Slide ${i + 1}/${total}`;
    // Doc-derived label/slug/theme pass through stripSecrets — see renderPostsDoc.
    const title = stripSecrets(label && label !== baseTitle ? `${baseTitle} — ${label}` : baseTitle).slice(0, TITLE_MAX);

    const footerParts = [stripSecrets(slug), stripSecrets(theme), `[preview:${approvalShort}]`].filter(Boolean);
    const footerText = footerParts.join(" · ");

    const embed: APIEmbed = {
      title,
      footer: { text: footerText },
    };
    if (url && isUrlEmbeddable(url)) {
      embed.image = { url };
      embed.url = url;
    }
    out.push(enforceEmbedLimits(embed));
  });

  return out;
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
      (batch.length > 0 && chars + c > EMBED_TOTAL_MAX)
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

export function renderIssueDocs(bundle: IssueDocsBundle, approvalShort: string): APIEmbed[][] {
  const flat: APIEmbed[] = [];
  for (const issue of bundle.issues) {
    for (const doc of issue.documents) {
      switch (doc.key) {
        case "posts":
          flat.push(...renderPostsDoc(doc.body, approvalShort));
          break;
        case "slides":
          flat.push(...renderSlidesDoc(doc.body, approvalShort));
          break;
        default:
          // skip
      }
    }
  }
  return chunkEmbedsForDiscord(flat);
}
