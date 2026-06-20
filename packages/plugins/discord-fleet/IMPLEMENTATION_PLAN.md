# discord-fleet Plugin — Phase 1 Implementation Plan

**Authored:** 2026-04-26 by architect (session 9), based on `runbooks/discord-plugin-handoff.md` spec + `RESEARCH_NOTES.md` SDK findings + paperclip-create-plugin skill guidance.

**Audience:** Builder agent (session 10).

---

## 1. Decision log (read first)

### Subscription model: typed events, NOT `activity.logged`

Researcher confirmed (`RESEARCH_NOTES.md` Q6) that the spec's `activity.logged` catch-all does not work. The plugin event bus only forwards events whose action string is literally in `PLUGIN_EVENT_TYPES`. Of the 9 actions the spec wanted in Phase 1, only 3 are reachable:

| Event | Reaches plugin? | Phase 1 v1 source |
|---|---|---|
| `issue.created` | yes | typed event subscription |
| `issue.updated` | yes | typed event subscription |
| `approval.created` | yes | typed event subscription |
| `issue.comment_added` | NO (string mismatch) | **deferred** — see §10 |
| `approval.approved` / `.rejected` | NO (string mismatch — enum has `approval.decided`) | **deferred** |
| `agent.run.failed` | NO (no logActivity call exists) | **deferred** — partial coverage via stuck-Issue detector |
| `issue.work_product_created` | NO (not in enum) | **deferred** |
| `cost.reported` | NO (string mismatch — enum has `cost_event.created`) | **deferred** |

**Strategy: B+upstream.**
- Phase 1 v1 ships using the 3 working events + the periodic safety nets (stuck-Issue detector, routine-health monitor).
- Architect will land a separate one-line upstream patch in `server/src/services/activity-log.ts` to emit a true catch-all `activity.logged` event. Once that ships and fsn redeploys, the plugin can switch its subscription model and pick up the deferred events automatically.
- Existing host scripts (`/opt/paperclip-bridge/digest.py`, `reply_bridge.py`) keep running until both Phase 1 ships AND the upstream patch lands, so operator does not lose comment visibility during the gap.

### Other decisions

- **Worker lifecycle** (Q1): `fork()` child process inside the paperclip-server container. No separate compose service. Deploy = rsync + `docker restart paperclip`.
- **API version** (Q5): `apiVersion: 1` in manifest.
- **Sharding** (Q3): not needed (3 guilds, threshold is 2,500).
- **Slash command registration** (Q4): per-guild during dev (instant). Switch to global at production launch.
- **Secrets** (Q2): `ctx.secrets.resolve(secretRef: string): Promise<string>`. Flat string ref. Slashes in the path string are naming convention only.
- **Discord client**: `discord.js`. Use its built-in REST manager for outbound (handles 429 backoff per route). Do not bypass with parallel `fetch` calls.
- **Config**: SDK-native via `instanceConfigSchema` + `ctx.config.get()` + `onConfigChanged()`. NO YAML, NO chokidar. Operator-side `bin/plugin-config-sync.sh` PATCHes JSON file from openclaw repo into paperclip DB.

---

## 2. Scaffold

Use the scaffold tool — do NOT hand-write boilerplate.

```bash
cd ~/Dropbox/openclaw/paperclip
pnpm --filter @paperclipai/create-paperclip-plugin build
node packages/plugins/create-paperclip-plugin/dist/index.js @openclaw/discord-fleet \
  --output packages/plugins
```

Target output: `packages/plugins/discord-fleet/`. Adjust the package name in `package.json` if the scaffold writes a different folder name; the directory must be `discord-fleet`.

After scaffolding, replace the kitchen-sink starter content with the structure in §3.

---

## 3. File layout

```
packages/plugins/discord-fleet/
├── package.json                    (paperclipPlugin: {manifest, worker})
├── tsconfig.json
├── src/
│   ├── manifest.ts                 (instanceConfigSchema, capabilities, jobs, slash command declarations)
│   ├── worker.ts                   (entry point — wires everything together)
│   ├── config/
│   │   ├── schema.ts               (TypeScript types matching instanceConfigSchema)
│   │   └── validate.ts             (guild-collision check + per-company invariants)
│   ├── discord/
│   │   ├── client.ts               (discord.js Client setup, gateway connect, intent declaration)
│   │   ├── rest.ts                 (REST helpers — uses discord.js REST manager, NOT raw fetch)
│   │   ├── slash.ts                (slash command registration per guild + interactionCreate router)
│   │   └── threads.ts              (thread create / archive recovery / mapping ops)
│   ├── routing/
│   │   ├── route.ts                (companyId → guild, projectId → channel, fallback to orphan)
│   │   └── thread-state.ts         (seedIssueId → threadId state via ctx.state, scopeKind:"company")
│   ├── handlers/
│   │   ├── issue-created.ts        (seed-vs-child detect, embed or plain reply)
│   │   ├── issue-updated.ts        (status emoji + 2s coalescing window)
│   │   └── approval-created.ts     (🟡 embed in thread + record for next digest)
│   ├── jobs/
│   │   ├── digest.ts               (cron job — daily 7am Asia/Taipei per company)
│   │   ├── stuck-detector.ts       (every 30 min — in_progress > stuckThresholdHours)
│   │   └── routine-health.ts       (every 30 min — poll routines, flag missed fires)
│   ├── render/
│   │   ├── embeds.ts               (milestone embed renderer — generic, no per-workflow code)
│   │   ├── plain.ts                (plain-text formatters)
│   │   └── secrets.ts              (regex-based secret stripping; runs on EVERY post body)
│   ├── api/
│   │   └── paperclip.ts            (typed paperclip REST client — ctx.http.fetch wrapper)
│   ├── slash/
│   │   └── status.ts               (/status slash command handler)
│   └── util/
│       ├── coalesce.ts             (2s window per (channelId, issueId) for issue.updated dedupe)
│       └── ratelimit.ts            (200ms per-channel outbound queue)
├── tests/
│   ├── secrets.spec.ts             (8 secret patterns from spec acceptance criterion 8)
│   ├── routing.spec.ts             (projectId mapping, orphan fallback, guild collision)
│   ├── threads.spec.ts             (seed detect, child reply, recovery on 404)
│   ├── digest.spec.ts              (silent-day vs content)
│   └── coalesce.spec.ts            (2s window dedup)
└── README.md
```

Keep modules small and pure where possible. `worker.ts` is glue only; logic lives in `routing/`, `handlers/`, `jobs/`, `render/`.

---

## 4. Phase 1 v1 deliverables (acceptance checklist)

Each item maps to a concrete file or feature. Done = exists + has unit tests where listed.

| # | Deliverable | Tests required |
|---|---|---|
| 1 | Plugin scaffolded via create-paperclip-plugin tool, package name `@openclaw/discord-fleet` | `pnpm typecheck` + `build` clean |
| 2 | `manifest.ts` declares `apiVersion: 1`, `instanceConfigSchema` (per spec §"Configuration model"), 3 jobs (digest, stuck-detector, routine-health), capabilities (`secrets.read-ref`, `http.fetch`, `state.write`, etc.) | manifest validates against SDK type |
| 3 | `worker.ts` `setup()` reads config, validates (collision check), connects discord.js gateway, registers slash commands per guild, subscribes to 3 typed events, registers 3 job handlers | smoke test that setup completes without throw |
| 4 | Event handlers for `issue.created` / `issue.updated` / `approval.created` per spec routing rules | per-handler unit tests with fake event payloads + mock route lookup |
| 5 | Routing: `companyId → guildId` (from config map), `projectId → monitor channel` (per `projectRouting`), fallback to `orphan` channel (mandatory). Errors (failed runs) → `errors` channel. | `routing.spec.ts` covers all 4 paths including orphan |
| 6 | Threading: `{seedIssueId → threadId}` state, scope `company`, persisted via `ctx.state.set/get`. Auto-create thread on seed Issue (`originKind="routine_execution"` OR `parentId=null`). Auto-recover archived threads (PATCH `archived: false`); recreate + remap if deleted. | `threads.spec.ts` |
| 7 | Embed renderer for milestones (`approval.created`, status→blocked) + plain-text for everything else. Hard cap 1900 chars per post + truncate with `…` + link to paperclip web URL. | rendering returns valid Discord embed shape |
| 8 | Secret-stripping regex set, applied to every outbound post body. Patterns from spec criterion 8: paperclip API key (`pcp_...`), GitHub PAT classic (`ghp_...`), GitHub PAT new format (`github_pat_...`), Discord bot token, AWS access key (`AKIA...`), Slack bot token (`xoxb-...`), Bailian (`sk-cp-...` / `sk-sp-...`). Each replaced with `<TYPE>_***` mask. | `secrets.spec.ts` — 1 unit test per pattern |
| 9 | Daily digest job — cron `0 7 * * * Asia/Taipei` per company. Posts ✅ all-clear OR pending-action + errors block. Reads pending approvals from `ctx.state` (recorded by approval.created handler) + queries paperclip API for errors-last-24h. | `digest.spec.ts` — silent vs content paths |
| 10 | Stuck-Issue detector — every 30 min. Polls `GET /api/companies/{id}/issues?status=in_progress`. For each, check last activity timestamp; if > `stuckIssueThresholdHours` AND no agent run activity, post ⚠️ embed to errors channel + thread reply. | mock paperclip response, assert post to errors channel |
| 11 | Routine-health monitor — every 30 min. Polls `GET /api/companies/{id}/routines`. For each enabled schedule trigger, compute expected last fire (cron expression in TZ); if `routine.lastTriggeredAt < expected_last_fire - 1h`, post ⚠️ to errors channel. | mock routines response, assert correct expected-fire calculation |
| 12 | Discord rate-limit handling: discord.js REST manager (built-in 429 backoff), 200ms per-channel queue, 2s coalescing window for consecutive `issue.updated` on same Issue. Log every 429; if 3+ in 5 min on a channel, post ⚠️ to errors channel. | `coalesce.spec.ts` for the 2s dedup |
| 13 | `/status` slash command (read-only, ephemeral response). Returns: company name, count of in-flight Issues, count of pending approvals, count of errors-last-24h. | manual smoke during Stage 2 |
| 14 | Guild-collision check at config load. If two companies share a `guildId`, REFUSE TO START with clear error. | `routing.spec.ts` |
| 15 | `onConfigChanged()` callback — on config change, re-validate (collision check), rebuild route maps, refresh slash command registrations if guildIds changed. Discord client reconnect only if gateway-relevant fields change (bot token rotation). | smoke during Stage 2 |
| 16 | Operator-side `~/Dropbox/openclaw/bin/plugin-config-sync.sh` — reads `~/Dropbox/openclaw/instances/{instance}/config/plugins/discord-fleet.json`, PATCHes paperclip API at `/api/companies/{id}/plugins/discord-fleet/config`. ~30 lines bash + curl. | dry-run flag, exit nonzero on HTTP error |
| 17 | Hinomaru sample config at `~/Dropbox/openclaw/instances/hinomaru/config/plugins/discord-fleet.json` — placeholder channel IDs (operator fills in real ones during deploy). | committed to git |

---

## 5. NOT in Phase 1 v1 (explicitly deferred)

Do not build these in Phase 1. They land in v2 once upstream patch is live, or in Phase 2/3.

- Comment posting (`💬` events on `issue.comment.created`) — deferred to v2 (after upstream patch lands)
- Approval decision posting (`approval.approved`/`approval.rejected` `✅`/`❌`) — deferred to v2
- Agent run failure posting (`agent.run.failed` `❌` to errors channel) — deferred to v2 (stuck-detector covers in v1)
- Work product embeds (`issue.work_product_created` `🚀`) — deferred to v2
- Cost event embeds (`cost.reported` `💰`) — deferred to v2
- Inbound comments (HIN-prefix LLM cleaning, `/details`, `/redo`, `/kill`, `/approve`) — Phase 2 + Phase 3
- userMappings auth enforcement (allowlist) — Phase 3
- Tree-walk descendant cancellation — Phase 3
- Bot token rotation tracking — defer (cosmetic)

---

## 6. Per-handler behavior matrix (Phase 1 v1)

| Event | Where it posts | Format | Notes |
|---|---|---|---|
| `issue.created` (seed: `originKind="routine_execution"` OR `parentId=null`) | New thread in monitor channel for the project | Embed: 🌱 `{identifier}` — title; assignee, project, link to paperclip | Stores `{seedIssueId → {channelId, threadId}}` in state |
| `issue.created` (child: has parent) | Reply in parent's thread (look up via state by walking ancestor chain) | Plain: 🔵 `{identifier}` → assignee — title (50 chars) | If no thread found in ancestor chain, post to orphan channel + log warning |
| `issue.updated` → `in_progress` | Reply in thread | Plain: 🔵 `{identifier}` → in_progress | Coalesce 2s window |
| `issue.updated` → `done` | Reply in thread | Plain: ✅ `{identifier}` → done | |
| `issue.updated` → `blocked` | Reply in thread | Embed: ⛔ `{identifier}` → blocked, reason if available | Embed flag |
| `issue.updated` → other | Reply in thread | Plain: emoji + status | |
| `approval.created` | Embed reply in thread + record approval ID in `ctx.state` for next digest | Embed: 🟡 needs approval — `{type}` (`{approvalId}` short), command hint "use /approve in paperclip web UI" | Phase 1 v1 cannot resolve via Discord — that's Phase 3 |

---

## 7. Validation handoff (what the validator will check in Stage 2)

Builder should self-test these BEFORE handing to validator. Builder must `pnpm test` clean (all unit tests pass) AND `pnpm typecheck` AND `pnpm build` clean before declaring DONE.

Validator's adversarial Phase 1 v1 acceptance criteria (subset of spec's 10 — others deferred):

1. Create an Issue with `projectId` mapped in config → message in correct monitor channel, thread root, identifier in thread name. (Spec criterion 1)
2. Create an Issue with NO `projectId` → message in orphan channel. (Spec implication of orphan rule)
3. Update Issue → `blocked` → embed reply with ⛔ in the thread. (Spec criterion 2 — adapted, no comment trigger)
4. Daily digest at 7am Taipei → silent-day OR content message in digest channel. (Spec criterion 4)
5. Park Issue in `in_progress` 7h ago + trigger stuck-detector → ⚠️ in errors channel. (Spec criterion 6)
6. `/status` → ephemeral response with counts. (Spec criterion 7)
7. Secret stripping for all 8 patterns (Spec criterion 8 — keep this fully).
8. Two projects routing to same monitor channel → both visible with project name. (Spec criterion 9)
9. Routine-health: push `lastTriggeredAt` 25h ago for hourly routine → ⚠️ in errors channel. (Spec criterion 10)
10. Guild collision: configure two companies with same `guildId` → plugin refuses to start with clear error.

Deferred (will land in v2 validation): comment posting (criterion 3), agent.run.failed embed (criterion 5).

---

## 8. Deploy mechanics (Stage 2 prerequisite)

Operator pre-flight items required BEFORE deploy:
1. Shared "Paperclip" Discord bot created in Developer Portal, invited to Hinomaru guild.
2. Bot token saved as paperclip secret `paperclip-discord/bot-token`.
3. Hinomaru channel IDs identified for: digest, orphan, per-project monitors. Errors already chosen: `1497561915696746626`.
4. Paperclip running ≥ v2026.416 on fsn.
5. Hinomaru sample config file populated with real channel IDs (replacing placeholders from §4 item 17).

Deploy steps (architect runs after builder completes):
```bash
cd ~/Dropbox/openclaw/paperclip
pnpm --filter @openclaw/discord-fleet build
rsync -avz --delete --exclude node_modules ~/Dropbox/openclaw/paperclip/ root@openclaw-fsn:/opt/paperclip/
ssh root@openclaw-fsn 'docker restart paperclip'
# Wait for plugin auto-discovery, then install per company:
# (paperclip plugins UI or API to "install" the plugin to Hinomaru company)
~/Dropbox/openclaw/bin/plugin-config-sync.sh discord-fleet hinomaru
```

---

## 9. Upstream patch (parallel architect work — NOT for builder)

Architect will land a separate one-line patch in `server/src/services/activity-log.ts` adding a true catch-all emit:

```ts
// After the existing PLUGIN_EVENT_SET.has() check, add:
if (_pluginEventBus) {
  void _pluginEventBus.emit({
    eventType: "activity.logged" as PluginEventType,
    payload: { action: input.action, ...redactedDetails, agentId, runId },
  });
}
```

Once merged + paperclip redeployed on fsn, plugin v2 swaps subscription model from typed events to `activity.logged` + client-side action-string demux. That unlocks all the deferred handlers in §5.

Builder does NOT need to do this. It is tracked separately.

---

## 10. References

- Spec: `~/Dropbox/openclaw/runbooks/discord-plugin-handoff.md`
- Research findings: `~/Dropbox/openclaw/paperclip/packages/plugins/discord-fleet/RESEARCH_NOTES.md`
- Kitchen-sink reference: `~/Dropbox/openclaw/paperclip/packages/plugins/examples/plugin-kitchen-sink-example/`
- SDK types: `~/Dropbox/openclaw/paperclip/packages/plugins/sdk/dist/types.d.ts`
- PLUGIN_EVENT_TYPES enum: `~/Dropbox/openclaw/paperclip/packages/shared/src/constants.ts:687-712`
- paperclip-create-plugin skill: `~/.claude/skills/paperclip-create-plugin/SKILL.md`
