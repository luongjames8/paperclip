/**
 * Layer: contract
 * Assertion type: semantic invariant — URL emitted in approval embed must match
 *   the board's canonical React Router route: /:companyPrefix/approvals/:approvalId
 * Call site pinned: packages/plugins/discord-fleet/src/handlers/approval-created.ts:65
 * Mutation result: revert line 65 to `${paperclipApiUrl}/approvals/${approvalId}`
 *   (omitting the companyPrefix segment) → ALL tests in this file go RED
 *
 * Board route source of truth: paperclip/ui/src/App.tsx
 *   <Route path=":companyPrefix" element={<Layout />}>
 *     <Route path="approvals/:approvalId" element={<ApprovalDetail />} />
 *   </Route>
 *
 * Regression anchor: /approvals/:id with no prefix treats "approvals" as a company
 * prefix, Layout finds no company named "APPROVALS", renders "Company not found".
 * Verified live 2026-04-28 at http://100.98.95.12:3100.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import type { Client } from "discord.js";

vi.mock("../src/discord/rest.js", () => ({
  postToThread: vi.fn().mockResolvedValue("msg-id-1"),
  postToChannel: vi.fn().mockResolvedValue("msg-id-2"),
  postEmbedToThread: vi.fn().mockResolvedValue("msg-id-3"),
  postEmbedToChannel: vi.fn().mockResolvedValue("msg-id-4"),
}));

vi.mock("../src/render/embeds.js", () => ({
  buildApprovalEmbed: vi.fn().mockReturnValue({ title: "approval embed" }),
  buildSeedIssueEmbed: vi.fn().mockReturnValue({ title: "seed embed" }),
  buildBlockedEmbed: vi.fn().mockReturnValue({ title: "blocked embed" }),
}));

// Canonical pattern derived from App.tsx board route tree
const CANONICAL_APPROVAL_URL_RE =
  /^https?:\/\/[^/]+\/(?<prefix>[A-Z]+)\/approvals\/(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// builder must add companyPrefix (or issuePrefix) to CompanyConfig schema
type CompanyConfigWithPrefix = DiscordFleetConfig["companies"][0] & {
  companyPrefix: string;
};

function makeConfigForCompany(
  companyId: string,
  companyPrefix: string,
): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId,
        guildId: "g1",
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "ref",
        paperclipApiUrl: "http://100.98.95.12:3100",
        companyPrefix, // builder adds this field to CompanyConfig schema
      } as CompanyConfigWithPrefix,
    ],
  } as unknown as DiscordFleetConfig;
}

function makeApprovalEvent(
  companyId: string,
  approvalId: string,
): PluginEvent {
  return {
    eventId: "evt-contract-test",
    eventType: "approval.created",
    occurredAt: new Date().toISOString(),
    companyId,
    entityId: approvalId,
    entityType: "approval",
    payload: {
      approvalId,
      approvalType: "content_batch",
      issueId: "iss-test",
      identifier: "TEST-1",
    },
  };
}

describe("approval URL — board canonical route contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── CONTRACT: URL matches /:companyPrefix/approvals/:id ──────────────────

  it("URL passed to buildApprovalEmbed matches canonical route /:companyPrefix/approvals/:approvalId for HIN", async () => {
    /**
     * Layer: contract
     * Assertion type: semantic invariant
     * Call site pinned: approval-created.ts:65
     * Mutation result: revert companyPrefix from URL → test RED (URL is /approvals/:id, no prefix)
     */
    const { handleApprovalCreated } = await import(
      "../src/handlers/approval-created.js"
    );
    const { buildApprovalEmbed } = await import("../src/render/embeds.js");

    const harness = createTestHarness({ manifest });
    const APPROVAL_ID = "78893f51-cc1f-4671-8c7e-cd50db6ffae6";
    const COMPANY_ID = "a572ed46-aed4-4a71-b624-774b7faddb84";

    await handleApprovalCreated(
      harness.ctx,
      makeApprovalEvent(COMPANY_ID, APPROVAL_ID),
      {} as Client,
      makeConfigForCompany(COMPANY_ID, "HIN"),
    );

    const calls = (buildApprovalEmbed as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const { issueUrl } = calls[0][0] as { issueUrl: string };

    expect(
      CANONICAL_APPROVAL_URL_RE.test(issueUrl),
      `issueUrl "${issueUrl}" must match /:companyPrefix/approvals/:uuid — missing prefix segment causes "Company not found" on board`,
    ).toBe(true);

    const m = CANONICAL_APPROVAL_URL_RE.exec(issueUrl)!;
    expect(m.groups!.prefix).toBe("HIN");
    expect(m.groups!.id).toBe(APPROVAL_ID);
  });

  // ── INVARIANT: all 3 live companies produce well-formed prefixed URLs ─────

  it.each([
    {
      companyId: "a572ed46-aed4-4a71-b624-774b7faddb84",
      prefix: "HIN",
      label: "Hinomaru",
    },
    {
      companyId: "07589fac-ef50-41ba-afd6-afa1d014260b",
      prefix: "SAF",
      label: "SafeGate",
    },
    {
      companyId: "5198a4b7-976a-4f4c-93a4-8310683cc08d",
      prefix: "THE",
      label: "Thetis",
    },
  ])(
    "[$label] approval URL includes $prefix prefix — invariant holds for all 3 companies",
    async ({ companyId, prefix }) => {
      /**
       * Layer: invariant
       * Assertion type: semantic invariant (URL builder must embed issuePrefix for every company)
       * Call site pinned: approval-created.ts:65
       * Mutation result: remove prefix from URL builder → all 3 rows RED
       */
      const { handleApprovalCreated } = await import(
        "../src/handlers/approval-created.js"
      );
      const { buildApprovalEmbed } = await import("../src/render/embeds.js");

      const harness = createTestHarness({ manifest });
      const APPROVAL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

      await handleApprovalCreated(
        harness.ctx,
        makeApprovalEvent(companyId, APPROVAL_ID),
        {} as Client,
        makeConfigForCompany(companyId, prefix),
      );

      const calls = (buildApprovalEmbed as ReturnType<typeof vi.fn>).mock
        .calls;
      expect(calls).toHaveLength(1);
      const { issueUrl } = calls[0][0] as { issueUrl: string };

      expect(
        CANONICAL_APPROVAL_URL_RE.test(issueUrl),
        `[${prefix}] issueUrl "${issueUrl}" must embed company prefix — "Company not found" otherwise`,
      ).toBe(true);

      const m = CANONICAL_APPROVAL_URL_RE.exec(issueUrl)!;
      expect(m.groups!.prefix).toBe(prefix);
      expect(m.groups!.id).toBe(APPROVAL_ID);
    },
  );

  // ── REGRESSION GUARD: /approvals/:id without prefix must NOT be accepted ─

  it("URL does NOT match /approvals/:id pattern (no prefix) — guards against regression to broken form", async () => {
    /**
     * Layer: contract
     * Assertion type: mutation-pin — this test catches exact regression to the
     *   pre-fix URL: `${paperclipApiUrl}/approvals/${approvalId}` (no prefix)
     * Call site pinned: approval-created.ts:65
     * Mutation result: revert prefix → this test PASSES (double-negative: broken URL is rejected)
     *   but the above canonical-match tests go RED, catching the regression
     */
    const { handleApprovalCreated } = await import(
      "../src/handlers/approval-created.js"
    );
    const { buildApprovalEmbed } = await import("../src/render/embeds.js");

    const harness = createTestHarness({ manifest });
    const APPROVAL_ID = "78893f51-cc1f-4671-8c7e-cd50db6ffae6";
    const COMPANY_ID = "a572ed46-aed4-4a71-b624-774b7faddb84";

    await handleApprovalCreated(
      harness.ctx,
      makeApprovalEvent(COMPANY_ID, APPROVAL_ID),
      {} as Client,
      makeConfigForCompany(COMPANY_ID, "HIN"),
    );

    const calls = (buildApprovalEmbed as ReturnType<typeof vi.fn>).mock.calls;
    const { issueUrl } = calls[0][0] as { issueUrl: string };

    // The pre-fix broken pattern: base_url/approvals/:id (no prefix between host and /approvals)
    const BROKEN_PATTERN =
      /^https?:\/\/[^/]+\/approvals\/[0-9a-f]{8}-[0-9a-f]{4}/;
    expect(
      BROKEN_PATTERN.test(issueUrl),
      `issueUrl "${issueUrl}" must NOT match broken /approvals/:id pattern (no company prefix)`,
    ).toBe(false);
  });
});
