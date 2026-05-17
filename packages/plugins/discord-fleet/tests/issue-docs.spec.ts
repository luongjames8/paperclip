import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIEmbed } from "discord.js";
import { renderIssueDocs, chunkEmbedsForDiscord, renderPostsDoc, renderSlidesDoc, type IssueDocsBundle } from "../src/render/issue-docs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const postsFixture = fs.readFileSync(path.join(__dirname, "fixtures/posts-doc.json"), "utf8");

describe("renderPostsDoc", () => {
  it("returns one embed per post (+ optional GBP embed)", () => {
    const out = renderPostsDoc(postsFixture, "abcd1234");
    const parsed = JSON.parse(postsFixture);
    const expectedN = parsed.posts.length + (parsed.gbp ? 1 : 0);
    expect(out.length).toBe(expectedN);
  });

  it("first post embed has expected title/image/footer/url shape", () => {
    const out = renderPostsDoc(postsFixture, "abcd1234");
    const first = out[0];
    const parsed = JSON.parse(postsFixture);
    const post0 = parsed.posts[0];
    expect(first.title).toContain(post0.slug);
    if (post0.mainImage) {
      expect(first.image?.url).toBe(post0.mainImage);
    }
    expect(first.footer?.text).toMatch(/\[preview:abcd1234\]$/);
    expect(first.footer?.text).toMatch(/^1\//);
    if (post0.url) {
      expect(first.url).toBe(post0.url);
    }
  });

  it("omits image key when post has no mainImage", () => {
    const body = JSON.stringify({
      weekOf: "2026-05-11",
      posts: [{ slot: { day: "Mon", publicationDate: "2026-05-11T00:00:00Z", timezone: "Asia/Taipei" }, slug: "no-image", url: "https://x", platforms: {} }],
    });
    const out = renderPostsDoc(body, "abcd1234");
    expect(out[0].image).toBeUndefined();
  });

  it("clamps description to 4096 chars", () => {
    const long = "x".repeat(5000);
    const body = JSON.stringify({
      posts: [{ slot: {}, slug: "s", platforms: { threads: { main: long } } }],
    });
    const out = renderPostsDoc(body, "abcd1234");
    expect(out[0].description!.length).toBeLessThanOrEqual(4096);
  });

  it("returns [] on malformed JSON body — no throw", () => {
    expect(renderPostsDoc("not json", "abcd1234")).toEqual([]);
    expect(renderPostsDoc('{"posts":', "abcd1234")).toEqual([]);
  });

  it("returns [] when body parses but has no posts array", () => {
    expect(renderPostsDoc('{"weekOf":"x"}', "abcd1234")).toEqual([]);
  });

  it("returns [] for empty posts array (different from absent)", () => {
    expect(renderPostsDoc('{"posts":[]}', "abcd1234")).toEqual([]);
  });

  it("handles bare triple-backtick fence (no json language tag)", () => {
    const inner = JSON.stringify({ posts: [{ slot: {}, slug: "bare-fence", platforms: { threads: { main: "hi" } } }] });
    const fenced = "```\n" + inner + "\n```";
    const out = renderPostsDoc(fenced, "abcd1234");
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("bare-fence");
  });

  it("does not crash when post.slot is a non-object (defensive guard)", () => {
    const body = JSON.stringify({ posts: [{ slot: "not-an-object", slug: "weird", platforms: {} }] });
    const out = renderPostsDoc(body, "abcd1234");
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("weird");
  });

  it("handles markdown-fenced JSON bodies (```json ... ```)", () => {
    const inner = JSON.stringify({ posts: [{ slot: {}, slug: "fenced", platforms: { threads: { main: "hi" } } }] });
    const fenced = "```json\n" + inner + "\n```";
    const out = renderPostsDoc(fenced, "abcd1234");
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("fenced");
  });

  it("recovers from raw control chars inside string literals (lenient parser)", () => {
    // Production paperclip writer agents sometimes emit JSON with literal \n inside
    // string values. JS strict JSON.parse rejects; lenient fallback must handle it.
    // Synthesize a body with a real newline inside a string value:
    const body =
      '{\n  "posts": [{\n    "slot": {},\n    "slug": "raw-cc",\n    "platforms": {\n      "threads": {\n        "main": "line one\nline two\nline three"\n      }\n    }\n  }]\n}';
    expect(() => JSON.parse(body)).toThrow();  // confirm strict parser rejects
    const out = renderPostsDoc(body, "abcd1234");
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("raw-cc");
    expect(out[0].description).toContain("line one");
    expect(out[0].description).toContain("line three");
  });

  it("emits a GBP embed at the end when gbp is present", () => {
    const body = JSON.stringify({
      posts: [{ slot: {}, slug: "p1", platforms: {} }],
      gbp: { variant: "morning", text: "GBP body text", url: "https://gbp", mainImage: "https://gbp.png", timezone: "Asia/Taipei" },
    });
    const out = renderPostsDoc(body, "abcd1234");
    expect(out).toHaveLength(2);
    expect(out[1].title).toContain("GBP");
    expect(out[1].image?.url).toBe("https://gbp.png");
    expect(out[1].url).toBe("https://gbp");
  });

  it("strips secrets from post description, title, and gbp text", () => {
    // Synthetic tokens matching the patterns in render/secrets.ts
    const fakePcpKey = "pcp_" + "A".repeat(25);
    const fakeGithubPat = "ghp_" + "B".repeat(36);
    const fakeAwsKey = "AKIA" + "C".repeat(16);
    const body = JSON.stringify({
      posts: [{
        slot: { day: "Mon" },
        slug: "leaked-" + fakePcpKey,
        platforms: {
          threads: {
            main: "Threads body with leaked " + fakeGithubPat + " token",
            descendants: ["descendant containing " + fakeAwsKey],
          },
        },
      }],
      gbp: { variant: "morning", text: "GBP body with leaked " + fakePcpKey },
    });
    const out = renderPostsDoc(body, "abcd1234");
    expect(out).toHaveLength(2);
    // Post embed
    expect(out[0].title).not.toContain(fakePcpKey);
    expect(out[0].title).toContain("PAPERCLIP_KEY_***");
    expect(out[0].description).not.toContain(fakeGithubPat);
    expect(out[0].description).toContain("GITHUB_PAT_***");
    expect(out[0].description).not.toContain(fakeAwsKey);
    expect(out[0].description).toContain("AWS_ACCESS_KEY_***");
    // GBP embed
    expect(out[1].description).not.toContain(fakePcpKey);
    expect(out[1].description).toContain("PAPERCLIP_KEY_***");
  });
});

const slidesFixture = fs.readFileSync(path.join(__dirname, "fixtures/slides-doc.json"), "utf8");

describe("renderSlidesDoc", () => {
  it("returns one embed per slide with image.url set", () => {
    const out = renderSlidesDoc(slidesFixture, "abcd1234");
    const parsed = JSON.parse(slidesFixture);
    expect(out.length).toBe(parsed.slides.length);
    expect(out[0].image?.url).toBe(parsed.slides[0].url);
    expect(out[0].url).toBe(parsed.slides[0].url);
  });

  it("title contains 'Slide N/total' shape", () => {
    const out = renderSlidesDoc(slidesFixture, "abcd1234");
    const total = JSON.parse(slidesFixture).slides.length;
    expect(out[0].title).toMatch(new RegExp(`^Slide 1/${total}`));
  });

  it("footer ends with [preview:<short>]", () => {
    const out = renderSlidesDoc(slidesFixture, "abcd1234");
    expect(out[0].footer?.text).toMatch(/\[preview:abcd1234\]$/);
  });

  it("footer omits empty theme cleanly (no '· ·' from absent field)", () => {
    // The real fixture has no 'theme' field. Footer should not contain '· ·' or a double-separator
    const out = renderSlidesDoc(slidesFixture, "abcd1234");
    const txt = out[0].footer!.text;
    expect(txt).not.toMatch(/· ·/);
    expect(txt).not.toMatch(/·\s*·/);  // no double separator from empty theme slot
  });

  it("returns [] for empty slides array", () => {
    expect(renderSlidesDoc('{"slug":"x","slides":[]}', "abcd1234")).toEqual([]);
  });

  it("returns [] on malformed JSON body", () => {
    expect(renderSlidesDoc("not json", "abcd1234")).toEqual([]);
  });

  it("handles markdown-fenced JSON bodies", () => {
    const inner = JSON.stringify({ slug: "fenced-carousel", slides: [{ url: "https://example.com/s1.png" }] });
    const fenced = "```json\n" + inner + "\n```";
    const out = renderSlidesDoc(fenced, "abcd1234");
    expect(out).toHaveLength(1);
    expect(out[0].image?.url).toBe("https://example.com/s1.png");
  });

  it("omits image/url when slide has no url field", () => {
    const body = JSON.stringify({ slug: "no-url", slides: [{ index: 0 }] });
    const out = renderSlidesDoc(body, "abcd1234");
    expect(out).toHaveLength(1);
    expect(out[0].image).toBeUndefined();
    expect(out[0].url).toBeUndefined();
  });

  it("skips non-object slide entries (defensive)", () => {
    const body = JSON.stringify({ slug: "mixed", slides: [null, "string", { url: "https://ok.png" }] });
    const out = renderSlidesDoc(body, "abcd1234");
    expect(out).toHaveLength(1);
    expect(out[0].image?.url).toBe("https://ok.png");
  });

  it("strips secrets from slide titles + slug/theme footer", () => {
    const fakePcpKey = "pcp_" + "Z".repeat(25);
    const body = JSON.stringify({
      slug: "leak-" + fakePcpKey,
      theme: "theme-with-leak-" + fakePcpKey,
      slides: [{ url: "https://example.com/s1.png", slide: "slide-label-" + fakePcpKey }],
    });
    const out = renderSlidesDoc(body, "abcd1234");
    expect(out).toHaveLength(1);
    expect(out[0].title).not.toContain(fakePcpKey);
    expect(out[0].title).toContain("PAPERCLIP_KEY_***");
    expect(out[0].footer?.text).not.toContain(fakePcpKey);
    expect(out[0].footer?.text).toContain("PAPERCLIP_KEY_***");
  });
});
