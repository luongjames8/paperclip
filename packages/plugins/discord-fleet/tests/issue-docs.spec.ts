import { describe, it, expect } from "vitest";
import type { APIEmbed } from "discord.js";
import { renderIssueDocs, chunkEmbedsForDiscord, type IssueDocsBundle } from "../src/render/issue-docs.js";

function bundle(docs: Array<{ key: string; body: string }>): IssueDocsBundle {
  return { issues: [{ issueId: "iss-1", identifier: "HIN-1", documents: docs }] };
}

describe("renderIssueDocs", () => {
  it("returns [] for an empty bundle", () => {
    expect(renderIssueDocs({ issues: [] }, "abcd1234")).toEqual([]);
  });

  it("skips docs with no registered transformer", () => {
    expect(renderIssueDocs(bundle([{ key: "unknown", body: "{}" }]), "abcd1234")).toEqual([]);
  });

  it("skips when no docs have a transformer (mixed unknowns)", () => {
    expect(renderIssueDocs(bundle([{ key: "draft", body: "x" }, { key: "seo-notes", body: "y" }]), "abcd1234")).toEqual([]);
  });
});

describe("chunkEmbedsForDiscord", () => {
  it("returns [] for empty input", () => {
    expect(chunkEmbedsForDiscord([])).toEqual([]);
  });

  it("groups 12 small embeds into [10, 2] (Discord per-message embed cap = 10)", () => {
    const embeds: APIEmbed[] = Array.from({ length: 12 }, (_, i) => ({ title: `e${i}` }));
    const groups = chunkEmbedsForDiscord(embeds);
    expect(groups.map((g) => g.length)).toEqual([10, 2]);
  });

  it("starts a new group when adding another embed would exceed 6000 chars", () => {
    const bigDesc = "x".repeat(4000);
    const embeds: APIEmbed[] = [
      { description: bigDesc },
      { description: bigDesc },  // 4000 + 4000 = 8000 > 6000 → new group
      { description: "small" },
    ];
    const groups = chunkEmbedsForDiscord(embeds);
    expect(groups.map((g) => g.length)).toEqual([1, 2]);
  });

  it("returns single group for 1 small embed", () => {
    const groups = chunkEmbedsForDiscord([{ title: "only" }]);
    expect(groups).toEqual([[{ title: "only" }]]);
  });
});
