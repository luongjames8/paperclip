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

**Status: v1 plugin feature-complete + tested (76 tests green, typecheck clean against the 529 SDK).**
Built: pure engine (`nextStep`/`advance`/`resolveWorker`), all 10 local gates, the 61-step
THEMATIC spec + structural validator, GATE_DEFS (24) + gate dispatcher, prompt assembly, and
the ctx-wired conductor (`start` action, `agent.run.finished` handler, `conductor` cron job,
`ctx.agents.invoke` + completion + gate eval + artifact flow via issue documents) + `ctx.db`
migration + integration smoke (`createTestHarness`, mocked invoke).

**Deploy-prep (NOT in this plugin / not yet done):**
- **Worker-agent configs** — `globalisto-worker-glm5` (`bailian/glm-5`) + `globalisto-worker-qwen37`
  (`bailian/qwen3.7-plus`), adapter `openclaw_gateway`. These live in the **openclaw-fleet** repo
  (globalisto company package + `openclaw.json`), NOT here, and must reconcile with the globalisto
  instance's in-progress migration. The plugin resolves them by name via `ctx.agents.list`.
- **Prompt vendoring** — the conductor references each step's prompt by path; the worker agents need
  the canonical `pipeline-mcp/prompts/**` in their workspace.
- **paperclip-deploy** (rebuild image, plugin instance config) + the live golden run.

**v1 limits (logged, not silent):** gate input assembly is best-effort (full per-gate input maps
are a follow-up against the golden run); human gates auto-pass. **Deferred beyond v1:** the 14
delegated/judge gates, Discord human-gate wiring, the QC-matrix runner.

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
