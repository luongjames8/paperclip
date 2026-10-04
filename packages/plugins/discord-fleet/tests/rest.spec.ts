import { describe, it, expect, vi } from "vitest";
import type { Client } from "discord.js";
import { postEmbedsToChannel } from "../src/discord/rest.js";

describe("postEmbedsToChannel", () => {
  it("sends one Discord message with all provided embeds + components", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-99" });
    const channel = { send };
    const fetch = vi.fn().mockResolvedValue(channel);
    const client = { channels: { fetch } } as unknown as Client;

    const embeds = [{ title: "a" }, { title: "b" }, { title: "c" }];
    const components = [{ type: 1 as const, components: [] }];

    const id = await postEmbedsToChannel(client, "ch-1", embeds as any, components as any);

    expect(fetch).toHaveBeenCalledWith("ch-1");
    expect(send).toHaveBeenCalledWith({ embeds, components });
    expect(id).toBe("msg-99");
  });

  it("works without components arg", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-1" });
    const client = { channels: { fetch: vi.fn().mockResolvedValue({ send }) } } as unknown as Client;
    await postEmbedsToChannel(client, "ch-1", [{ title: "a" }] as any);
    expect(send).toHaveBeenCalledWith({ embeds: [{ title: "a" }], components: undefined });
  });

  it("throws if channel not found", async () => {
    const client = { channels: { fetch: vi.fn().mockResolvedValue(null) } } as unknown as Client;
    await expect(postEmbedsToChannel(client, "missing-ch", [{ title: "a" }] as any))
      .rejects.toThrow(/channel not found: missing-ch/);
  });
});
