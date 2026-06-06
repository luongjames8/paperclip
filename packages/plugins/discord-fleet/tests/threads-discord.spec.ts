import { describe, it, expect, vi } from "vitest";
import type { Client } from "discord.js";
import { createThread, recoverThread } from "../src/discord/threads.js";

function makeMockThread(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread-123",
    archived: false,
    send: vi.fn().mockResolvedValue({ id: "msg-1" }),
    edit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockChannel(thread = makeMockThread()) {
  return {
    threads: {
      create: vi.fn().mockResolvedValue(thread),
    },
    send: vi.fn().mockResolvedValue({ id: "msg-root" }),
  };
}

function makeMockClient(channel: unknown, fetchOverride?: () => Promise<unknown>, patchOverride?: ReturnType<typeof vi.fn>) {
  return {
    channels: {
      fetch: fetchOverride ?? vi.fn().mockResolvedValue(channel),
    },
    rest: {
      patch: patchOverride ?? vi.fn().mockResolvedValue({}),
    },
  } as unknown as Client;
}

describe("createThread", () => {
  it("posts thread + stores entry", async () => {
    const thread = makeMockThread({ id: "thread-123" });
    const channel = makeMockChannel(thread);
    const client = makeMockClient(channel);

    const entry = await createThread(client, "channel-999", "ISS-1 — My Issue", "first message");

    expect(entry.channelId).toBe("channel-999");
    expect(entry.threadId).toBe("thread-123");
    expect(thread.send).toHaveBeenCalledWith({ content: "first message" });
  });
});

describe("recoverThread", () => {
  it("unarchives an archived thread", async () => {
    const thread = makeMockThread({ id: "thread-456", archived: true });
    const client = makeMockClient(thread);

    const entry = await recoverThread(client, "channel-999", "thread-456", "ISS-1 — Archived");

    expect(thread.edit).toHaveBeenCalledWith({ archived: false });
    expect(entry).not.toBeNull();
    expect(entry.threadId).toBe("thread-456");
  });

  it("unarchives thread on 404 via REST PATCH (preserves history)", async () => {
    const patchMock = vi.fn().mockResolvedValue({});
    const newThread = makeMockThread({ id: "should-not-be-created" });
    const channel = makeMockChannel(newThread);
    let fetchCount = 0;

    const client = makeMockClient(null, async () => {
      fetchCount++;
      if (fetchCount === 1) {
        // recoverThread fetches old thread → 404
        throw Object.assign(new Error("Unknown Channel"), { status: 404 });
      }
      return channel; // createThread would fetch parent channel — must NOT reach this
    }, patchMock);

    const entry = await recoverThread(client, "channel-999", "archived-thread-id", "ISS-2 — Archived", "first message");

    expect(patchMock).toHaveBeenCalledWith("/channels/archived-thread-id", { body: { archived: false } });
    expect(channel.threads.create).not.toHaveBeenCalled(); // createThread must NOT fire
    expect(entry.threadId).toBe("archived-thread-id");
    expect(entry.channelId).toBe("channel-999");
  });

  it("recreates thread when 404 → PATCH also fails (truly gone)", async () => {
    let fetchCount = 0;
    const newThread = makeMockThread({ id: "new-thread-after-patch-fail" });
    const channel = makeMockChannel(newThread);

    const patchMock = vi.fn().mockRejectedValue(
      Object.assign(new Error("Thread Deleted"), { status: 410 }),
    );

    const client = makeMockClient(null, async () => {
      fetchCount++;
      if (fetchCount === 1) {
        throw Object.assign(new Error("Unknown Channel"), { status: 404 });
      }
      return channel;
    }, patchMock);

    const entry = await recoverThread(client, "channel-999", "gone-thread", "ISS-2 — Reborn", "first message");

    expect(patchMock).toHaveBeenCalledWith("/channels/gone-thread", { body: { archived: false } });
    expect(channel.threads.create).toHaveBeenCalled();
    expect(entry.threadId).toBe("new-thread-after-patch-fail");
    expect(newThread.send).toHaveBeenCalledWith({ content: "first message" });
  });

  it("recreates thread on 410 (permanently deleted) without PATCH attempt", async () => {
    let fetchCount = 0;
    const newThread = makeMockThread({ id: "new-thread-410" });
    const channel = makeMockChannel(newThread);
    const patchMock = vi.fn();

    const client = makeMockClient(null, async () => {
      fetchCount++;
      if (fetchCount === 1) {
        // recoverThread tries to fetch old thread → 410
        throw Object.assign(new Error("Thread Deleted"), { status: 410, code: 10003 });
      }
      // createThread fetches the parent channel
      return channel;
    }, patchMock);

    const entry = await recoverThread(client, "channel-999", "deleted-thread", "ISS-3 — Recreated", "seed content");

    // 410 = permanently deleted — no PATCH attempt, recreate immediately
    expect(patchMock).not.toHaveBeenCalled();
    expect(channel.threads.create).toHaveBeenCalled();
    expect(entry.channelId).toBe("channel-999");
    expect(entry.threadId).toBe("new-thread-410");
    expect(newThread.send).toHaveBeenCalledWith({ content: "seed content" });
  });

  it("404 → PATCH fails with 500 → re-throws (does not recreate)", async () => {
    let fetchCount = 0;
    const newThread = makeMockThread({ id: "should-not-be-created" });
    const channel = makeMockChannel(newThread);
    const patchMock = vi.fn().mockRejectedValue(
      Object.assign(new Error("Internal Server Error"), { status: 500 }),
    );

    const client = makeMockClient(null, async () => {
      fetchCount++;
      if (fetchCount === 1) {
        throw Object.assign(new Error("Unknown Channel"), { status: 404 });
      }
      return channel;
    }, patchMock);

    await expect(
      recoverThread(client, "channel-999", "thread-id", "ISS-X", "content"),
    ).rejects.toMatchObject({ status: 500 });

    expect(channel.threads.create).not.toHaveBeenCalled();
  });
});
