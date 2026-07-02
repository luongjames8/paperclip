/**
 * Layer: unit
 * Coverage: PaperclipClient.approveApproval + rejectApproval (API contract)
 * Adversarial paths (4xx/5xx error handling) are handled by the parallel
 * adversarial-validator subagent — this file covers happy-path baseline only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import { PaperclipClient } from "../src/api/paperclip.js";

function makeClient(harness: ReturnType<typeof createTestHarness>, apiKey = "test-api-key") {
  return new PaperclipClient(harness.ctx, "http://paperclip:3100", apiKey);
}

describe("PaperclipClient.approveApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs to /api/approvals/:id/approve with Bearer auth", async () => {
    const harness = createTestHarness({ manifest });
    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ({}),
      text: async () => "",
    } as any);

    const client = makeClient(harness, "my-bearer-token");
    await client.approveApproval("appr-001");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://paperclip:3100/api/approvals/appr-001/approve");
    expect(opts?.method).toBe("POST");
    expect((opts?.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-bearer-token");
  });

  it("sets Content-Type: application/json", async () => {
    const harness = createTestHarness({ manifest });
    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ({}),
      text: async () => "",
    } as any);

    const client = makeClient(harness);
    await client.approveApproval("appr-001");

    const [, opts] = fetchSpy.mock.calls[0];
    expect((opts?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("sends body {decisionNote: '...'} when note provided", async () => {
    const harness = createTestHarness({ manifest });
    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ({}),
      text: async () => "",
    } as any);

    const client = makeClient(harness);
    await client.approveApproval("appr-001", "discord:alice");

    const [, opts] = fetchSpy.mock.calls[0];
    expect(JSON.parse(opts?.body as string)).toEqual({ decisionNote: "discord:alice" });
  });

  it("sends body {} when no note provided", async () => {
    const harness = createTestHarness({ manifest });
    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ({}),
      text: async () => "",
    } as any);

    const client = makeClient(harness);
    await client.approveApproval("appr-001");

    const [, opts] = fetchSpy.mock.calls[0];
    expect(JSON.parse(opts?.body as string)).toEqual({});
  });

  it("resolves without throwing on 200 response", async () => {
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ({}),
      text: async () => "",
    } as any);

    const client = makeClient(harness);
    await expect(client.approveApproval("appr-001", "discord:alice")).resolves.toBeUndefined();
  });
});

describe("PaperclipClient.rejectApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs to /api/approvals/:id/reject with Bearer auth", async () => {
    const harness = createTestHarness({ manifest });
    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ({}),
      text: async () => "",
    } as any);

    const client = makeClient(harness, "my-bearer-token");
    await client.rejectApproval("appr-002");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://paperclip:3100/api/approvals/appr-002/reject");
    expect(opts?.method).toBe("POST");
    expect((opts?.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-bearer-token");
  });

  it("sends body {decisionNote: '...'} when note provided", async () => {
    const harness = createTestHarness({ manifest });
    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ({}),
      text: async () => "",
    } as any);

    const client = makeClient(harness);
    await client.rejectApproval("appr-002", "discord:bob");

    const [, opts] = fetchSpy.mock.calls[0];
    expect(JSON.parse(opts?.body as string)).toEqual({ decisionNote: "discord:bob" });
  });

  it("resolves without throwing on 204 response", async () => {
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 204,
      json: async () => ({}),
      text: async () => "",
    } as any);

    const client = makeClient(harness);
    await expect(client.rejectApproval("appr-002", "discord:bob")).resolves.toBeUndefined();
  });
});

describe("PaperclipClient.getApprovalIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs /api/approvals/:id/issues with Bearer auth and returns issue list", async () => {
    const harness = createTestHarness({ manifest });
    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ([
        { id: "iss-1", identifier: "HIN-401", projectId: "proj-1", title: "Writer issue", status: "in_progress", updatedAt: "2026-05-16T00:00:00Z", createdAt: "2026-05-15T00:00:00Z" },
      ]),
      text: async () => "",
    } as any);

    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "tok");
    const issues = await client.getApprovalIssues("appr-001");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://paperclip:3100/api/approvals/appr-001/issues");
    expect(opts?.method).toBe("GET");
    expect((opts?.headers as Record<string,string>)["Authorization"]).toBe("Bearer tok");
    expect(issues).toHaveLength(1);
    expect(issues[0].identifier).toBe("HIN-401");
  });

  it("returns empty array when API returns empty list", async () => {
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ([]),
      text: async () => "",
    } as any);
    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "tok");
    expect(await client.getApprovalIssues("appr-001")).toEqual([]);
  });

  it("throws on 5xx", async () => {
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({ status: 500, json: async () => ([]), text: async () => "boom" } as any);
    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "tok");
    await expect(client.getApprovalIssues("appr-001")).rejects.toThrow(/paperclip API error: 500/);
  });
});

describe("PaperclipClient.listIssueDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs /api/issues/:id/documents and returns doc list", async () => {
    const harness = createTestHarness({ manifest });
    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ([
        { key: "posts", body: '{"weekOf":"2026-05-11","posts":[]}' },
        { key: "draft", body: "some draft text" },
      ]),
      text: async () => "",
    } as any);

    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "tok");
    const docs = await client.listIssueDocuments("iss-1");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://paperclip:3100/api/issues/iss-1/documents");
    expect(docs).toHaveLength(2);
    expect(docs[0].key).toBe("posts");
    expect(docs[0].body).toBe('{"weekOf":"2026-05-11","posts":[]}');
  });

  it("returns empty array on empty response", async () => {
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ([]),
      text: async () => "",
    } as any);
    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "tok");
    expect(await client.listIssueDocuments("iss-1")).toEqual([]);
  });

  it("throws on 5xx", async () => {
    const harness = createTestHarness({ manifest });
    vi.spyOn(harness.ctx.http, "fetch").mockResolvedValue({
      status: 500,
      json: async () => ([]),
      text: async () => "",
    } as any);
    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "tok");
    await expect(client.listIssueDocuments("iss-1")).rejects.toThrow(/paperclip API error: 500/);
  });
});

// CLASS 2 — pagination tests for issue-list endpoints
describe("PaperclipClient.getBacklogAndTodoIssues — pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeIssue(id: string): { id: string; identifier: string; title: string; status: string; updatedAt: string; createdAt: string } {
    return { id, identifier: id.toUpperCase(), title: `Issue ${id}`, status: "backlog", updatedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" };
  }

  it("paginates until a page smaller than PAGE_SIZE (1000) is returned", async () => {
    const harness = createTestHarness({ manifest });
    // Page 1: full page of 1000; page 2: 3 items (last page)
    const page1 = Array.from({ length: 1000 }, (_, i) => makeIssue(`b${i}`));
    const page2 = [makeIssue("b1000"), makeIssue("b1001"), makeIssue("b1002")];

    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      // backlog status
      if (u.includes("status=backlog")) {
        if (u.includes("offset=0")) return { status: 200, json: async () => page1, text: async () => "" } as any;
        if (u.includes("offset=1000")) return { status: 200, json: async () => page2, text: async () => "" } as any;
      }
      // todo status — one empty page
      if (u.includes("status=todo")) {
        return { status: 200, json: async () => [], text: async () => "" } as any;
      }
      return { status: 200, json: async () => [], text: async () => "" } as any;
    });

    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "tok");
    const result = await client.getBacklogAndTodoIssues("c1");

    // Should have fetched page1 + page2 for backlog = 1003 items
    expect(result.length).toBe(1003);
    // Two fetches for backlog (offset=0 and offset=1000) + one for todo
    const backlogCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes("status=backlog"));
    expect(backlogCalls.length).toBe(2);
    expect(String(backlogCalls[0][0])).toContain("offset=0");
    expect(String(backlogCalls[1][0])).toContain("offset=1000");
  });

  it("returns all items from a single page when page < 1000", async () => {
    const harness = createTestHarness({ manifest });
    const items = [makeIssue("b1"), makeIssue("b2")];

    vi.spyOn(harness.ctx.http, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("status=backlog")) return { status: 200, json: async () => items, text: async () => "" } as any;
      return { status: 200, json: async () => [], text: async () => "" } as any;
    });

    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "tok");
    const result = await client.getBacklogAndTodoIssues("c1");
    expect(result.length).toBe(2);
  });
});

describe("PaperclipClient.getInProgressIssues — pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("paginates in-progress issues across multiple pages", async () => {
    const harness = createTestHarness({ manifest });
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: `ip${i}`, identifier: `IP${i}`, title: `IP ${i}`, status: "in_progress",
      updatedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z",
    }));
    const page2 = [{ id: "ip1000", identifier: "IP1000", title: "IP 1000", status: "in_progress", updatedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" }];

    const fetchSpy = vi.spyOn(harness.ctx.http, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("offset=0")) return { status: 200, json: async () => page1, text: async () => "" } as any;
      if (u.includes("offset=1000")) return { status: 200, json: async () => page2, text: async () => "" } as any;
      return { status: 200, json: async () => [], text: async () => "" } as any;
    });

    const client = new PaperclipClient(harness.ctx, "http://paperclip:3100", "tok");
    const result = await client.getInProgressIssues("c1");

    expect(result.length).toBe(1001);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("status=in_progress");
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
