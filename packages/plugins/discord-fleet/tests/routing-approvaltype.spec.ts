import { describe, expect, it } from "vitest";
import { matchChannelByExactKey, matchChannelByType } from "../src/routing/route.js";
import type { ChannelTypeRoute } from "../src/config/schema.js";

// Routing-table shape mirrors hinomaru's live approvalsChannelsByType: the
// literal discriminator rows (slot-8 design) ahead of the legacy free-text
// title rows.
const ROUTES: ChannelTypeRoute[] = [
  ["^content_batch_approval$", "chan-content"],
  ["^carousel_batch_approval$", "chan-carousel"],
  ["[Cc]arousel", "chan-carousel-title"],
  ["[Cc]ontent batch|[Aa]rticle batch|[Ww]eekly content", "chan-content-title"],
];

describe("matchChannelByType — approvalType discriminator + title fallback", () => {
  it("routes on the stable payload.approvalType constant when present", () => {
    expect(
      matchChannelByType(ROUTES, ["content_batch_approval", "Some Title The LLM Made Up"]),
    ).toBe("chan-content");
  });

  it("an LLM title paraphrase is a non-event when the discriminator is present", () => {
    // The 2026-07-07 incident title — with the discriminator, the paraphrase
    // never decides routing.
    expect(
      matchChannelByType(ROUTES, ["carousel_batch_approval", "Content batch approval — week of 2026-07-06"]),
    ).toBe("chan-carousel");
  });

  it("falls back to the title for cards that predate the constant", () => {
    expect(
      matchChannelByType(ROUTES, [undefined, "Review weekly content batch — week of 2026-07-13"]),
    ).toBe("chan-content-title");
    expect(matchChannelByType(ROUTES, ["", "Carousel batch — week of 2026-07-13"])).toBe(
      "chan-carousel-title",
    );
  });

  it("route-major order: an earlier title row can win over a later one, but never over a literal discriminator row placed first", () => {
    // Candidates are tested per-route, so placing ^…$ rows first in the table
    // is what gives the discriminator priority WITHIN a single call.
    expect(
      matchChannelByType(ROUTES, ["content_batch_approval", "Carousel-ish title"]),
    ).toBe("chan-content");
  });

  it("candidate-major composition: the discriminator wins even when a broad title row is misordered ABOVE the literal row (mirrors the handler + reminder call shape)", () => {
    // The exact two-pass expression handleApprovalCreated and
    // approvals-reminder use — priority must not depend on config row
    // ordering (codex P2, PR #26).
    const MISORDERED: ChannelTypeRoute[] = [
      ["[Cc]ontent batch", "chan-content-title"], // broad legacy row FIRST
      ["^carousel_batch_approval$", "chan-carousel"],
    ];
    const routingKey = "carousel_batch_approval";
    const title = "Content batch approval — week of X"; // matches the broad row
    const composed =
      matchChannelByExactKey(MISORDERED, routingKey) ??
      matchChannelByType(MISORDERED, [title]);
    expect(composed).toBe("chan-carousel");
    // The single-call route-major shape WOULD misroute — pinned so the
    // handler is never "simplified" back to one call:
    expect(matchChannelByType(MISORDERED, [routingKey, title])).toBe("chan-content-title");
  });

  it("returns null when nothing matches (caller falls back to approvalFallbackChannelId)", () => {
    expect(matchChannelByType(ROUTES, ["reels_approval", "Totally Novel Title"])).toBeNull();
  });

  it("skips invalid regex rows instead of breaking routing", () => {
    const withBadRow: ChannelTypeRoute[] = [["([", "chan-broken"], ...ROUTES];
    expect(
      matchChannelByType(withBadRow, ["content_batch_approval", undefined]),
    ).toBe("chan-content");
  });
});

describe("matchChannelByExactKey — the discriminator pass is exact identification", () => {
  it("a broad legacy regex that substring-matches the constant's TEXT cannot steal the key", () => {
    // codex P2 round 5: /batch/ substring-matches "content_batch_approval",
    // so a substring pass-1 still depended on row order. Full-match does not.
    const NASTY: ChannelTypeRoute[] = [
      ["batch", "chan-broad"], // matches the constant's text as a substring
      ["^content_batch_approval$", "chan-content"],
    ];
    expect(matchChannelByExactKey(NASTY, "content_batch_approval")).toBe("chan-content");
    // and the substring matcher WOULD have misrouted — pinned:
    expect(matchChannelByType(NASTY, ["content_batch_approval"])).toBe("chan-broad");
  });

  it("returns null for missing key, no-full-match, and invalid regex rows", () => {
    const ROWS: ChannelTypeRoute[] = [["([", "chan-bad"], ["^x$", "chan-x"]];
    expect(matchChannelByExactKey(ROWS, undefined)).toBeNull();
    expect(matchChannelByExactKey(ROWS, "")).toBeNull();
    expect(matchChannelByExactKey(ROWS, "xy")).toBeNull();
    expect(matchChannelByExactKey(ROWS, "x")).toBe("chan-x");
  });
});
