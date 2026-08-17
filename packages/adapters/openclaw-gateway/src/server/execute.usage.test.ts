import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { execute } from "./execute.js";

/**
 * The openclaw gateway answers an async `agent` request twice on the same frame
 * id: `status: "accepted"` first, then the terminal payload carrying
 * `result.meta.agentMeta` (provider/model/token usage). `agent.wait` returns a
 * lifecycle snapshot with no meta at all, so that second frame is the only
 * place usage reaches the adapter. Paperclip used to drop it, which is why
 * `heartbeat_runs.usage_json` and `cost_events` stayed empty forever.
 */

type FakeGatewayOptions = {
  sendTerminalFrame: boolean;
  terminalBeforeWait?: boolean;
  /** Answer `agent` synchronously with the terminal payload, as older gateways do. */
  synchronousOk?: boolean;
};

const AGENT_META = {
  provider: "bailian",
  model: "glm-5",
  usage: { input: 1200, output: 340, cacheRead: 90 },
};

function startFakeGateway(opts: FakeGatewayOptions) {
  const wss = new WebSocketServer({ port: 0 });

  wss.on("connection", (socket: WebSocket) => {
    const send = (frame: unknown) => socket.send(JSON.stringify(frame));
    send({ type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });

    let agentFrameId: string | null = null;
    const sendTerminal = () => {
      if (!opts.sendTerminalFrame || !agentFrameId) return;
      send({
        type: "res",
        id: agentFrameId,
        ok: true,
        payload: {
          runId: "run-usage",
          status: "ok",
          summary: "completed",
          result: { meta: { agentMeta: AGENT_META } },
        },
      });
    };

    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as { id: string; method: string };
      if (frame.method === "connect") {
        send({ type: "res", id: frame.id, ok: true, payload: { protocol: 4 } });
        return;
      }
      if (frame.method === "agent") {
        agentFrameId = frame.id;
        if (opts.synchronousOk) {
          sendTerminal();
          return;
        }
        send({ type: "res", id: frame.id, ok: true, payload: { runId: "run-usage", status: "accepted" } });
        return;
      }
      if (frame.method === "agent.wait") {
        if (opts.terminalBeforeWait) sendTerminal();
        send({ type: "res", id: frame.id, ok: true, payload: { runId: "run-usage", status: "ok" } });
        if (!opts.terminalBeforeWait) sendTerminal();
      }
    });
  });

  return wss;
}

function buildContext(url: string): AdapterExecutionContext {
  return {
    runId: "run-usage",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Meridian",
      adapterType: "openclaw_gateway",
      adapterConfig: null,
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { url, disableDeviceAuth: true, autoPairOnFirstConnect: false, waitTimeoutMs: 5_000 },
    context: {},
    onLog: async () => {},
  };
}

let server: WebSocketServer | null = null;

afterEach(async () => {
  if (!server) return;
  const closing = server;
  server = null;
  await new Promise<void>((resolve) => closing.close(() => resolve()));
});

async function runAgainstFakeGateway(opts: FakeGatewayOptions) {
  server = startFakeGateway(opts);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return execute(buildContext(`ws://127.0.0.1:${port}`));
}

describe("openclaw gateway usage capture", () => {
  it("reports token usage from the terminal agent frame that arrives after agent.wait", async () => {
    const result = await runAgainstFakeGateway({ sendTerminalFrame: true });

    expect(result.exitCode).toBe(0);
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 340, cachedInputTokens: 90 });
    expect(result.provider).toBe("bailian");
    expect(result.model).toBe("glm-5");
  });

  it("reports token usage when the terminal frame wins the race with agent.wait", async () => {
    const result = await runAgainstFakeGateway({ sendTerminalFrame: true, terminalBeforeWait: true });

    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 340, cachedInputTokens: 90 });
  });

  it("does not pay the terminal-frame grace wait when `agent` answers ok synchronously", async () => {
    const startedAt = Date.now();
    const result = await runAgainstFakeGateway({ sendTerminalFrame: true, synchronousOk: true });

    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 340, cachedInputTokens: 90 });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("still completes when the gateway never sends a terminal frame", async () => {
    const result = await runAgainstFakeGateway({ sendTerminalFrame: false });

    expect(result.exitCode).toBe(0);
    expect(result.usage).toBeUndefined();
  });
});
