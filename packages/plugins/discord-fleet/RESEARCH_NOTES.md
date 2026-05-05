# Research Notes: discord-fleet Plugin Pre-flight SDK Research

**Date:** 2026-04-26  
**Researcher:** Researcher agent (session 12)  
**Architect:** session 9  
**Status:** Complete — all 7 questions answered

---

## Q1. Plugin Worker Lifecycle

**Answer: Worker runs as a forked child process INSIDE the paperclip-server container.**

`plugin-worker-manager.ts:619`:
```ts
const child = fork(options.entrypointPath, [], {
  stdio: ["pipe", "pipe", "pipe", "ipc"],
  execArgv: options.execArgv ?? [],
  env: workerEnv,
  detached: false,
});
```

This is Node.js `child_process.fork()`. The worker is a **child process of paperclip-server**, not a sibling container or separate docker compose service. It runs inside the same Docker container.

**Key details:**
- `detached: false` — child keeps parent alive; parent exit kills child
- IPC channel (fd 3) carries JSON-RPC messages between host and worker
- Stdout is read as NDJSON; stderr is captured for logging
- Worker is spawned with a minimal env (`PATH`, `NODE_PATH`, `PAPERCLIP_PLUGIN_ID`, `NODE_ENV`, `TZ`) — NOT the full host env (security boundary, `plugin-worker-manager.ts:607-617`)

**Deploy story implication:**
- Plugin code goes IN the paperclip image (not a separate compose service)
- Deploy = rsync source to fsn → `docker restart paperclip` → auto-discovered by plugin-loader
- Plugin-loader discovers packages with `paperclipPlugin: {manifest, worker}` in `package.json` at startup (`plugin-loader.ts:220-247` — `buildHostHandlers` pattern)
- No separate compose service needed

**Source:** `server/src/services/plugin-worker-manager.ts:600-628`

---

## Q2. ctx.secrets.resolve

**Answer: Flat string reference, returns `Promise<string>`. No nested key support — slashes in the ref name are just naming convention.**

`packages/plugins/sdk/dist/types.d.ts:338-352`:
```ts
export interface PluginSecretsClient {
  /**
   * Resolve a secret reference to its current value.
   * The reference is a string identifier pointing to a secret configured
   * in the Paperclip secret provider.
   * Secret values must never be cached or written to logs.
   */
  resolve(secretRef: string): Promise<string>;
}
```

**How it works:**
- `secretRef` is a flat string key — e.g., `"paperclip-discord/board-api-key/james"` 
- The slashes are part of the key name convention, not nested key traversal
- The full path string IS the lookup key
- Returns the secret value at call time
- Requires `"secrets.read-ref"` in plugin manifest capabilities

**Kitchen-sink usage** (`packages/plugins/examples/plugin-kitchen-sink-example/src/worker.ts:609-628`):
```ts
ctx.actions.register("resolve-secret", async (params) => {
  const secretRef = typeof params.secretRef === "string" ? params.secretRef : config.secretRefExample;
  const resolved = await ctx.secrets.resolve(secretRef);
  return {
    secretRef,
    resolvedLength: resolved.length,
    preview: resolved.length > 0 ? `${resolved.slice(0, 2)}***` : "",
  };
});
```

**For the spec's per-user board API key (`paperclip-discord/board-api-key/james`):**
- Store the full string `"paperclip-discord/board-api-key/james"` in userMappings config as `boardApiKeySecretRef`
- Call `await ctx.secrets.resolve(mapping.boardApiKeySecretRef)` at `/approve` time
- Works correctly — the full path IS the ref

**Source:** `packages/plugins/sdk/dist/types.d.ts:338-352`, `examples/plugin-kitchen-sink-example/src/worker.ts:609-628`

---

## Q3. Discord Gateway Sharding

**Answer: Sharding is NOT required for 3 guilds. The threshold is 2,500 guilds.**

- Discord Gateway refuses connections without sharding at **≥ 2,500 guilds**
- Below 2,500: single-shard connection, no sharding needed
- For our use case (3 guilds: SafeGate, Hinomaru, jackson-steinem): **no sharding**
- Recommended headroom: start planning sharding around 2,000 guilds; target ~1,000 guilds/shard when implemented

**Sources:**  
- https://discord.com/developers/docs/events/gateway  
- https://discordjs.guide/sharding/

---

## Q4. Slash Command Registration

**Answer: Use guild-specific registration during development; switch to global at production.**

| | Global | Guild-specific |
|---|---|---|
| Scope | All servers the bot is in | Single guild only |
| Propagation time | **Up to 1 hour** | **Instant** |
| Iteration speed | Very slow (1 command change = 1 hour wait) | Instant |
| Rate limits | More restrictive | More lenient |

**Recommendation for Phase 1 (3 guilds, active dev):** Guild-specific registration. Changes are visible immediately. Iterate fast without waiting up to an hour per tweak.

**Production path:** Register globally when slash commands are finalized. Global registration means only one call to Discord instead of one per guild.

**Implementation:** Register against each configured `guildId` from plugin config at startup. At plugin init, iterate all configured company configs and call `rest.put(Routes.applicationGuildCommands(...), ...)` for each guild.

**Sources:**  
- https://discord.com/developers/docs/interactions/application-commands  
- https://discordjs.guide/creating-your-bot/command-deployment.html

---

## Q5. PLUGIN_API_VERSION

**Answer: `PLUGIN_API_VERSION = 1`**

`packages/shared/src/constants.ts:402`:
```ts
export const PLUGIN_API_VERSION = 1 as const;
```

This is the current version in the codebase (v2026.416.0 on fsn). Plugin manifest must declare `apiVersion: 1` to be accepted by the host.

**Source:** `packages/shared/src/constants.ts:402`

---

## Q6. activity.logged Demux — ⚠️ CRITICAL FINDING

**Answer: The spec's `activity.logged` catch-all subscription does NOT work in the current codebase. This is a blocking architectural issue the builder must not proceed past.**

### The mechanism (what the code actually does)

`server/src/services/activity-log.ts` — full `logActivity()` function:

1. **Line 57-70:** `publishLiveEvent({type: "activity.logged", payload: {..., action: input.action, ...}})` — this fires for EVERY logActivity call. But it goes to the **SSE live event stream** for UI clients (`live-events.ts` is a plain Node.js EventEmitter). It does NOT feed into the plugin event bus.

2. **Lines 72-93:** 
```ts
if (_pluginEventBus && PLUGIN_EVENT_SET.has(input.action)) {
  const event: PluginEvent = {
    eventType: input.action as PluginEventType,  // <-- action becomes eventType
    payload: { ...redactedDetails, agentId, runId },
  };
  void _pluginEventBus.emit(event);
}
```
This fires to the **plugin event bus** ONLY when `input.action` is literally one of the values in `PLUGIN_EVENT_TYPES`. The `eventType` is the action string itself.

3. **Consequence:** `activity.logged` is in `PLUGIN_EVENT_TYPES`, but no code EVER calls `logActivity({action: "activity.logged", ...})`. So subscribing to `"activity.logged"` in the plugin bus receives **zero events**.

4. **Confirmed:** `publishLiveEvent` (live-events.ts:27-35) is a pure Node.js EventEmitter with no connection to the plugin bus. `app.ts:216` only calls `setPluginEventBus(eventBus)` to wire the bus into `logActivity()` — no other path.

### Per-action audit against spec's Phase 1 demux table

| `event.action` (spec) | logActivity call found? | In PLUGIN_EVENT_TYPES? | Plugin receives event? |
|---|---|---|---|
| `issue.created` | ✅ `issues.ts:1352` | ✅ | ✅ as `issue.created` typed event |
| `issue.updated` | ✅ `issues.ts:1627`, `heartbeat.ts:2979`, `heartbeat.ts:4329` | ✅ | ✅ as `issue.updated` typed event |
| `issue.comment_added` | ✅ `issues.ts:1744, 2419` | ❌ (PLUGIN_EVENT_TYPES has `issue.comment.created` — different string) | ❌ **NEVER** |
| `approval.created` | ✅ `approvals.ts:109`, `agents.ts:1527` | ✅ | ✅ as `approval.created` typed event |
| `approval.approved` | ✅ `approvals.ts:149` | ❌ (PLUGIN_EVENT_TYPES has `approval.decided` — different string) | ❌ **NEVER** |
| `approval.rejected` | ✅ `approvals.ts:241` | ❌ (PLUGIN_EVENT_TYPES has `approval.decided` — different string) | ❌ **NEVER** |
| `agent.run.failed` | ❌ NO logActivity call anywhere | ✅ in PLUGIN_EVENT_TYPES | ❌ **NEVER** |
| `issue.work_product_created` | ✅ `issues.ts:1066` | ❌ (not in PLUGIN_EVENT_TYPES) | ❌ **NEVER** |
| `cost.reported` | ✅ `costs.ts:76` | ❌ (PLUGIN_EVENT_TYPES has `cost_event.created` — different string) | ❌ **NEVER** |

### What DOES reach the plugin (confirmed working)

Subscribe to these typed events via `ctx.events.on(...)`:
- `"issue.created"` ✅
- `"issue.updated"` ✅
- `"approval.created"` ✅
- `"approval.decided"` — in PLUGIN_EVENT_TYPES but logActivity uses `"approval.approved"` / `"approval.rejected"` → ❌ never fires
- `"agent.run.started"`, `"agent.run.finished"`, `"agent.run.failed"`, `"agent.run.cancelled"` — in PLUGIN_EVENT_TYPES but no logActivity calls → ❌ never fire

### What the spec's catch-all would require (upstream changes)

Option A: Add a second `_pluginEventBus.emit` in `logActivity()` that ALWAYS emits `activity.logged` with the raw action in payload — regardless of what `input.action` is. This is the "native" fix.

Option B: Fix the string mismatches: change `"issue.comment_added"` → `"issue.comment.created"` in issues.ts, `"approval.approved"/"approval.rejected"` → `"approval.decided"` in approvals.ts, `"cost.reported"` → `"cost_event.created"` in costs.ts. Add `logActivity` calls for `agent.run.failed` in heartbeat.ts.

Option C (builder workaround, no upstream change): Subscribe to the 3 working typed events (`issue.created`, `issue.updated`, `approval.created`). Accept that comment_added, approval decisions, work_product, costs, and run failures are not available until upstream is fixed. Use the stuck-Issue detector for failure coverage.

**The spec's OPEN-ISSUES.md item "Paperclip plugin event names mismatch" is about this exact problem.**

### agent.run.failed specifically (spec called it out as suspect)

Confirmed: `agent.run.failed` is NEVER logged via `logActivity`. `heartbeat.ts` — the service that drives all agent runs — calls `logActivity` with only `"issue.updated"` (x2). There is no `"agent.run.failed"` logActivity call anywhere in the server source. The only run-failure coverage in Phase 1 is the stuck-Issue detector (cron job polling `GET /api/companies/{id}/issues`).

---

## Q7. SDK Features — Kitchen-Sink Reference

All from `packages/plugins/examples/plugin-kitchen-sink-example/`.

### instanceConfigSchema declaration

**File:** `src/manifest.ts:66-130`

```ts
const manifest: PaperclipPluginManifestV1 = {
  ...
  instanceConfigSchema: {
    type: "object",
    properties: {
      showSidebarEntry: { type: "boolean", title: "Show Sidebar Entry", default: true },
      secretRefExample: { type: "string", title: "Secret Reference Example", default: "" },
      allowedCommands: {
        type: "array",
        items: { type: "string", enum: DEFAULT_CONFIG.allowedCommands },
        default: DEFAULT_CONFIG.allowedCommands,
      },
    },
  },
  ...
};
```

Schema is plain JSON Schema (not Zod). Goes in `manifest.ts`, not `worker.ts`.

### ctx.config.get() typed read

**File:** `src/worker.ts:94-99`

```ts
async function getConfig(ctx: PluginContext): Promise<KitchenSinkConfig> {
  const config = await ctx.config.get();
  return {
    ...DEFAULT_CONFIG,
    ...(config as KitchenSinkConfig),
  };
}
```

Pattern: call `ctx.config.get()`, cast to known type, spread defaults. No Zod parse — simple cast. Use at the top of every handler that needs config.

### onConfigChanged callback

**File:** `src/worker.ts:982-989`

```ts
const plugin: PaperclipPlugin = definePlugin({
  ...
  async onConfigChanged(newConfig) {
    pushRecord({
      level: "info",
      source: "config",
      message: "Kitchen Sink config changed",
      data: newConfig,
    });
  },
  ...
});
```

`newConfig` is the updated config object. SDK fires this automatically when the host DB config changes. For discord-fleet: this is where the Discord client should be reinitialized when guild/channel config changes.

### Periodic job registration (cron-style)

**Manifest declaration** (`src/manifest.ts:131-138`):
```ts
jobs: [{
  jobKey: JOB_KEYS.heartbeat,        // e.g. "demo-heartbeat"
  displayName: "Demo Heartbeat",
  description: "Periodic demo job...",
  schedule: "*/15 * * * *",          // cron expression
}],
```

**Handler registration** (`src/worker.ts:929-947`):
```ts
async function registerJobs(ctx: PluginContext): Promise<void> {
  ctx.jobs.register(JOB_KEYS.heartbeat, async (job: PluginJobContext) => {
    const payload = {
      jobKey: job.jobKey,
      runId: job.runId,
      trigger: job.trigger,       // "schedule" | "manual" | "retry"
      scheduledAt: job.scheduledAt,
    };
    await writeInstanceState(ctx, "last-job-run", payload);
    await ctx.metrics.write("jobs.demo_heartbeat", 1, { trigger: job.trigger });
  });
}
```

Two steps: declare in manifest with `schedule` cron string, then register handler in `setup()` via `ctx.jobs.register(jobKey, handler)`.

### State API (PLUGIN_STATE_SCOPE_KINDS)

**File:** `src/worker.ts:102-108`

```ts
async function writeInstanceState(ctx: PluginContext, stateKey: string, value: unknown): Promise<void> {
  await ctx.state.set({ scopeKind: "instance", stateKey }, value);
}

async function readInstanceState<T = unknown>(ctx: PluginContext, stateKey: string): Promise<T | null> {
  return await ctx.state.get({ scopeKind: "instance", stateKey }) as T | null;
}
```

`ScopeKey` shape: `{ scopeKind, scopeId?, namespace?, stateKey }`. Available scope kinds (`constants.ts:634-644`):
```ts
"instance" | "company" | "project" | "project_workspace" | "agent" | "issue" | "goal" | "run"
```

For discord-fleet thread mappings, use `scopeKind: "company"` with `scopeId: companyId` and `stateKey: "thread-mappings"`. For instance-wide state (token age), use `scopeKind: "instance"`.

Full pattern from `worker.ts:421-434`:
```ts
ctx.actions.register("write-scoped-state", async (params) => {
  const input = parseScopeKey(params);  // {scopeKind, scopeId?, stateKey}
  await ctx.state.set(input, value);
  return { ok: true, scope: input, value };
});
```

### Slash command handler

**Not demonstrated in kitchen-sink.** Kitchen-sink uses webhooks and `ctx.actions` (plugin UI bridge calls). Slash commands are a Discord.js concern, not a plugin SDK concern — they're wired in the Discord client inside `setup()`.

For discord-fleet: register slash commands with Discord REST at setup, then handle `interactionCreate` events in the Discord.js client. The plugin SDK provides `ctx.http.fetch` for Discord REST calls (`worker.ts:591-607`), or use discord.js's built-in REST manager (recommended per spec I4 rate limit requirement).

---

## Summary of Actionable Findings for Architect

| # | Finding | Severity | Action required |
|---|---|---|---|
| Q1 | Worker = fork() child of paperclip-server, same container | ✅ confirmed | No separate compose service; rsync + restart is correct deploy |
| Q2 | `ctx.secrets.resolve(ref)` takes flat string, returns value | ✅ confirmed | `boardApiKeySecretRef` in userMappings is exactly this pattern |
| Q3 | Sharding not required until 2,500 guilds | ✅ confirmed | 3 guilds = no sharding needed |
| Q4 | Guild registration = instant; global = up to 1h | ✅ confirmed | Guild-specific for dev; switch to global at production launch |
| Q5 | `PLUGIN_API_VERSION = 1` | ✅ confirmed | Pin `apiVersion: 1` in manifest |
| Q6 | **`activity.logged` catch-all does NOT work** | 🚨 BLOCKER | Only 3 actions reach plugin: `issue.created`, `issue.updated`, `approval.created`. Everything else is silently dropped. See per-action table above. Architect must decide: (A) fix upstream before building, (B) build with known gaps, or (C) hybrid polling fallback |
| Q7 | Kitchen-sink demonstrates 5/6 patterns; no slash command example | ✅ confirmed | Slash commands are Discord.js client concern, not SDK concern |

---

## Files Read

- `runbooks/discord-plugin-handoff.md`
- `packages/plugins/sdk/dist/index.d.ts`
- `packages/plugins/sdk/dist/types.d.ts:320-370`
- `packages/shared/src/constants.ts`
- `server/src/services/plugin-worker-manager.ts:600-660`
- `server/src/services/plugin-loader.ts:220-250`
- `server/src/services/activity-log.ts:1-94` (full file)
- `server/src/services/plugin-event-bus.ts:1-413` (full file)
- `server/src/services/live-events.ts:1-55` (full file)
- `server/src/app.ts` (grep)
- `server/src/routes/approvals.ts:100-160` (approval action strings)
- `server/src/routes/issues.ts` (grep — action strings)
- `server/src/routes/costs.ts` (grep — action strings)
- `server/src/services/heartbeat.ts` (grep — action strings)
- `server/src/services/routines.ts` (grep — action strings)
- `packages/plugins/examples/plugin-kitchen-sink-example/src/worker.ts:1-1052` (full file)
- `packages/plugins/examples/plugin-kitchen-sink-example/src/manifest.ts:1-292` (full file)
