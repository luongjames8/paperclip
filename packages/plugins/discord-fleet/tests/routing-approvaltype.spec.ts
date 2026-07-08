import { describe, expect, it } from "vitest";
import { matchChannelByType } from "../src/routing/route.js";
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
    // is what gives the discriminator priority.
    expect(
      matchChannelByType(ROUTES, ["content_batch_approval", "Carousel-ish title"]),
    ).toBe("chan-content");
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
