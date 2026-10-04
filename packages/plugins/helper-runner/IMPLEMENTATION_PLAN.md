# helper-runner Plugin — Phase 1 Implementation Plan

**Authored:** 2026-04-26 by architect (session 9), based on `runbooks/helper-runner-plugin-handoff.md`.
**Audience:** Builder agent (session 10).

---

## 1. Decision log (read first)

### Subscription model: typed `activity.logged` (catch-all is live)

Discord-fleet build landed an upstream paperclip patch (`server/src/services/activity-log.ts`) that emits `activity.logged` for every `logActivity` call regardless of whether the action is in `PLUGIN_EVENT_TYPES`. So the spec's strategy works directly: subscribe to `activity.logged` and demux client-side on `event.payload.action`.

Builder must verify the **exact action name** the server emits when a Routine fires. Candidates per spec: `routine.run_triggered`. Confirm by either:
- Grepping `server/src/services/routines.ts` (or wherever) for `logActivity(` calls.
- Triggering a Routine via API and dumping `activity.logged` events received by a stub plugin.

### Lessons baked in from discord-fleet deploy (~6 hours of friction)

These are NOT optional — handle them in scaffolding, not as deploy-time fixes:

1. **Package name MUST be `@openclaw/plugin-helper-runner`.** The plugin loader rejects scoped packages whose local part doesn't start with `plugin-` (`server/src/services/plugin-loader.ts isPluginPackageName`).
2. **esbuild worker config MUST use `packages: "external"`.** Otherwise CJS deps with built-in requires (e.g., anything that touches `node:events`) crash with "Dynamic require not supported." Override the SDK preset:
   ```js
   const workerConfig = { ...presets.esbuild.worker, packages: "external" };
   ```
3. **Dockerfile must include the plugin's package.json in the deps stage.** Add to `~/Dropbox/openclaw/paperclip/Dockerfile` after the existing `COPY packages/plugins/sdk/package.json`:
   ```
   COPY packages/plugins/helper-runner/package.json packages/plugins/helper-runner/
   ```
   Without this, `pnpm install` skips the plugin's deps and the worker crashes at import time. Dockerfile change is part of THIS deliverable.
4. **Manifest capabilities must declare every gated SDK surface used.** Validator at `packages/shared/dist/validators/plugin.js` enforces:
   - `jobs.schedule` if `jobs[]` declared
   - `webhooks.receive` if webhooks declared
   - `agent.tools.register` if tools declared
   Phase 1 has none of those — capabilities list is just: `events.subscribe`, `http.outbound`, `secrets.read-ref`, `plugin.state.read`, `plugin.state.write`, `metrics.write`. No `jobs.schedule` (no periodic jobs in Phase 1).
5. **Secret refs in config MUST be UUIDs (`f0c8b331-b583-4e35-9c67-079d97b41c55`)**, NOT slash-paths like `helper-runner/seeder-key`. The runtime resolver at `server/src/services/plugin-secrets-handler.ts` validates against UUID regex. Slash convention is naming-only and not currently supported by the resolver. The spec's `${secret:helper-runner/seeder-key}` pattern is fine SYNTACTICALLY in config; the value AFTER the colon must be a UUID. Document this clearly in the sample config.
6. **`paperclipApiUrl` for plugin's own API calls**: the plugin runs INSIDE the paperclip-server container, so it can reach paperclip at `http://localhost:3100`. This is the value to use in config. (If we ever expose links in document output for browser-clickability, we'd need a separate `publicUrl` field — not Phase 1 scope.)

### Other decisions

- **Worker lifecycle**: forked child of paperclip-server (per discord-fleet research). Deploy = rsync source + rebuild image + recreate container.
- **API version**: pin `apiVersion: 1` in manifest.
- **Config**: SDK-native via `instanceConfigSchema` + `ctx.config.get` + `onConfigChanged`. NO YAML, NO chokidar. Operator-side `bin/plugin-config-sync.sh helper-runner <company>` (REUSE the script we wrote for discord-fleet — same shape, just different plugin name).

---

## 2. Scaffold

```bash
cd ~/Dropbox/openclaw/paperclip
pnpm --filter @paperclipai/create-paperclip-plugin build
node packages/plugins/create-paperclip-plugin/dist/index.js @openclaw/plugin-helper-runner \
  --output packages/plugins
```

Target: `packages/plugins/helper-runner/`. After scaffolding, replace the kitchen-sink starter with the structure in §3.

---

## 3. File layout

```
packages/plugins/helper-runner/
├── package.json                  (name: @openclaw/plugin-helper-runner, paperclipPlugin: {manifest, worker})
├── tsconfig.json
├── esbuild.config.mjs            (workerConfig with packages: "external")
├── src/
│   ├── manifest.ts               (instanceConfigSchema, capabilities — see §1 item 4)
│   ├── worker.ts                 (entry — wires subscriptions + handler + config hot-reload)
│   ├── config/
│   │   ├── schema.ts             (TS types matching instanceConfigSchema)
│   │   └── validate.ts           (per-helper invariants — name uniqueness, absolute paths in exec.command)
│   ├── handlers/
│   │   └── routine-fired.ts      (matches activity.logged with action=routine.run_triggered, finds matching helper, spawns)
│   ├── exec/
│   │   ├── spawn.ts              (child_process.spawn wrapper with timeout + stdout/stderr capture)
│   │   ├── interpolate.ts        (${issue.id} / ${issue.identifier} / ${routine.id} / ${routine.run.id} / ${secret:UUID})
│   │   └── output.ts             (write Issue document via paperclip API; post comment if output.comment=true)
│   ├── api/
│   │   └── paperclip.ts          (typed paperclip REST client — ctx.http.fetch wrapper for issues/documents/comments)
│   └── util/
│       └── concurrency.ts        (per-helper maxConcurrent semaphore)
├── tests/
│   ├── interpolate.spec.ts       (variable substitution including secret resolution, missing-var handling)
│   ├── spawn.spec.ts             (timeout kill verified via signal received, exit code propagation)
│   ├── output.spec.ts            (JSON parse-validation; markdown/raw passthrough; size limits)
│   ├── error-handling.spec.ts    (onFailure=block_issue / cancel_issue / noop paths)
│   ├── concurrency.spec.ts       (maxConcurrent semaphore; parallel fires don't cross-contaminate)
│   ├── routing.spec.ts           (matches routineId from event payload to helper config; ignores unmatched)
│   └── plugin-setup.spec.ts      (manifest validates; config schema parses)
└── README.md
```

---

## 4. Phase 1 deliverables (acceptance checklist)

| # | Deliverable | Tests required |
|---|---|---|
| 1 | Plugin scaffolded via create-paperclip-plugin tool, package name `@openclaw/plugin-helper-runner` | `pnpm typecheck` + `build` clean |
| 2 | `manifest.ts` declares `apiVersion: 1`, `instanceConfigSchema` (per spec §"Configuration model"), capabilities list per §1 item 4 (NO jobs.schedule) | manifest validates against SDK type |
| 3 | `worker.ts` `setup()` reads config, validates (helper name uniqueness, absolute paths), subscribes to `activity.logged`, wires handler | smoke test that setup completes without throw |
| 4 | Routine-fired handler: filters action=routine.run_triggered (or whatever the actual emitted action is — VERIFY THIS during implementation), looks up helper config by routineId, spawns | per-handler unit tests with fake event payloads |
| 5 | Variable interpolation: `${issue.id}`, `${issue.identifier}`, `${routine.id}`, `${routine.run.id}`, `${secret:UUID}` (resolved via `ctx.secrets.resolve()`) | `interpolate.spec.ts` covers all 5 forms + missing-var error |
| 6 | spawn wrapper: `child_process.spawn` with cwd + env + timeout. Captures stdout (max 1 MB), stderr (max 256 KB), exit code, duration. Kills child on timeout via SIGTERM then SIGKILL after grace period | `spawn.spec.ts` — test with actual short-lived processes (echo, true/false, sleep with timeout) |
| 7 | Output writer: PATCH/POST `/api/issues/{issueId}/documents/{key}` with stdout content. If `output.format="json"`, validate parses before write. If `output.comment=true`, also POST a comment. (Builder must verify the actual paperclip API endpoint shapes — grep `server/src/routes/issues.ts` for documents routes.) | `output.spec.ts` — JSON parse failure, size limits, comment post |
| 8 | Error handling: timeout → write `helper-error` document with timeout message + apply `onTimeout` policy (block_issue: PATCH status=blocked; cancel_issue: PATCH status=cancelled; noop: skip). Same for non-zero exit with `onFailure` policy. | `error-handling.spec.ts` covers all 3 policies × 2 failure modes |
| 9 | Concurrency: per-helper `maxConcurrent` (default 4) semaphore. Parallel fires don't cross-contaminate document writes. | `concurrency.spec.ts` — fire 6 against maxConcurrent=2, assert exactly 2 run concurrently, others queue |
| 10 | Guild-collision-style sanity: at config load, refuse to start if two helpers share `(routineId, name)` pair OR if `exec.command` is not absolute path. | `validate.ts` test — both invariants throw clear errors |
| 11 | `onConfigChanged()` callback — re-validate config + rebuild routing map. In-flight spawns are NOT killed (let them complete with old config). | smoke test |
| 12 | Operator-side `bin/plugin-config-sync.sh helper-runner <company>` (REUSE the discord-fleet sync script — make it generic). | `--dry-run` flag works, exits nonzero on HTTP error |
| 13 | Sample config at `~/Dropbox/openclaw/instances/hinomaru/config/plugins/helper-runner.json` with the seeder helper pre-configured (real routineId, placeholder secret UUID for now since seeder.py doesn't actually need a secret in v1) | committed to git |
| 14 | Plugin's own Dockerfile entry: add `COPY packages/plugins/helper-runner/package.json packages/plugins/helper-runner/` to `~/Dropbox/openclaw/paperclip/Dockerfile` deps stage. | image rebuild succeeds, plugin's deps appear in `/app/node_modules/.pnpm/` |

---

## 5. NOT in Phase 1 (explicitly deferred)

- `kind: "issue_created"` triggers — Phase 2
- `kind: "approval_decided"` triggers — Phase 2 (this is the scheduler.py use case)
- Structured output schema validation (Zod against caller-supplied schema) — Phase 2
- Discord notification on helper failure — Phase 2 (would integrate with discord-fleet)
- Run history / metrics / observability — Phase 3
- Retries with backoff — Phase 3
- Sandboxing beyond child_process.spawn — out of scope

---

## 6. Per-handler behavior (Phase 1)

| Trigger event | Handler action |
|---|---|
| `activity.logged` with action=routine.run_triggered, payload.routine.id matches a configured helper | (1) acquire semaphore slot per helper.maxConcurrent. (2) interpolate args/env/cwd. (3) spawn child_process. (4) on timeout, SIGTERM → wait 2s → SIGKILL. (5) on exit, write stdout to Issue document; if exit nonzero, write stderr to `helper-error` doc + apply onFailure. (6) post comment if output.comment=true. (7) release semaphore. |
| `activity.logged` with action=routine.run_triggered, payload.routine.id NOT in any helper config | log debug + skip |
| Other actions | skip silently (this plugin only cares about routine fires in Phase 1) |

If the actual action emitted on routine fire is NOT `routine.run_triggered` — name discovered during builder implementation — **flag it to architect immediately.** Don't assume.

---

## 7. Validation handoff (what validator will check pre-deploy)

Builder must `pnpm typecheck && pnpm test && pnpm build` clean before declaring DONE.

Validator's adversarial Phase 1 acceptance criteria (subset of spec's 8 — others need a live paperclip):

1. **Manifest validates**: install attempt against a stub paperclip would succeed (capability list complete, no missing required fields).
2. **Subscription verified**: worker subscribes ONLY to `activity.logged` (no other events). Quote the subscription line.
3. **Action match correctness**: handler logic correctly filters by `event.payload.action === "<verified-action-name>"` AND `event.payload.routine.id === <config.routineId>`. Unmatched events return early.
4. **Spawn safety**: `exec.command` validated as absolute path at config load. Test config with relative path → throws.
5. **Interpolation completeness**: all 5 variable forms work. Missing `${secret:UUID}` → throws clear error with the ref name.
6. **Timeout actually kills**: spawn a `sleep 60` with timeoutSec=1, assert process is dead within 5 seconds (use `ps` or check that subsequent operations don't see a zombie).
7. **Output JSON validation**: stdout="not json" with format="json" → caught + written as helper-error.
8. **Concurrency limit**: maxConcurrent=2, fire 5 events for the same helper, assert exactly 2 spawn concurrently, others queue and run as slots free.
9. **Error policy paths**: each of (block_issue, cancel_issue, noop) for both onTimeout and onFailure correctly transitions issue state OR leaves it.
10. **Adversarial config**: try to inject `;rm -rf /` in args — verify that goes through child_process.spawn argument array (not shell), so it's not interpreted as a shell command.

Live integration tests (post-deploy, separate Stage 2):
- Acceptance criteria 1, 2 from spec (real Routine fire → real document on Issue)
- Criterion 5 (variable interpolation with real Issue UUID)
- Criterion 6 (concurrency under real concurrent fires)
- Criterion 8 (plugin restart mid-execution recovery)

---

## 8. Deploy mechanics (Stage 2 — architect handles after validator PASS)

Same flow as discord-fleet:

1. rsync source: `rsync -avz --exclude node_modules --exclude .git ~/Dropbox/openclaw/paperclip/packages/plugins/helper-runner/ root@openclaw-fsn:/opt/paperclip/packages/plugins/helper-runner/` + the Dockerfile (if changed).
2. Rebuild image: `ssh root@openclaw-fsn 'cd /opt/paperclip/docker && docker compose --env-file /opt/paperclip/.env build server'`.
3. Retag + recreate container with the same env vars used for discord-fleet (PAPERCLIP_PUBLIC_URL=http://100.98.95.12:3100 — important).
4. Install plugin: `POST /api/plugins/install` with `{"packageName":"/app/packages/plugins/helper-runner","isLocalPath":true}` (use board cookie).
5. Push config: `POST /api/plugins/{id}/config` wrapped in `{"configJson": {...}}`.
6. Enable: `POST /api/plugins/{id}/enable`.
7. Live integration test: trigger Routine `fcb1a87f-...`, verify document on spawned Issue.

---

## 9. References

- Spec: `~/Dropbox/openclaw/runbooks/helper-runner-plugin-handoff.md`
- discord-fleet plan (sibling pattern): `~/Dropbox/openclaw/paperclip/packages/plugins/discord-fleet/IMPLEMENTATION_PLAN.md`
- Q6 patch (enables activity.logged catch-all): committed to `/opt/paperclip/server/src/services/activity-log.ts` on fsn
- Kitchen-sink reference: `~/Dropbox/openclaw/paperclip/packages/plugins/examples/plugin-kitchen-sink-example/`
- SDK types: `~/Dropbox/openclaw/paperclip/packages/plugins/sdk/dist/types.d.ts`
- Plugin event delivery rules (memory): `~/.claude/projects/-home-james-luong-Dropbox-openclaw/memory/project_paperclip_plugin_bus.md`
