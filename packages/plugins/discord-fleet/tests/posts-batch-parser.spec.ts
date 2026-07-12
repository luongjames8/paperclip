import { describe, it, expect } from "vitest";
import { parsePostsBatchPayload, renderPostsBatchEmbeds, type PostsBatchPayload } from "../src/render/posts-batch.js";

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
    const embeds = renderPostsBatchEmbeds(payload);

    expect(embeds).toHaveLength(2);
    expect(embeds[0].image?.url).toBe(payload.items[0].imageUrl);
    expect(embeds[1].image?.url).toBe(payload.items[1].imageUrl);
  });

  it("title includes day/postTime/slug when present", () => {
    const payload = validPayload();
    const embeds = renderPostsBatchEmbeds(payload);
    expect(embeds[0].title).toContain("Mon");
    expect(embeds[0].title).toContain("tokyo-trifecta");
  });

  it("title falls back to 'Post N/total' when day/postTime/slug are all absent", () => {
    const payload = validPayload({ items: [{ slug: "", day: null, postTime: null, imageUrl: "https://x.example.com/a.jpg", hook: "h", platforms: {} }] });
    const embeds = renderPostsBatchEmbeds(payload);
    expect(embeds[0].title).toBe("Post 1/1");
  });

  it("description is the hook text", () => {
    const payload = validPayload();
    const embeds = renderPostsBatchEmbeds(payload);
    expect(embeds[0].description).toBe(payload.items[0].hook);
  });

  it("each present platform becomes its own field; absent platforms produce no field", () => {
    const payload = validPayload();
    const embeds = renderPostsBatchEmbeds(payload);

    const fieldNames0 = embeds[0].fields?.map((f) => f.name) ?? [];
    expect(fieldNames0).toEqual(["Threads", "X", "Facebook"]);

    const fieldNames1 = embeds[1].fields?.map((f) => f.name) ?? [];
    expect(fieldNames1).toEqual(["GBP"]);
  });

  it("footer includes position and weekOf", () => {
    const payload = validPayload();
    const embeds = renderPostsBatchEmbeds(payload);
    expect(embeds[0].footer?.text).toContain("1/2");
    expect(embeds[0].footer?.text).toContain("2026-07-13");
  });

  it("0 items → 0 embeds", () => {
    const embeds = renderPostsBatchEmbeds(validPayload({ items: [] }));
    expect(embeds).toEqual([]);
  });
});
