import { describe, it, expect } from "vitest";
import {
  parsePostsBatchPayload,
  renderPostsBatchEmbeds,
  renderOverflowMessages,
  chunkPostsBatchForDiscord,
  buildPartialDeliveryWarning,
  type PostsBatchPayload,
  type PostsBatchPlatformOverflow,
} from "../src/render/posts-batch.js";

function validPayload(overrides: Partial<PostsBatchPayload> = {}): PostsBatchPayload {
  return {
    version: 1,
    weekOf: "2026-07-13",
    items: [
      {
        slug: "tokyo-trifecta",
        day: "Mon",
        postTime: "Mon 2026-07-13 12:00 Taipei",
        imageUrl: "https://hinomaru.one/images/tours/trifecta-card.avif",
        hook: "Three neighborhoods, three completely different Tokyos, one seamless private day.",
        platforms: {
          threads: "Three neighborhoods. Three completely different Tokyos. One afternoon.",
          x: "Three neighborhoods. Three Tokyos. One afternoon.",
          facebook: "Three neighborhoods. Three completely different Tokyos. One afternoon. (long form)",
        },
      },
      {
        slug: "layover",
        day: null,
        postTime: null,
        imageUrl: "https://hinomaru.one/images/tours/layover-hero.jpg",
        hook: "Have 8+ hours at Haneda? You can actually see Tokyo.",
        platforms: { gbp: "Have 8+ hours at Haneda? You can actually see Tokyo." },
      },
    ],
    ...overrides,
  };
}

describe("parsePostsBatchPayload", () => {
  it("parses a well-formed version-1 payload", () => {
    const parsed = parsePostsBatchPayload(validPayload());
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(1);
    expect(parsed!.items).toHaveLength(2);
  });

  it("accepts a null day/postTime on an item (unplanned/no fixed slot)", () => {
    const parsed = parsePostsBatchPayload(validPayload());
    expect(parsed!.items[1].day).toBeNull();
    expect(parsed!.items[1].postTime).toBeNull();
  });

  it("accepts an item with only SOME platforms present", () => {
    const parsed = parsePostsBatchPayload(validPayload());
    expect(parsed!.items[1].platforms).toEqual({ gbp: "Have 8+ hours at Haneda? You can actually see Tokyo." });
  });

  it("0 items (empty array) is VALID", () => {
    const parsed = parsePostsBatchPayload(validPayload({ items: [] }));
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toEqual([]);
  });

  it("missing weekOf → still parses structured (weekOf is optional passthrough)", () => {
    const { weekOf, ...rest } = validPayload();
    const parsed = parsePostsBatchPayload(rest);
    expect(parsed).not.toBeNull();
    expect(parsed!.weekOf).toBeUndefined();
  });

  // ── Malformed-shape guards — every one degrades to null, never throws ──────
  it("null/undefined → null", () => {
    expect(parsePostsBatchPayload(null)).toBeNull();
    expect(parsePostsBatchPayload(undefined)).toBeNull();
  });

  it("non-object (string, number) → null", () => {
    expect(parsePostsBatchPayload("not an object")).toBeNull();
    expect(parsePostsBatchPayload(42)).toBeNull();
  });

  it("wrong version → null", () => {
    expect(parsePostsBatchPayload({ ...validPayload(), version: 2 })).toBeNull();
    expect(parsePostsBatchPayload({ ...validPayload(), version: "1" })).toBeNull();
  });

  it("items not an array → null", () => {
    expect(parsePostsBatchPayload({ ...validPayload(), items: "not-an-array" })).toBeNull();
  });

  it("an item missing a required field → null (whole payload rejected, not a partial parse)", () => {
    expect(
      parsePostsBatchPayload({
        ...validPayload(),
        items: [{ slug: "a", day: "Mon", imageUrl: "https://x.example.com/a.jpg" }], // missing hook
      }),
    ).toBeNull();
    expect(
      parsePostsBatchPayload({
        ...validPayload(),
        items: [{ slug: "a", day: "Mon", hook: "h" }], // missing imageUrl
      }),
    ).toBeNull();
  });

  it("non-URL imageUrl ('' or plain text) → whole payload null, never a Discord-rejectable embed", () => {
    // Mirrors carousel-batch's isRenderableSlideUrl guard — one bad image makes
    // the WHOLE payload malformed (never render N-1 posts and silently drop
    // the Nth), so the caller falls through to the plaintext degrade path.
    expect(
      parsePostsBatchPayload(validPayload({ items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "", hook: "h", platforms: {} }] })),
    ).toBeNull();
    expect(
      parsePostsBatchPayload(validPayload({ items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "not a url", hook: "h", platforms: {} }] })),
    ).toBeNull();
    expect(
      parsePostsBatchPayload(validPayload({ items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "ftp://wrong.scheme/x.jpg", hook: "h", platforms: {} }] })),
    ).toBeNull();
    // Prefix-passing but UNPARSEABLE URLs — new URL() rejects what a
    // /^https?:\/\// regex would accept.
    expect(
      parsePostsBatchPayload(validPayload({ items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "https://exa mple.com/1.png", hook: "h", platforms: {} }] })),
    ).toBeNull();
    expect(
      parsePostsBatchPayload(validPayload({ items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "http://[", hook: "h", platforms: {} }] })),
    ).toBeNull();
  });

  // codex P1: an imageUrl containing a secret-shaped token must be rejected —
  // the structured render path (renderPostsBatchEmbeds) sends imageUrl straight
  // to embed.image.url with no stripSecrets pass, unlike the plaintext
  // degrade path (which always runs stripSecrets(effectiveContent) first) and
  // issue-docs.ts's sibling isUrlEmbeddable (which already rejects
  // stripSecrets(url) !== url).
  it("imageUrl containing a secret-shaped token → whole payload null (never reaches Discord raw)", () => {
    expect(
      parsePostsBatchPayload(
        validPayload({ items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "https://x.example.com/pcp_ABCDEFGHIJKLMNOPQRST12.jpg", hook: "h", platforms: {} }] }),
      ),
    ).toBeNull();
    expect(
      parsePostsBatchPayload(
        validPayload({ items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "https://x.example.com/img.jpg?token=ghp_" + "a".repeat(36), hook: "h", platforms: {} }] }),
      ),
    ).toBeNull();
  });

  it("wrong-typed day/postTime → null", () => {
    expect(parsePostsBatchPayload({ ...validPayload(), items: [{ slug: "a", day: 5, postTime: null, imageUrl: "https://x.example.com/a.jpg", hook: "h" }] })).toBeNull();
    expect(parsePostsBatchPayload({ ...validPayload(), items: [{ slug: "a", day: "Mon", postTime: 5, imageUrl: "https://x.example.com/a.jpg", hook: "h" }] })).toBeNull();
  });

  it("non-string platform values are dropped, not preserved", () => {
    const parsed = parsePostsBatchPayload(
      validPayload({ items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "https://x.example.com/a.jpg", hook: "h", platforms: { threads: 5 as unknown as string, x: "valid" } }] }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.items[0].platforms).toEqual({ x: "valid" });
  });

  it("missing platforms object → empty platforms, not a parse failure", () => {
    // Runtime input is `unknown` — a real malformed payload can omit
    // `platforms` entirely, which the strict PostsBatchItem TS type forbids.
    // `as any` here simulates that raw-JSON shape at the parser boundary.
    const parsed = parsePostsBatchPayload(
      validPayload({ items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "https://x.example.com/a.jpg", hook: "h" } as any] }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.items[0].platforms).toEqual({});
  });
});

describe("renderPostsBatchEmbeds", () => {
  it("renders one embed per post with distinct image.url", () => {
    const payload = validPayload();
    const { embeds } = renderPostsBatchEmbeds(payload);

    expect(embeds).toHaveLength(2);
    expect(embeds[0].image?.url).toBe(payload.items[0].imageUrl);
    expect(embeds[1].image?.url).toBe(payload.items[1].imageUrl);
  });

  it("title includes day/postTime/slug when present", () => {
    const payload = validPayload();
    const { embeds } = renderPostsBatchEmbeds(payload);
    expect(embeds[0].title).toContain("Mon");
    expect(embeds[0].title).toContain("tokyo-trifecta");
  });

  it("title falls back to 'Post N/total' when day/postTime/slug are all absent", () => {
    const payload = validPayload({ items: [{ slug: "", day: null, postTime: null, imageUrl: "https://x.example.com/a.jpg", hook: "h", platforms: {} }] });
    const { embeds } = renderPostsBatchEmbeds(payload);
    expect(embeds[0].title).toBe("Post 1/1");
  });

  it("description is the hook text", () => {
    const payload = validPayload();
    const { embeds } = renderPostsBatchEmbeds(payload);
    expect(embeds[0].description).toBe(payload.items[0].hook);
  });

  it("each present platform becomes its own field; absent platforms produce no field", () => {
    const payload = validPayload();
    const { embeds } = renderPostsBatchEmbeds(payload);

    const fieldNames0 = embeds[0].fields?.map((f) => f.name) ?? [];
    expect(fieldNames0).toEqual(["Threads", "X", "Facebook"]);

    const fieldNames1 = embeds[1].fields?.map((f) => f.name) ?? [];
    expect(fieldNames1).toEqual(["GBP"]);
  });

  it("footer includes position and weekOf", () => {
    const payload = validPayload();
    const { embeds } = renderPostsBatchEmbeds(payload);
    expect(embeds[0].footer?.text).toContain("1/2");
    expect(embeds[0].footer?.text).toContain("2026-07-13");
  });

  it("0 items → 0 embeds, 0 overflow", () => {
    const { embeds, overflow } = renderPostsBatchEmbeds(validPayload({ items: [] }));
    expect(embeds).toEqual([]);
    expect(overflow).toEqual([]);
  });

  // codex P2: a platform copy longer than Discord's 1024-char embed field
  // limit must never be silently truncated with no trace — the field shows
  // a marked preview, and the FULL text comes back via `overflow` for the
  // caller to post as a plaintext follow-up.
  describe("platform-copy overflow (>1024 chars)", () => {
    it("field value is truncated with a '(full text below)' marker in the name", () => {
      const longCopy = "x".repeat(1500);
      const payload = validPayload({
        items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "https://x.example.com/a.jpg", hook: "h", platforms: { threads: longCopy } }],
      });
      const { embeds, overflow } = renderPostsBatchEmbeds(payload);

      expect(embeds[0].fields?.[0].name).toBe("Threads (full text below)");
      expect(embeds[0].fields?.[0].value.length).toBeLessThanOrEqual(1024);
      expect(overflow).toHaveLength(1);
      expect(overflow[0]).toEqual({ itemSlug: "a", platformLabel: "Threads", fullText: longCopy });
    });

    it("platform copy at or under 1024 chars produces no overflow and an unmarked field name", () => {
      const shortCopy = "x".repeat(1024);
      const payload = validPayload({
        items: [{ slug: "a", day: "Mon", postTime: null, imageUrl: "https://x.example.com/a.jpg", hook: "h", platforms: { threads: shortCopy } }],
      });
      const { embeds, overflow } = renderPostsBatchEmbeds(payload);

      expect(embeds[0].fields?.[0].name).toBe("Threads");
      expect(overflow).toEqual([]);
    });

    it("multiple overflowing platforms on the same item each produce their own overflow entry", () => {
      const payload = validPayload({
        items: [{
          slug: "a", day: "Mon", postTime: null, imageUrl: "https://x.example.com/a.jpg", hook: "h",
          platforms: { threads: "t".repeat(1200), facebook: "f".repeat(1300) },
        }],
      });
      const { overflow } = renderPostsBatchEmbeds(payload);

      expect(overflow).toHaveLength(2);
      expect(overflow.map((o) => o.platformLabel).sort()).toEqual(["Facebook", "Threads"]);
    });
  });
});

// ─── renderOverflowMessages — adversarial coverage (codex P2, round 2 of the
// SAME finding: chunking the body to the full message budget THEN prepending
// a header could push the total past the budget and get the tail silently
// cut by postToChannel's own truncate). The invariant every test here checks:
// EVERY returned string's length is <= maxLen, and the concatenation of every
// returned string's BODY portion (header stripped) reconstructs fullText
// exactly — nothing lost, nothing duplicated, regardless of length. ─────────

function overflowItem(fullText: string, itemSlug = "tokyo-trifecta", platformLabel = "Facebook"): PostsBatchPlatformOverflow {
  return { itemSlug, platformLabel, fullText };
}

// Strips this function's own header format to recover the body portion of
// a rendered message, so tests can verify body reconstruction independent
// of the header's exact wording.
function stripHeader(message: string): string {
  const nl = message.indexOf("\n");
  return nl === -1 ? message : message.slice(nl + 1);
}

describe("renderOverflowMessages", () => {
  it("short text (fits in one message) → single message, header + full text, within maxLen", () => {
    const text = "Short Facebook copy.";
    const messages = renderOverflowMessages(overflowItem(text), 1900);
    expect(messages).toHaveLength(1);
    expect(messages[0].length).toBeLessThanOrEqual(1900);
    expect(messages[0]).toContain(text);
    expect(messages[0]).toContain("tokyo-trifecta");
    expect(messages[0]).toContain("Facebook");
    expect(messages[0]).toContain("1/1");
  });

  it("EVERY returned message is <= maxLen INCLUDING its header — the exact bug codex found", () => {
    // Sized so the OLD buggy code (chunk to full 1900 budget, then prepend a
    // ~50-char header) would overflow: a 1900-char chunk + header > 1900.
    const text = "y".repeat(3700);
    const messages = renderOverflowMessages(overflowItem(text), 1900);
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) {
      expect(m.length).toBeLessThanOrEqual(1900);
    }
  });

  it("nothing is dropped — concatenated BODY across all messages reconstructs fullText exactly", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} of long-form platform copy.`).join("\n\n");
    const messages = renderOverflowMessages(overflowItem(text), 500);
    const reconstructed = messages.map(stripHeader).join("");
    expect(reconstructed).toBe(text);
  });

  it("every message carries a header (a reader landing on any single message can identify it)", () => {
    const text = "z".repeat(5000);
    const messages = renderOverflowMessages(overflowItem(text), 500);
    expect(messages.length).toBeGreaterThan(5);
    for (const m of messages) {
      expect(m).toContain("tokyo-trifecta");
      expect(m).toContain("Facebook");
      expect(m).toMatch(/\(full text \d+\/\d+\)/);
    }
  });

  it("chunk numbering is internally consistent (N always <= total M, every N from 1..M appears exactly once)", () => {
    const text = "w".repeat(10000);
    const messages = renderOverflowMessages(overflowItem(text), 300);
    const numbering = messages.map((m) => {
      const match = /\(full text (\d+)\/(\d+)\)/.exec(m);
      if (!match) throw new Error(`message missing numbering: ${m.slice(0, 50)}`);
      return { n: Number(match[1]), total: Number(match[2]) };
    });
    const total = numbering[0].total;
    expect(numbering.every((x) => x.total === total)).toBe(true);
    expect(numbering.map((x) => x.n)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(total).toBe(messages.length);
  });

  it("boundary: fullText exactly at the body budget → exactly 1 message, no off-by-one split", () => {
    // With a small maxLen, compute the actual body budget by probing: a
    // 1-char text always yields exactly 1 message; grow until 2 messages
    // appear, then verify the boundary text (budget-length) still yields 1.
    const maxLen = 200;
    let budget = 1;
    while (renderOverflowMessages(overflowItem("q".repeat(budget)), maxLen).length === 1) budget++;
    const boundaryText = "q".repeat(budget - 1);
    const messages = renderOverflowMessages(overflowItem(boundaryText), maxLen);
    expect(messages).toHaveLength(1);
    expect(messages[0].length).toBeLessThanOrEqual(maxLen);
  });

  it("long itemSlug/platformLabel (widening the header) never pushes a message over maxLen", () => {
    const longSlug = "a-very-long-slug-name-that-takes-up-a-lot-of-header-space".repeat(3);
    const text = "b".repeat(2500);
    const messages = renderOverflowMessages(overflowItem(text, longSlug, "Facebook"), 1900);
    for (const m of messages) {
      expect(m.length).toBeLessThanOrEqual(1900);
    }
    // Still reconstructs the full body despite the wider header eating more
    // of the per-message budget.
    expect(messages.map(stripHeader).join("")).toBe(text);
  });

  it("empty fullText → single message with just the header (never zero messages — an overflow entry always exists because SOME text overflowed)", () => {
    const messages = renderOverflowMessages(overflowItem(""));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("1/1");
  });

  it("respects a custom maxLen (not hardcoded to 1900)", () => {
    const text = "c".repeat(400);
    const messages = renderOverflowMessages(overflowItem(text), 100);
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) {
      expect(m.length).toBeLessThanOrEqual(100);
    }
  });

  it("FAILS CLOSED (throws) when maxLen is too small to fit even the reserved header — never silently ships an oversized message", () => {
    expect(() => renderOverflowMessages(overflowItem("some text"), 5)).toThrow(/maxLen.*smaller than the reserved header budget/);
  });
});

// ─── chunkPostsBatchForDiscord — DELIVERY-COMPLETENESS primitive (codex P2,
// round 6): per-group slug identity so a caller whose send fails can name
// exactly what's missing, rather than losing that information the moment
// items are packed into opaque APIEmbed[] groups. ─────────────────────────
describe("chunkPostsBatchForDiscord", () => {
  function itemWithHookLen(slug: string, hookLen: number) {
    return {
      slug,
      day: null,
      postTime: null,
      imageUrl: `https://x.example.com/${slug}.jpg`,
      hook: "h".repeat(hookLen),
      platforms: {},
    };
  }

  it("empty items → zero groups, zero overflow (not a failure case, just nothing to send)", () => {
    const { groups, overflow } = chunkPostsBatchForDiscord({ version: 1, items: [] });
    expect(groups).toEqual([]);
    expect(overflow).toEqual([]);
  });

  it("small batch (well under caps) packs into ONE group carrying every item's slug", () => {
    const payload: PostsBatchPayload = {
      version: 1,
      items: [itemWithHookLen("a", 50), itemWithHookLen("b", 50)],
    };
    const { groups } = chunkPostsBatchForDiscord(payload);
    expect(groups).toHaveLength(1);
    expect(groups[0].slugs).toEqual(["a", "b"]);
    expect(groups[0].embeds).toHaveLength(2);
  });

  it("a batch exceeding EMBED_TOTAL_MAX (6000 chars) per group splits into multiple groups, each carrying only ITS OWN items' slugs", () => {
    // ~2040 chars/embed (2000-char hook + title/footer overhead) → 2 embeds
    // per group before a 3rd would push past 6000.
    const payload: PostsBatchPayload = {
      version: 1,
      items: [itemWithHookLen("a", 2000), itemWithHookLen("b", 2000), itemWithHookLen("c", 2000)],
    };
    const { groups } = chunkPostsBatchForDiscord(payload);
    expect(groups.length).toBeGreaterThan(1);
    // Every slug appears in EXACTLY one group — no item duplicated or dropped
    // across the split, and each group's slugs.length matches its embeds.length.
    const allSlugs = groups.flatMap((g) => g.slugs);
    expect(allSlugs.sort()).toEqual(["a", "b", "c"]);
    for (const g of groups) {
      expect(g.slugs.length).toBe(g.embeds.length);
    }
  });

  it("a batch exceeding 10 items per group splits on the embed-COUNT cap even when chars are small", () => {
    const items = Array.from({ length: 25 }, (_, i) => itemWithHookLen(`slug-${i}`, 10));
    const { groups } = chunkPostsBatchForDiscord({ version: 1, items });
    expect(groups.length).toBe(3); // 10 + 10 + 5
    expect(groups[0].slugs).toHaveLength(10);
    expect(groups[1].slugs).toHaveLength(10);
    expect(groups[2].slugs).toHaveLength(5);
    expect(groups.flatMap((g) => g.slugs)).toEqual(items.map((i) => i.slug));
  });

  it("overflow is passed through unchanged from renderPostsBatchEmbeds (platform copy > 1024 chars)", () => {
    const payload: PostsBatchPayload = {
      version: 1,
      items: [
        {
          slug: "a",
          day: null,
          postTime: null,
          imageUrl: "https://x.example.com/a.jpg",
          hook: "short hook",
          platforms: { facebook: "f".repeat(1500) },
        },
      ],
    };
    const { overflow } = chunkPostsBatchForDiscord(payload);
    expect(overflow).toHaveLength(1);
    expect(overflow[0].itemSlug).toBe("a");
    expect(overflow[0].fullText).toHaveLength(1500);
  });
});

// ─── buildPartialDeliveryWarning — the unsuppressable marker that makes
// DELIVERY-COMPLETENESS hold by construction: posted whenever missingSlugs is
// non-empty, regardless of how many other units succeeded. ────────────────
describe("buildPartialDeliveryWarning", () => {
  it("names every missing slug and links to the full batch", () => {
    const msg = buildPartialDeliveryWarning(["tokyo-trifecta", "layover"], "https://paperclip.example.com/hin/approvals/abc123");
    expect(msg).toContain("tokyo-trifecta");
    expect(msg).toContain("layover");
    expect(msg).toContain("https://paperclip.example.com/hin/approvals/abc123");
    expect(msg).toContain("failed to deliver");
    // Loud/unmissable marker — visually distinct from a normal content post.
    expect(msg).toMatch(/^⚠️/);
  });

  it("singular vs plural count phrasing", () => {
    const one = buildPartialDeliveryWarning(["a"], "https://x.example.com/y");
    expect(one).toContain("1 post group failed");
    const many = buildPartialDeliveryWarning(["a", "b", "c"], "https://x.example.com/y");
    expect(many).toContain("3 post groups failed");
  });

  it("never throws and stays within the message budget even for a pathologically long missing-slug list", () => {
    const manySlugs = Array.from({ length: 500 }, (_, i) => `very-long-slug-name-number-${i}`);
    const msg = buildPartialDeliveryWarning(manySlugs, "https://x.example.com/y");
    expect(msg.length).toBeLessThanOrEqual(1900);
    expect(msg).toContain("failed to deliver");
    // The link must survive truncation of the slug list (link is appended
    // after the (possibly truncated) list, on its own line).
    expect(msg).toContain("https://x.example.com/y");
  });
});
