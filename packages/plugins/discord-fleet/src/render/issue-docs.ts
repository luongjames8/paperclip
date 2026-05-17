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
          // Task 7: flat.push(...renderPostsDoc(doc.body, issue.identifier, _approvalShort));
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
