# Globalisto Content Pipeline

Conductor for the globalisto YouTube content pipeline: drives the canonical engine step-by-step via per-model worker agents through the gateway.

## Architecture

Design: `docs/superpowers/specs/2026-06-07-globalisto-content-pipeline-architecture.md` (openclaw-fleet repo).

This plugin owns a **deterministic, pure-over-`ctx` conductor loop**. Per step it
`ctx.agents.invoke`s a per-model **worker agent** (`globalisto-worker-glm5` /
`globalisto-worker-qwen37`; profile = role→agent routing) → openclaw gateway →
bailian. All model calls go through the gateway; no direct provider calls.

- `src/engine/` — pure decision functions (`nextStep`, `advance`, `resolveWorker`),
  unit-tested with no harness (`tests/engine.spec.ts`). This is the testable core.
- `src/worker.ts` — wires the engine to `ctx` (currently scaffold demo handlers).

**Scaffold status (this commit):** engine pure functions + tests + plugin skeleton, green.
**Implementation phase (TODO):** vendor the canonical `pipeline-mcp` spec/prompts; add the
10 local gates (port from `gates.js`); add the `ctx.db` state tables (`database` namespace +
migrations) and the `ctx.jobs` scheduled conductor; wire `ctx.agents.invoke` + completion
polling; create the worker agents + profiles. Deferred beyond v1: the 14 judge gates,
Discord human-gate wiring, the QC-matrix runner.

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```



## Install Into Paperclip

```bash
curl -X POST http://127.0.0.1:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName":"/home/james-luong/code/openclaw-fleet/paperclip/packages/plugins/globalisto-pipeline","isLocalPath":true}'
```

## Build Options

- `pnpm build` uses esbuild presets from `@paperclipai/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
