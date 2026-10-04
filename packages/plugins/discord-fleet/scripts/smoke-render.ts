#!/usr/bin/env tsx
/**
 * Live smoke test for PR-A.0 rich-renderer pipeline.
 *
 * Hits real paperclip on fsn via /api/approvals/:id/issues + /api/issues/:id/documents,
 * runs the new renderer transformers (renderIssueDocs → renderPostsDoc / renderSlidesDoc),
 * and prints the resulting APIEmbed groups as JSON so an operator can eyeball the output
 * before merging + deploying the PR.
 *
 * Does NOT post to Discord. Pure read-only API exercise + render dry-run.
 *
 * Usage:
 *   set -a; source /home/james-luong/code/openclaw-fleet/.env; set +a
 *   pnpm tsx scripts/smoke-render.ts <approval-uuid>
 *
 * Env required:
 *   PAPERCLIP_BOARD_KEY  — board API key with read access
 *   PAPERCLIP_API_BASE   — e.g. http://100.98.95.12:3100
 */

import { renderIssueDocs, type IssueDocsBundle } from "../src/render/issue-docs.js";

const approvalId = process.argv[2];
if (!approvalId) {
  console.error("usage: smoke-render.ts <approval-uuid>");
  process.exit(2);
}

const baseUrl = process.env.PAPERCLIP_API_BASE;
const apiKey = process.env.PAPERCLIP_BOARD_KEY;
if (!baseUrl || !apiKey) {
  console.error("missing PAPERCLIP_API_BASE or PAPERCLIP_BOARD_KEY in env");
  process.exit(2);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url} :: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface RawIssue { id: string; identifier: string }
interface RawDocument { key: string; body: string }

async function main(): Promise<void> {
  const approval = await fetchJson<{ id: string; payload: { title?: string } }>(
    `${baseUrl}/api/approvals/${approvalId}`,
  );
  const title = approval.payload?.title ?? "(no title)";
  console.error(`[smoke] approval ${approvalId.slice(0, 8)} title: ${title}`);

  const issues = await fetchJson<RawIssue[]>(`${baseUrl}/api/approvals/${approvalId}/issues`);
  console.error(`[smoke] linked issues: ${issues.length}`);

  const withDocs = await Promise.all(
    issues.map(async (i) => {
      const documents = await fetchJson<RawDocument[]>(`${baseUrl}/api/issues/${i.id}/documents`);
      const keys = documents.map((d) => d.key).join(", ");
      console.error(`[smoke]   ${i.identifier} docs: ${keys}`);
      return { issueId: i.id, identifier: i.identifier, documents };
    }),
  );

  const bundle: IssueDocsBundle = { issues: withDocs };
  const groups = renderIssueDocs(bundle, approvalId.slice(0, 8));
  console.error(`[smoke] renderer produced ${groups.length} Discord message group(s):`);
  groups.forEach((g, i) => console.error(`[smoke]   group ${i + 1}: ${g.length} embed(s)`));

  console.log(JSON.stringify({ approvalId, title, groupCount: groups.length, groups }, null, 2));
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
