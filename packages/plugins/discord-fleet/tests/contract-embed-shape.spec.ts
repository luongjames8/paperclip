/**
 * Layer: unit + contract
 * Assertion type: semantic invariant — buildApprovalEmbed must set embed.url so the
 *   Discord embed TITLE is a clickable hyperlink. Discord's embed.url makes the title
 *   clickable; description-only links require operators to read the description body.
 * Call site pinned: src/render/embeds.ts:69 (enforceEmbedLimits call inside buildApprovalEmbed)
 * Mutation result: remove url: field from buildApprovalEmbed return → test RED
 *
 * AC coverage: P1-2 (embed.url must be set)
 *
 * This file intentionally does NOT vi.mock('../src/render/embeds.js') — we test the
 * real function to catch changes that would silently drop issueUrl from the embed object.
 */

import { describe, it, expect } from "vitest";
import { buildApprovalEmbed } from "../src/render/embeds.js";

const TEST_ISSUE_URL = "http://100.98.95.12:3100/HIN/approvals/78893f51-cc1f-4671-8c7e-cd50db6ffae6";

describe("buildApprovalEmbed — embed.url must be set (P1-2 / AC7)", () => {
  it("returned embed has url property set to the issueUrl argument", () => {
    /**
     * Layer: unit
     * Assertion type: semantic invariant — Discord only makes the title a hyperlink when embed.url is set
     * Call site pinned: src/render/embeds.ts:69 (enforceEmbedLimits call)
     * Mutation result: remove url: issueUrl from the embed object → test RED
     */
    const embed = buildApprovalEmbed({
      identifier: "HIN-1",
      approvalId: "78893f51-cc1f-4671-8c7e-cd50db6ffae6",
      approvalType: "content_batch",
      title: "Review this",
      issueUrl: TEST_ISSUE_URL,
    });

    expect(
      embed.url,
      `embed.url must be set — without it the Discord embed title is not a hyperlink. Got: ${JSON.stringify(embed.url)}`,
    ).toBe(TEST_ISSUE_URL);
  });

  it("embed.url survives enforceEmbedLimits passthrough (is not stripped by the limit enforcer)", () => {
    /**
     * Layer: unit
     * Assertion type: semantic invariant — enforceEmbedLimits must preserve url field
     * Call site pinned: src/render/embeds.ts:13 (enforceEmbedLimits — spreads embed properties)
     * Mutation result: enforceEmbedLimits strips url → test RED
     */
    const embed = buildApprovalEmbed({
      identifier: "SAF-2",
      approvalId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      approvalType: "budget",
      issueUrl: "http://100.98.95.12:3100/SAF/approvals/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });

    expect(embed.url).toBeDefined();
    expect(embed.url).toContain("/SAF/approvals/");
  });

  it("embed.url matches the exact issueUrl passed in — no transformation", () => {
    /**
     * Layer: unit
     * Assertion type: semantic invariant — url must be passed through verbatim
     * Call site pinned: src/render/embeds.ts:69
     * Mutation result: url field set to wrong value → test RED
     */
    const issueUrl =
      "http://100.98.95.12:3100/THE/approvals/5198a4b7-976a-4f4c-93a4-8310683cc08d";
    const embed = buildApprovalEmbed({
      identifier: "THE-3",
      approvalId: "5198a4b7-976a-4f4c-93a4-8310683cc08d",
      approvalType: "content_batch",
      issueUrl,
    });

    expect(embed.url).toBe(issueUrl);
  });
});
