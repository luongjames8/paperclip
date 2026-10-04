import { describe, it, expect } from "vitest";
import { truncate, chunkText } from "../src/render/plain.js";
import { enforceEmbedLimits, buildApprovalActionRow, APPROVAL_BUTTON_PREFIX, buildApprovalEmbed, buildCarouselAnchorEmbed } from "../src/render/embeds.js";
import { ButtonStyle, ComponentType } from "discord.js";

describe("render helpers", () => {
  it("truncate: message ≤1900 chars passes through unchanged", () => {
    const text = "a".repeat(1900);
    expect(truncate(text)).toBe(text);
  });

  it("truncate: message >1900 chars is truncated and ends with the URL", () => {
    const text = "a".repeat(2000);
    const url = "https://example.com/issues/123";
    const result = truncate(text, 1900, url);
    expect(result.length).toBeLessThanOrEqual(1900);
    expect(result.endsWith(url)).toBe(true);
  });

  it("chunkText: non-positive maxLen throws — it used to INFINITE-LOOP (empty chunk pushed, remaining never shrinks; codex P2, posts-batch round 7)", () => {
    expect(() => chunkText("non-empty", 0)).toThrow(/maxLen must be >= 1/);
    expect(() => chunkText("non-empty", -5)).toThrow(/maxLen must be >= 1/);
    // maxLen 1 with a leading paragraph break must still terminate.
    expect(chunkText("\n\nab", 1).join("")).toBe("\n\nab");
  });

  it("chunkText: text ≤maxLen passes through as a single chunk, unchanged", () => {
    const text = "a".repeat(1900);
    expect(chunkText(text)).toEqual([text]);
  });

  it("chunkText: splits at a paragraph boundary when one is available before maxLen — the '\\n\\n' separator is PRESERVED (attached to the start of the next chunk), never dropped", () => {
    const text = "a".repeat(1000) + "\n\n" + "b".repeat(1000);
    const chunks = chunkText(text, 1500);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("a".repeat(1000));
    expect(chunks[1]).toBe("\n\n" + "b".repeat(1000));
    // The join must reconstruct the ORIGINAL text exactly — this is the
    // codex P2 (round 2) regression: an earlier version silently dropped
    // the "\n\n" separator at every paragraph-boundary split.
    expect(chunks.join("")).toBe(text);
  });

  it("chunkText: NOTHING is dropped — chunks.join('') reconstructs the input EXACTLY, for both paragraph-boundary and hard splits", () => {
    const noBoundaries = "x".repeat(5000);
    const noBoundaryChunks = chunkText(noBoundaries, 1500);
    expect(noBoundaryChunks.join("")).toBe(noBoundaries);
    noBoundaryChunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(1500));

    const withBoundaries = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}. `.repeat(50)).join("\n\n");
    const boundaryChunks = chunkText(withBoundaries, 400);
    expect(boundaryChunks.join("")).toBe(withBoundaries);
    boundaryChunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(400));
  });

  it("chunkText: a single paragraph longer than maxLen with no earlier \\n\\n hard-splits at maxLen", () => {
    const text = "a".repeat(3000); // no paragraph breaks at all
    const chunks = chunkText(text, 1500);
    expect(chunks.join("")).toBe(text);
    expect(chunks[0].length).toBe(1500);
  });

  it("enforceEmbedLimits: embed ≤6000 chars is unchanged", () => {
    const embed = {
      title: "b".repeat(100),
      description: "a".repeat(200),
    };
    const result = enforceEmbedLimits(embed);
    expect(result.title).toBe(embed.title);
    expect(result.description).toBe(embed.description);
  });

  it("enforceEmbedLimits: embed >6000 chars truncates description with ellipsis", () => {
    const embed = {
      title: "b".repeat(200),
      description: "a".repeat(5900),
    };
    // total = 6100 > 6000
    const result = enforceEmbedLimits(embed);
    const totalLen = (result.title?.length ?? 0) + (result.description?.length ?? 0);
    expect(totalLen).toBeLessThanOrEqual(6000);
    expect(result.description?.endsWith("…")).toBe(true);
  });

  it("enforceEmbedLimits: footer + author counted in 6000-char budget", () => {
    const embed = {
      title: "t".repeat(100),
      description: "a".repeat(5800),
      footer: { text: "f".repeat(100) },
      author: { name: "n".repeat(50) },
    };
    // title(100) + description(5800) + footer(100) + author(50) = 6050 > 6000
    const result = enforceEmbedLimits(embed);
    const totalLen =
      (result.title?.length ?? 0) +
      (result.description?.length ?? 0) +
      (result.footer?.text?.length ?? 0) +
      (result.author?.name?.length ?? 0);
    expect(totalLen).toBeLessThanOrEqual(6000);
    expect(result.description?.endsWith("…")).toBe(true);
  });

  it("enforceEmbedLimits: footer clamped to its per-field 2048 cap", () => {
    const embed = {
      title: "t",
      footer: { text: "f".repeat(3000) },
    };
    const result = enforceEmbedLimits(embed);
    expect(result.footer?.text?.length).toBeLessThanOrEqual(2048);
  });
});

describe("buildApprovalActionRow", () => {
  const ROW = buildApprovalActionRow({
    approvalId: "appr-test-123",
    issueUrl: "https://paperclip.example.com/issues/appr-test-123",
  });

  it("returns exactly 4 components", () => {
    expect(ROW.components).toHaveLength(4);
  });

  it("first component is ✅ Approve button with style=Success", () => {
    const btn = ROW.components[0] as any;
    expect(btn.type).toBe(ComponentType.Button);
    expect(btn.style).toBe(ButtonStyle.Success);
    expect(btn.label).toBe("✅ Approve");
  });

  it("second component is ❌ Reject button with style=Danger", () => {
    const btn = ROW.components[1] as any;
    expect(btn.type).toBe(ComponentType.Button);
    expect(btn.style).toBe(ButtonStyle.Danger);
    expect(btn.label).toBe("❌ Reject");
  });

  it("third component is ✏️ Request changes button with style=Primary", () => {
    const btn = ROW.components[2] as any;
    expect(btn.type).toBe(ComponentType.Button);
    expect(btn.style).toBe(ButtonStyle.Primary);
    expect(btn.label).toBe("✏️ Request changes");
  });

  it("fourth component is View button with style=Link and url set", () => {
    const btn = ROW.components[3] as any;
    expect(btn.type).toBe(ComponentType.Button);
    expect(btn.style).toBe(ButtonStyle.Link);
    expect(btn.label).toBe("View");
    expect(btn.url).toBe("https://paperclip.example.com/issues/appr-test-123");
  });

  it("Approve custom_id uses APPROVAL_BUTTON_PREFIX.approve + approvalId", () => {
    const btn = ROW.components[0] as any;
    expect(btn.custom_id).toBe(`${APPROVAL_BUTTON_PREFIX.approve}appr-test-123`);
  });

  it("Reject custom_id uses APPROVAL_BUTTON_PREFIX.reject + approvalId", () => {
    const btn = ROW.components[1] as any;
    expect(btn.custom_id).toBe(`${APPROVAL_BUTTON_PREFIX.reject}appr-test-123`);
  });

  it("Request changes custom_id uses APPROVAL_BUTTON_PREFIX.revision + approvalId", () => {
    const btn = ROW.components[2] as any;
    expect(btn.custom_id).toBe(`${APPROVAL_BUTTON_PREFIX.revision}appr-test-123`);
  });

  it("Link button has no custom_id (Discord Link buttons must not have custom_id)", () => {
    const btn = ROW.components[3] as any;
    expect(btn.custom_id).toBeUndefined();
  });
});

// ─── buildApprovalEmbed — description content ────────────────────────────────
//
// Earlier embed template included "_Content batch in thread below ↓_" as a
// trailing line — leftover from the orphan-thread design retired by 72bdca5f.
// The text now lies (no thread spawned for orphan path; embed posts INTO the
// existing work thread for issue-linked path — there is no "below"). Removed
// in this fix; lock with a test so it doesn't regress.

describe("buildApprovalEmbed — description", () => {
  const embed = buildApprovalEmbed({
    identifier: "HIN-999",
    approvalId: "appr-abc12345-def6-7890-1234-567890abcdef",
    approvalType: "request_board_approval",
    title: "Test approval",
    issueUrl: "https://paperclip.example.com/HIN/approvals/appr-abc12345",
  });

  it("includes the approval type", () => {
    expect(embed.description).toContain("**Type**: request_board_approval");
  });

  it("includes the short approval id (first 8 chars + ellipsis)", () => {
    // shortId = opts.approvalId.slice(0, 8) → "appr-abc"
    expect(embed.description).toContain("**ID**: appr-abc...");
  });

  it("includes the View & Approve link", () => {
    expect(embed.description).toContain("[View & Approve in Paperclip](https://paperclip.example.com/HIN/approvals/appr-abc12345)");
  });

  it("does NOT promise a thread below (orphan-thread design was retired in 72bdca5f)", () => {
    expect(embed.description).not.toMatch(/thread below/i);
    expect(embed.description).not.toMatch(/Content batch/i);
  });
});

// ─── buildCarouselAnchorEmbed — status vocabulary shared by sweep + button
// handler (kills "stacked generations", 2026-07-11 live incident) ───────────

describe("buildCarouselAnchorEmbed", () => {
  const issueUrl = "https://paperclip.example.com/tc1/issues/ISS-1";

  it("awaiting: 🟡 status line + issue link, blue color", () => {
    const embed = buildCarouselAnchorEmbed({ issueUrl, status: "awaiting" });
    expect(embed.description).toContain("🟡 awaiting decision");
    expect(embed.description).toContain(`[View full batch in Paperclip](${issueUrl})`);
    expect(embed.color).toBe(0x5865f2);
  });

  it("accepted: ✅ status line + detail, green color", () => {
    const embed = buildCarouselAnchorEmbed({ issueUrl, status: "accepted", detail: "Accepted by alice at 2026-07-11T00:00:00.000Z" });
    expect(embed.description).toContain("✅ accepted");
    expect(embed.description).toContain("Accepted by alice");
    expect(embed.color).toBe(0x57f287);
  });

  it("rejected: ❌ status line + reason detail, red color", () => {
    const embed = buildCarouselAnchorEmbed({ issueUrl, status: "rejected", detail: "Rejected by bob — wrong week" });
    expect(embed.description).toContain("❌ rejected");
    expect(embed.description).toContain("wrong week");
    expect(embed.color).toBe(0xed4245);
  });

  it("superseded: ⏰ status line, grey color, no detail required", () => {
    const embed = buildCarouselAnchorEmbed({ issueUrl, status: "superseded" });
    expect(embed.description).toContain("⏰ superseded");
    expect(embed.color).toBe(0x99aab5);
  });

  it("expired: ⏰ status line, distinct wording from superseded", () => {
    const embed = buildCarouselAnchorEmbed({ issueUrl, status: "expired" });
    expect(embed.description).toContain("⏰ expired");
    expect(embed.description).not.toContain("superseded");
  });

  it("title is a function of status — the operator can tell decided/expired from pending without opening the card", () => {
    expect(buildCarouselAnchorEmbed({ issueUrl, status: "awaiting" }).title).toBe("Decision needed");
    expect(buildCarouselAnchorEmbed({ issueUrl, status: "accepted" }).title).toBe("Decision: accepted");
    expect(buildCarouselAnchorEmbed({ issueUrl, status: "rejected" }).title).toBe("Decision: rejected");
    expect(buildCarouselAnchorEmbed({ issueUrl, status: "superseded" }).title).toBe("Superseded");
    expect(buildCarouselAnchorEmbed({ issueUrl, status: "expired" }).title).toBe("Expired — no decision in time");
  });

  it("detail is truncated/sanitized through safe() (long or secret-bearing detail never blows embed limits)", () => {
    const embed = buildCarouselAnchorEmbed({ issueUrl, status: "rejected", detail: "x".repeat(5000) });
    expect(embed.description!.length).toBeLessThan(6000);
  });
});
