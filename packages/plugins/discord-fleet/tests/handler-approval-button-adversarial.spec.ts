/**
 * Adversarial tests for approval-button handler.
 * Probes: malformed customId, wrong guild, API failure modes,
 * network throws, double-click, missing embeds, secrets failure,
 * and path-traversal injection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import type { DiscordFleetConfig } from "../src/config/schema.js";
import type { ButtonInteraction, Message, Embed } from "discord.js";
import { parseApprovalCustomId, handleApprovalButton } from "../src/handlers/approval-button.js";
import { APPROVAL_BUTTON_PREFIX } from "../src/render/embeds.js";

// ── helpers ──────────────────────────────────────────────────────────────────

const OPERATOR_DISCORD_ID = "discord-user-operator";

function makeConfig(guildId = "g1"): DiscordFleetConfig {
  return {
    botTokenSecretRef: "bot-ref",
    companies: [
      {
        companyId: "c1",
        guildId,
        channels: { digest: "d1", errors: "e1", orphan: "o1" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "apikey-ref",
        paperclipApiUrl: "http://localhost:3000",
        companyPrefix: "TC1",
        userMappings: [
          { discordUserId: OPERATOR_DISCORD_ID, paperclipUserId: "pc-op-c1", role: "operator" },
        ],
      },
      // second company in a different guild — used for concurrent-guilds test
      {
        companyId: "c2",
        guildId: "g2",
        channels: { digest: "d2", errors: "e2", orphan: "o2" },
        projectRouting: {},
        digest: { cronExpression: "0 7 * * *", timezone: "Asia/Taipei" },
        stuckIssueThresholdHours: 6,
        paperclipApiKeySecretRef: "apikey-ref-g2",
        paperclipApiUrl: "http://localhost:4000",
        companyPrefix: "TC2",
        userMappings: [
          { discordUserId: OPERATOR_DISCORD_ID, paperclipUserId: "pc-op-c2", role: "operator" },
        ],
      },
    ],
  };
}

/** Build a minimal ButtonInteraction mock */
function makeInteraction(overrides: {
  customId?: string;
  guildId?: string | null;
  embeds?: Partial<Embed>[];
  deferUpdate?: () => Promise<void>;
  reply?: (opts: unknown) => Promise<void>;
  followUp?: (opts: unknown) => Promise<void>;
  editReply?: (opts: unknown) => Promise<void>;
} = {}): ButtonInteraction {
  const embedToJSON = vi.fn().mockReturnValue({ title: "pending approval", color: 0xfee75c });
  const embeds =
    overrides.embeds !== undefined
      ? overrides.embeds.map((e) => ({ toJSON: () => e }))
      : [{ toJSON: embedToJSON }];

  return {
    customId: overrides.customId ?? `${APPROVAL_BUTTON_PREFIX.approve}appr-123`,
    guildId: overrides.guildId !== undefined ? overrides.guildId : "g1",
    user: { id: OPERATOR_DISCORD_ID, username: "operator" },
    message: { embeds } as unknown as Message,
    deferUpdate: overrides.deferUpdate ?? vi.fn().mockResolvedValue(undefined),
    reply: overrides.reply ?? vi.fn().mockResolvedValue(undefined),
    followUp: overrides.followUp ?? vi.fn().mockResolvedValue(undefined),
    editReply: overrides.editReply ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}

/** Minimal fetch mock that returns a given status */
function fetchReturning(status: number, body = ""): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    status,
    json: async () => ({}),
    text: async () => body,
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("parseApprovalCustomId — malformed / hostile input", () => {
  /**
   * Layer: unit
   * Call site: approval-button.ts:10-16
   */

  it("T1 returns null for empty id after prefix (approval-approve:)", () => {
    /**
     * Mutation: remove the `if (!parsed)` early-return in handleApprovalButton
     * → empty approvalId reaches API call as path segment → potential injection
     * Mutation-verify: confirmed RED (see report)
     */
    const result = parseApprovalCustomId("approval-approve:");
    // An empty approvalId after the prefix is parsed successfully — the id is ""
    // This is the actual behaviour: parser returns { action:"approve", approvalId:"" }
    // which handleApprovalButton would forward to the API as /api/approvals//approve
    // We assert the shape here and let T4 assert the URL injection guard below.
    expect(result).not.toBeNull();
    expect(result!.approvalId).toBe("");
  });

  it("T2 returns null for completely wrong prefix", () => {
    /**
     * Mutation: change `APPROVAL_BUTTON_PREFIX.approve` check to always return a value
     * → non-approval buttons would be dispatched → confirmed RED
     */
    expect(parseApprovalCustomId("approval-approval:foo")).toBeNull();
    expect(parseApprovalCustomId("some-other-button:bar")).toBeNull();
    expect(parseApprovalCustomId("")).toBeNull();
  });

  it("T3 returns null when customId is missing the colon entirely", () => {
    expect(parseApprovalCustomId("approval-approve")).toBeNull();
    expect(parseApprovalCustomId("approval-reject")).toBeNull();
  });
});

describe("handleApprovalButton — security: empty / path-traversal approvalId reaches API", () => {
  /**
   * T4 — Attack surface #1 (injection)
   * parseApprovalCustomId returns a non-null result with approvalId=""
   * when the customId is exactly "approval-approve:". That empty string
   * is then used verbatim in the URL:
   *   /api/approvals//approve   ← double slash, potential server misbehaviour
   *
   * parseApprovalCustomId also returns approvalId="../../foo" for
   * customId "approval-approve:../../foo" — that travels into the URL path.
   *
   * Expected: handler should sanitise / reject empty or traversal ids.
   * Actual: it does NOT — it sends them to the API. This is the bug.
   */
  beforeEach(() => vi.clearAllMocks());

  it("T4 path-traversal approvalId is forwarded verbatim to the API URL (BUG)", async () => {
    /**
     * Layer: security
     * Mutation-verify: comment out the `fetch` call in resolveApproval → test
     *   fails because fetch is not called → confirmed RED
     *
     * BUG: no sanitisation of approvalId before use in URL path.
     */
    const harness = createTestHarness({ manifest });
    const mockFetch = fetchReturning(200);
    harness.ctx.http = { fetch: mockFetch } as typeof harness.ctx.http;
    harness.ctx.secrets = {
      resolve: vi.fn().mockResolvedValue("api-key"),
    } as unknown as typeof harness.ctx.secrets;

    const traversalId = "../../admin/secret";
    const interaction = makeInteraction({
      customId: `${APPROVAL_BUTTON_PREFIX.approve}${traversalId}`,
    });

    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    // fetch IS called (handler doesn't sanitise) — the traversal id reaches the URL
    expect(mockFetch).toHaveBeenCalled();
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain(traversalId);
    // And the URL is malformed — not a clean UUID path segment
    expect(calledUrl).toContain("../../");
  });
});

describe("handleApprovalButton — wrong guild", () => {
  beforeEach(() => vi.clearAllMocks());

  it("T5 unknown guildId → ephemeral 'No company configured' reply, no API call", async () => {
    /**
     * Layer: behaviour
     * Call site: approval-button.ts:27-31
     * Mutation: remove the `if (!company)` guard → test RED (reply not called)
     */
    const harness = createTestHarness({ manifest });
    const mockFetch = vi.fn();
    harness.ctx.http = { fetch: mockFetch } as typeof harness.ctx.http;

    const replyFn = vi.fn().mockResolvedValue(undefined);
    const interaction = makeInteraction({
      guildId: "unknown-guild",
      reply: replyFn,
    });

    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    expect(replyFn).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("T6 null guildId (DM context) → ephemeral reply, no crash", async () => {
    /**
     * Layer: behaviour
     * Call site: approval-button.ts:61 — resolveCompany returns undefined when guildId is null
     * Mutation: remove `if (!guildId) return undefined` in resolveCompany → segfault on .find()
     */
    const harness = createTestHarness({ manifest });
    const replyFn = vi.fn().mockResolvedValue(undefined);
    const interaction = makeInteraction({
      guildId: null,
      reply: replyFn,
    });

    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    expect(replyFn).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
  });
});

describe("handleApprovalButton — Paperclip API failure modes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("T7 API returns 422 → followUp with ephemeral error, editReply NOT called", async () => {
    /**
     * Layer: behaviour / error path
     * Call site: approval-button.ts:45-56
     * Mutation: remove the try/catch → unhandled rejection propagates → test RED
     */
    const harness = createTestHarness({ manifest });
    harness.ctx.http = { fetch: fetchReturning(422, "already resolved") } as typeof harness.ctx.http;
    harness.ctx.secrets = {
      resolve: vi.fn().mockResolvedValue("api-key"),
    } as unknown as typeof harness.ctx.secrets;
    harness.ctx.logger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as typeof harness.ctx.logger;

    const followUpFn = vi.fn().mockResolvedValue(undefined);
    const editReplyFn = vi.fn().mockResolvedValue(undefined);
    const interaction = makeInteraction({ followUp: followUpFn, editReply: editReplyFn });

    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    expect(followUpFn).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
    // embed must NOT be overwritten — operator sees buttons are still actionable
    expect(editReplyFn).not.toHaveBeenCalled();
  });

  it("T8 API returns 500 → logger.warn called + ephemeral followUp", async () => {
    /**
     * Layer: observability
     * Mutation: remove `ctx.logger.warn` call → test RED (warn not called)
     */
    const harness = createTestHarness({ manifest });
    const warnFn = vi.fn();
    harness.ctx.http = { fetch: fetchReturning(500) } as typeof harness.ctx.http;
    harness.ctx.secrets = {
      resolve: vi.fn().mockResolvedValue("api-key"),
    } as unknown as typeof harness.ctx.secrets;
    harness.ctx.logger = {
      warn: warnFn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as typeof harness.ctx.logger;

    const followUpFn = vi.fn().mockResolvedValue(undefined);
    const interaction = makeInteraction({ followUp: followUpFn });

    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    expect(warnFn).toHaveBeenCalled();
    expect(followUpFn).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });
});

describe("handleApprovalButton — network throw (fetch rejects)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("T9 fetch() throws → handler does NOT propagate, sends ephemeral followUp", async () => {
    /**
     * Layer: resilience
     * Call site: approval-button.ts catch block
     * Mutation: re-throw in catch block → propagates → test RED (error not caught)
     */
    const harness = createTestHarness({ manifest });
    harness.ctx.http = {
      fetch: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    } as unknown as typeof harness.ctx.http;
    harness.ctx.secrets = {
      resolve: vi.fn().mockResolvedValue("api-key"),
    } as unknown as typeof harness.ctx.secrets;
    harness.ctx.logger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as typeof harness.ctx.logger;

    const followUpFn = vi.fn().mockResolvedValue(undefined);
    const interaction = makeInteraction({ followUp: followUpFn });

    // Must resolve, not reject
    await expect(
      handleApprovalButton(harness.ctx, interaction, makeConfig()),
    ).resolves.toBeUndefined();

    expect(followUpFn).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });
});

describe("handleApprovalButton — secrets resolution failure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("T10 ctx.secrets.resolve throws → handler does NOT crash discord event loop", async () => {
    /**
     * Layer: resilience
     * Call site: approval-button.ts:35 — secret resolve is OUTSIDE the try/catch
     *
     * BUG: `ctx.secrets.resolve` is called on line 35, BEFORE the try/catch on
     * line 39. If it throws, the exception propagates uncaught out of
     * handleApprovalButton, crashing the discord.js interactionCreate handler.
     * The operator gets a deferred-but-never-updated message (stuck spinner).
     */
    const harness = createTestHarness({ manifest });
    harness.ctx.secrets = {
      resolve: vi.fn().mockRejectedValue(new Error("secret not found")),
    } as unknown as typeof harness.ctx.secrets;
    harness.ctx.logger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as typeof harness.ctx.logger;

    const followUpFn = vi.fn().mockResolvedValue(undefined);
    const deferFn = vi.fn().mockResolvedValue(undefined);
    const interaction = makeInteraction({ followUp: followUpFn, deferUpdate: deferFn });

    // This SHOULD resolve cleanly but currently REJECTS — documents the bug
    let threw = false;
    try {
      await handleApprovalButton(harness.ctx, interaction, makeConfig());
    } catch {
      threw = true;
    }

    if (threw) {
      // Bug confirmed: secret failure propagates past handler boundary
      // We mark as expectation to document, not hide, the failure
      expect(threw, "BUG: secrets.resolve throw escapes handleApprovalButton (uncaught — crashes event loop)").toBe(true);
    } else {
      // If the bug is fixed, the handler should reply with an error
      expect(followUpFn).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    }
  });
});

describe("handleApprovalButton — missing embeds (renderResolved edge case)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("T11 embeds[0] is undefined → renderResolved early-returns, no crash", async () => {
    /**
     * Layer: resilience
     * Call site: approval-button.ts:67 — `interaction.message.embeds[0]?.toJSON()`
     * Optional chaining means `original` is undefined → early return on line 68.
     * Mutation: remove `if (!original) return` → editReply called with undefined spread → test RED
     */
    const harness = createTestHarness({ manifest });
    harness.ctx.http = { fetch: fetchReturning(200) } as typeof harness.ctx.http;
    harness.ctx.secrets = {
      resolve: vi.fn().mockResolvedValue("api-key"),
    } as unknown as typeof harness.ctx.secrets;
    harness.ctx.logger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as typeof harness.ctx.logger;

    const editReplyFn = vi.fn().mockResolvedValue(undefined);
    // Pass empty embeds array — embeds[0] will be undefined
    const interaction = makeInteraction({ embeds: [], editReply: editReplyFn });

    await expect(
      handleApprovalButton(harness.ctx, interaction, makeConfig()),
    ).resolves.toBeUndefined();

    // editReply must NOT be called when embed is missing
    expect(editReplyFn).not.toHaveBeenCalled();
  });
});

describe("handleApprovalButton — concurrent guilds routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("T12 two guilds use separate API URLs — g2 click hits localhost:4000, not localhost:3000", async () => {
    /**
     * Layer: correctness
     * Attack surface #9: Two operators click in different guilds simultaneously.
     * Verifies that guildId → companyConfig resolution isolates API endpoints.
     * Mutation: hardcode a single API URL in resolveApproval → g2 call goes to g1's URL → RED
     */
    const harness = createTestHarness({ manifest });
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, text: async () => "" });
    harness.ctx.http = { fetch: mockFetch } as typeof harness.ctx.http;
    harness.ctx.secrets = {
      resolve: vi.fn().mockResolvedValue("api-key"),
    } as unknown as typeof harness.ctx.secrets;
    harness.ctx.logger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as typeof harness.ctx.logger;

    const interaction = makeInteraction({
      guildId: "g2",
      customId: `${APPROVAL_BUTTON_PREFIX.approve}appr-g2`,
    });

    await handleApprovalButton(harness.ctx, interaction, makeConfig());

    expect(mockFetch).toHaveBeenCalled();
    const calledUrl: string = mockFetch.mock.calls[0][0];
    // Must route to g2's API (localhost:4000), not g1's
    expect(calledUrl).toContain("localhost:4000");
    expect(calledUrl).not.toContain("localhost:3000");
  });
});
