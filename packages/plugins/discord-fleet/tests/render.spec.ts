import { describe, it, expect } from "vitest";
import { truncate } from "../src/render/plain.js";
import { enforceEmbedLimits, buildApprovalActionRow, APPROVAL_BUTTON_PREFIX } from "../src/render/embeds.js";
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
});

describe("buildApprovalActionRow", () => {
  const ROW = buildApprovalActionRow({
    approvalId: "appr-test-123",
    issueUrl: "https://paperclip.example.com/issues/appr-test-123",
  });

  it("returns exactly 3 components", () => {
    expect(ROW.components).toHaveLength(3);
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

  it("third component is View button with style=Link and url set", () => {
    const btn = ROW.components[2] as any;
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

  it("Link button has no custom_id (Discord Link buttons must not have custom_id)", () => {
    const btn = ROW.components[2] as any;
    expect(btn.custom_id).toBeUndefined();
  });
});
