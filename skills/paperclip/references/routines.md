# Paperclip Routines — Deep-Dive Reference

> **Production status (2026-04-28):** Routines are a paperclip primitive in the server source with documented API endpoints. The 16 upstream company templates in `paperclip-companies/` do not include any `.paperclip.yaml` that demonstrates a Routine in production — meaning there's no battle-tested example to copy verbatim. Use Routines deliberately by reading the server source for exact config schema; expect to discover some behaviors empirically that aren't documented in templates. **Recommended over host crontab** for any new paperclip-wrapped scheduled work because the schedule lives in the paperclip DB (audit trail + heartbeat integration + `concurrencyPolicy` + `catchUpPolicy`) instead of an unmanaged host file.

> **Sources:** server source code, DB schema, shared constants, validators, API docs, web research (2026-04-29). File:line citations are against paperclip HEAD `40782f70`.

> **For workflow design decisions** (when to use a Routine vs other primitives, how to architect chains): see `paperclip-architect` skill.

---

## When to use Routines vs alternatives

| Use case | Right primitive | Why |
|---|---|---|
| Recurring schedule (cron expression) | Routine + Trigger(kind=schedule) | Native cadence, visible in UI, audit trail, concurrency policy |
| External system pushes events to paperclip | Routine + Trigger(kind=webhook) | Native HTTPS endpoint with optional signing |
| Programmatic/manual fire from another agent | Routine + Trigger(kind=api) OR `POST /api/routines/{id}/run` | Both work; `/run` is one-shot manual |
| Pure script (no LLM, no Issue) | Host cron OR openclaw shell cron | Routine is overkill if no Issue is created |
| One-off task | Just create an Issue directly | Routine is for *recurring* templates |

Rule of thumb: if the work produces an Issue (and an agent picks it up), use a Routine. If the work is a side-effect (cleanup, refresh, notification), a plain cron is fine.

---

## 1. What a Routine Is

A **Routine** is a recurring task configuration. When triggered it creates a standard Issue assigned to a specific agent. The agent then picks up that Issue on its next heartbeat (or immediately, because dispatch calls `queueIssueAssignmentWakeup` inline).

Three entities work together:

```
routines         — the configuration (schedule, agent, template, policies)
routine_triggers — one or more fire sources per routine (schedule cron / webhook URL / manual-api)
routine_runs     — one record per firing event, tracking its outcome
```

Relationship:
- One Routine → 0..N Triggers (can have multiple triggers of different kinds)
- One Trigger firing → one RoutineRun record
- One RoutineRun (if not coalesced/skipped) → one Issue
- Issue lifecycle feeds back into RoutineRun status

The Issue created by a Routine has `originKind = "routine_execution"` and `originId = routineId`.
(source: `server/src/services/routines.ts:785-786`)

---

## 2. Schema — Complete Field Reference

### 2a. `routines` table
(source: `packages/db/src/schema/routines.ts:20-50`)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid | random | Primary key |
| `companyId` | uuid | — | FK companies, cascade delete |
| `projectId` | uuid | null | FK projects, cascade delete; optional |
| `goalId` | uuid | null | FK goals, set-null on goal delete |
| `parentIssueId` | uuid | null | FK issues; created Issues will have this as parent |
| `title` | text | — | Required; `{{variable_name}}` tokens allowed |
| `description` | text | null | Optional; `{{variable_name}}` tokens allowed |
| `assigneeAgentId` | uuid | null | Required at activation; FK agents |
| `priority` | text | `"medium"` | `critical`, `high`, `medium`, `low` |
| `status` | text | `"active"` | `active`, `paused`, `archived` |
| `concurrencyPolicy` | text | `"coalesce_if_active"` | See §4 |
| `catchUpPolicy` | text | `"skip_missed"` | See §5 |
| `variables` | jsonb | `[]` | Array of `RoutineVariable` objects |
| `createdByAgentId` | uuid | null | Audit |
| `createdByUserId` | text | null | Audit |
| `updatedByAgentId` | uuid | null | Audit |
| `updatedByUserId` | text | null | Audit |
| `lastTriggeredAt` | timestamp | null | Updated on each fire |
| `lastEnqueuedAt` | timestamp | null | Updated when issue successfully created |
| `createdAt` | timestamp | now() | — |
| `updatedAt` | timestamp | now() | — |

**Routine status lifecycle:**
```
active → paused → active
       → archived        (CANNOT reactivate)
```
(source: `docs/api/routines.md:194-201`)

A routine without an `assigneeAgentId` is created in a draft status and will not fire until an agent is assigned.
(source: `server/src/services/routines.ts:1069` — `normalizeDraftRoutineStatus`)

### 2b. `routine_triggers` table
(source: `packages/db/src/schema/routines.ts:52-85`)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid | random | Primary key |
| `companyId` | uuid | — | FK companies, cascade delete |
| `routineId` | uuid | — | FK routines, cascade delete |
| `kind` | text | — | `schedule`, `webhook`, `api` |
| `label` | text | null | Human-readable name for the trigger |
| `enabled` | boolean | `true` | Disabled triggers do not fire |
| `cronExpression` | text | null | schedule kind only |
| `timezone` | text | null | schedule kind only; defaults to `"UTC"` |
| `nextRunAt` | timestamp | null | Next scheduled fire time; updated after each tick |
| `lastFiredAt` | timestamp | null | Set on each successful fire |
| `publicId` | text | null | webhook kind only; forms the public fire URL |
| `secretId` | uuid | null | FK company_secrets; used for signing verification |
| `signingMode` | text | null | webhook kind only: `bearer`, `hmac_sha256`, `github_hmac`, `none` |
| `replayWindowSec` | integer | null | webhook replay protection window; min 30, max 86400, default 300 |
| `lastRotatedAt` | timestamp | null | Set when secret rotated |
| `lastResult` | text | null | Outcome string from last fire |

### 2c. `routine_runs` table
(source: `packages/db/src/schema/routines.ts:87-112`)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid | random | Primary key |
| `companyId` | uuid | — | FK companies, cascade delete |
| `routineId` | uuid | — | FK routines, cascade delete |
| `triggerId` | uuid | null | FK routine_triggers, set-null |
| `source` | text | — | `schedule`, `manual`, `api`, `webhook` |
| `status` | text | `"received"` | See run status lifecycle below |
| `triggeredAt` | timestamp | now() | When the fire event arrived |
| `idempotencyKey` | text | null | Dedup key; same key+triggerId = same run |
| `triggerPayload` | jsonb | null | Inbound webhook/api payload |
| `linkedIssueId` | uuid | null | Issue created (or coalesced-into issue) |
| `coalescedIntoRunId` | uuid | null | For coalesced runs: the run they merged into |
| `failureReason` | text | null | Error message on failure |
| `completedAt` | timestamp | null | Set when run reaches terminal status |

**Run status lifecycle:**
(source: `packages/shared/src/constants.ts:189-196`)
```
received → issue_created  (Issue created, agent wakeup queued)
         → coalesced      (active issue exists, policy = coalesce_if_active)
         → skipped        (active issue exists, policy = skip_if_active)
         → failed         (issue creation failed OR linked issue blocked/cancelled)

issue_created → completed (linked issue reaches "done")
             → failed     (linked issue reaches "blocked" or "cancelled")
```
(source: `server/src/services/routines.ts:1555-1581` — `syncRunStatusForIssue`)

---

## 3. API Endpoints

All endpoints require `Authorization: Bearer $PAPERCLIP_API_KEY`.
(source: `docs/api/routines.md`)

### Create Routine
```bash
POST /api/companies/{companyId}/routines
{
  "title": "Weekly content batch for {{date}}",
  "description": "Select articles, atomize posts, write posts-batch-{{date}}.md",
  "assigneeAgentId": "<agent-id>",
  "projectId": "<project-id>",
  "goalId": "<goal-id>",
  "parentIssueId": null,
  "priority": "medium",
  "status": "active",
  "concurrencyPolicy": "coalesce_if_active",
  "catchUpPolicy": "skip_missed"
}
```

**`projectId` is noted as required in the API docs example but the validator marks it `optional().nullable()`.** In practice omitting it is accepted.
(source: `packages/shared/src/validators/routine.ts` — `createRoutineSchema`)

**Agents can only create routines assigned to themselves.** Board operators can assign to any agent.
(source: `docs/api/routines.md:41`)

### List Routines
```
GET /api/companies/{companyId}/routines
```

### Get Routine (detail)
```
GET /api/routines/{routineId}
```
Returns routine + triggers + recent 25 runs + active issue.

### Update Routine
```bash
PATCH /api/routines/{routineId}
{ "status": "paused" }
```
All create fields are updatable. **Agents cannot reassign a routine to another agent.**
(source: `docs/api/routines.md:82`)

### Add Trigger — Schedule
```bash
POST /api/routines/{routineId}/triggers
{
  "kind": "schedule",
  "cronExpression": "0 5 * * 6",
  "timezone": "Asia/Tokyo"
}
```

### Add Trigger — Webhook
```bash
POST /api/routines/{routineId}/triggers
{
  "kind": "webhook",
  "signingMode": "github_hmac",
  "replayWindowSec": 300
}
```
Response includes `webhookUrl` and `webhookSecret` — save the secret, it is shown only once.

### Add Trigger — API (manual only)
```bash
POST /api/routines/{routineId}/triggers
{ "kind": "api" }
```

### Update / Delete Trigger
```
PATCH /api/routine-triggers/{triggerId}
DELETE /api/routine-triggers/{triggerId}
```

### Rotate Webhook Secret
```
POST /api/routine-triggers/{triggerId}/rotate-secret
```
Previous secret is **immediately invalidated**.

### Manual Run
```bash
POST /api/routines/{routineId}/run
{
  "source": "manual",
  "triggerId": "<optional-trigger-id>",
  "idempotencyKey": "my-unique-key",
  "payload": { "context": "manual invocation from cron fallback" }
}
```
Concurrency policy still applies. Use this as the fallback if cron expressiveness is insufficient.
(source: `docs/api/routines.md:148-162`)

### Fire Public Webhook Trigger
```
POST /api/routine-triggers/public/{publicId}/fire
```
Requires `Authorization: Bearer <secret>` (bearer mode) or `X-Paperclip-Signature` + `X-Paperclip-Timestamp` (hmac modes).

### List Runs (history)
```
GET /api/routines/{routineId}/runs?limit=50
```
Default: 50. Max: 200. Returns array of `RoutineRunSummary` with linked issue details.
(source: `server/src/services/routines.ts:1419-1420`)

---

## 4. concurrencyPolicy Values

(source: `packages/shared/src/constants.ts:174` + `docs/api/routines.md:58-65` + `server/src/services/routines.ts:756`)

| Value | Behavior when fired while previous run's Issue is still open |
|---|---|
| `coalesce_if_active` (**default**) | New run immediately set to `coalesced`, linked to active issue. No new Issue created. |
| `skip_if_active` | New run immediately set to `skipped`, linked to active issue. No new Issue created. |
| `always_enqueue` | Always create a new Issue, even if previous Issue is still open. |

**When to use each:**

- `coalesce_if_active` (default): correct for almost all content and reporting workflows. "If last week's batch isn't done yet, this week's trigger links to it rather than creating a second one." The coalesced run record exists in history for audit, but the agent works one Issue at a time.

- `skip_if_active`: use when "if it's already running, skip this one entirely" is the right semantics. Example: a 30-minute heartbeat on an agent that sometimes takes 45 minutes — you want to skip rather than queue a pile.

- `always_enqueue`: use only when each firing is genuinely independent and parallel execution is safe. Example: event-driven webhook where each webhook payload is a distinct item to process and items don't conflict.

**How "active" is defined:**
(source: `server/src/services/routines.ts:46-48, 473-546`)
An issue is "active" if:
1. `originKind = "routine_execution"` AND `originId = routineId`
2. Issue status is in `["backlog", "todo", "in_progress", "in_review", "blocked"]`
3. A heartbeat run with status `queued` or `running` references this issue

---

## 5. catchUpPolicy Values

(source: `packages/shared/src/constants.ts:177` + `server/src/services/routines.ts:1515-1523`)

| Value | Behavior when server was down and scheduled fires were missed |
|---|---|
| `skip_missed` (**default**) | Missed fires are dropped. Next fire is at the next upcoming cron tick. |
| `enqueue_missed_with_cap` | Missed fires are enqueued up to `MAX_CATCH_UP_RUNS = 25`. |

**When to use each:**

- `skip_missed` (default): correct for almost all workflows. If the server was down over the weekend, you don't want 48 hourly runs to fire at once on restart.

- `enqueue_missed_with_cap`: use for critical workflows where missed runs represent real work that must be processed (e.g., each scheduled fire consumes a batch of incoming records). Cap is 25 — if more than 25 runs were missed, only the 25 oldest are enqueued.

**How catch-up works internally:**
(source: `server/src/services/routines.ts:1515-1523`)
```
cursor = trigger.nextRunAt  (the oldest missed time)
runCount = 0
while cursor <= now AND runCount < 25:
    runCount += 1
    claimedNextRunAt = nextCronTickInTimeZone(cronExpr, tz, cursor)
    cursor = claimedNextRunAt
→ dispatch runCount separate runs
```

---

## 6. Trigger Types — Full Schema

### schedule trigger

Fields: `kind: "schedule"`, `cronExpression`, `timezone`

- `cronExpression`: standard 5-field cron (`minute hour dom month dow`). Validated with internal `validateCron()`. (source: `server/src/services/routines.ts:1173`)
- `timezone`: any IANA timezone string (e.g., `"Asia/Tokyo"`, `"America/New_York"`, `"UTC"`). Validated with `Intl.DateTimeFormat`. (source: `server/src/services/routines.ts:62-68`)
- Cron tick computation is timezone-aware: scheduler compares local time in the specified timezone, not UTC. (source: `server/src/services/routines.ts:76-112`)
- `nextRunAt` is computed immediately on trigger creation and updated after each tick.

**Variable constraint on schedule triggers:** If a routine with a schedule trigger has required variables with no default value, activating the schedule fails. All required variables must have a `defaultValue` set when used with a schedule trigger. (source: `server/src/services/routines.ts:1169` — `assertScheduleCompatibleVariables`)

### webhook trigger

Fields: `kind: "webhook"`, `signingMode`, `replayWindowSec`

**Signing modes** (source: `packages/shared/src/constants.ts:183`):

| Mode | How it works | When to use |
|---|---|---|
| `bearer` | `Authorization: Bearer <secret>` header compared via `timingSafeEqual` | Simple external callers, internal cron fallbacks |
| `hmac_sha256` | `X-Paperclip-Signature: <hex>` + `X-Paperclip-Timestamp: <ms-epoch>` | Standard HMAC webhook callers |
| `github_hmac` | `X-Hub-Signature-256: sha256=<hex>` + `X-Paperclip-Timestamp` | GitHub webhooks, Sentry webhooks (added to fix GH issue #1892) |
| `none` | No authentication required | Internal networks only — never expose publicly |

**HMAC signature construction** (source: `server/src/services/routines.ts:1395-1403`):
```
HMAC-SHA256(secret, "<timestamp>.<raw_body>")
```
Timestamp can be millisecond epoch (numeric) or ISO 8601; server normalizes both.

`replayWindowSec`: window within which timestamp+signature is valid. Default 300s (5 min), min 30s, max 86400s (24h).
(source: `packages/shared/src/validators/routine.ts`)

**Public fire URL format:**
```
<PAPERCLIP_API_URL>/api/routine-triggers/public/<publicId>/fire
```
`publicId` is a 24-char hex string generated on trigger creation.
(source: `server/src/services/routines.ts:1178`)

### api trigger

Fields: `kind: "api"` only. No additional configuration.

This trigger type does NOT fire on a schedule or inbound webhook. It is only fired via `POST /api/routines/{routineId}/run`. Use for manual-invoke-only routines (e.g., one-off batch jobs kicked off from a script).

---

## 7. Variable Interpolation

(source: `packages/shared/src/routine-variables.ts`)

**Syntax:** `{{variable_name}}` anywhere in `title` or `description`. Extra whitespace around the name is stripped.

**Built-in variables** (available without declaration):
| Variable | Value | Source |
|---|---|---|
| `{{date}}` | `YYYY-MM-DD` in UTC | `getBuiltinRoutineVariableValues()` |

**Custom variables** are declared in `routines.variables` array:
```json
[
  {
    "name": "week",
    "label": "Week label",
    "type": "text",
    "defaultValue": null,
    "required": true,
    "options": []
  }
]
```

Variable field definitions:
- `name`: `/^[A-Za-z][A-Za-z0-9_]*$/` (must start with letter)
- `type`: `text`, `textarea`, `number`, `boolean`, `select`
- `required`: if `true` and no `defaultValue`, schedule trigger is blocked (must supply value on each manual run or via defaultValue)
- `options`: used for `select` type

**Auto-sync:** When you update the title/description template, the server automatically syncs the `variables` array — new `{{tokens}}` get a default variable definition added; tokens removed from the template remove their variable definitions.
(source: `packages/shared/src/routine-variables.ts:59-66` — `syncRoutineVariablesWithTemplate`)

**Supply variables on manual run:**
```json
POST /api/routines/{routineId}/run
{
  "source": "manual",
  "variables": { "week": "2026-04-28" }
}
```

---

## 8. Recurring Workflow Patterns

### Pattern A: Simple scheduled recurring task

```bash
# Create routine
curl -X POST "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/routines" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Weekly content batch for {{date}}",
    "description": "Select articles, atomize posts, produce posts-batch-{{date}}.md",
    "assigneeAgentId": "'$AGENT_ID'",
    "priority": "medium",
    "concurrencyPolicy": "coalesce_if_active",
    "catchUpPolicy": "skip_missed"
  }'

# Add schedule trigger
curl -X POST "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID/triggers" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "schedule",
    "cronExpression": "0 5 * * 6",
    "timezone": "Asia/Tokyo"
  }'
```

### Pattern B: External cron fallback (when cron expressiveness insufficient)

**Port existing crontab:** `0 20 * * 5 /opt/openclaw/scripts/content-batch.sh`

```bash
# Add an api trigger to the routine (for manual-invoke semantics)
curl -X POST "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID/triggers" \
  -d '{"kind":"api"}'

# External crontab calls run endpoint:
0 20 * * 5 curl -sS -X POST "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID/run" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual","idempotencyKey":"weekly-'$(date +\%Y\%W)'"}'
```
(documented pattern: github.com/paperclipai/paperclip/issues/1165)

### Pattern C: Event-driven webhook (GitHub push → content update)

```bash
# Add webhook trigger with github_hmac signing
curl -X POST "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID/triggers" \
  -d '{
    "kind": "webhook",
    "signingMode": "github_hmac",
    "replayWindowSec": 300,
    "label": "GitHub push to main"
  }'
# Response contains webhookUrl + webhookSecret — add to GitHub repo webhook settings
```

### Pattern D: Multi-trigger routine (both schedule AND webhook)

A single routine can have triggers of different kinds. Example: run daily on schedule AND also fire immediately when a GitHub push arrives:

```bash
POST /api/routines/$ROUTINE_ID/triggers  # schedule: "0 9 * * *"
POST /api/routines/$ROUTINE_ID/triggers  # webhook: github_hmac
```

Both fire the same routine; `concurrencyPolicy` applies between them.

---

## 9. Dispatch Internals (How a Routine fires)

**Scheduler tick** (source: `server/src/index.ts` — single `setInterval`):
- Default: **30 seconds** (env: `HEARTBEAT_SCHEDULER_INTERVAL_MS`, min 10s)
- The SAME timer runs heartbeat timers AND routine tick together
- On startup: orphaned runs are reaped, then queued runs are resumed

**`tickScheduledTriggers` flow** (source: `server/src/services/routines.ts:1489-1553`):
1. Query: triggers WHERE kind=schedule AND enabled=true AND routine.status=active AND nextRunAt <= now
2. For each: **optimistic lock** — UPDATE routine_triggers SET nextRunAt=<next> WHERE nextRunAt=<original>
3. If UPDATE returns 0 rows: another process claimed it → skip (prevents double-fire)
4. For `enqueue_missed_with_cap`: count all missed ticks up to MAX_CATCH_UP_RUNS=25

**`dispatchRoutineRun` flow** (source: `server/src/services/routines.ts:709-866`):
1. `SELECT FOR UPDATE` on the routine row — serializes concurrent fires
2. Idempotency check: if (routineId, source, idempotencyKey, triggerId) already exists → return existing run
3. Insert `routine_runs` record with status `"received"`
4. Compute nextRunAt for schedule triggers immediately
5. Call `findLiveExecutionIssue` — checks for open issue with live heartbeat run
6. If active issue found AND policy != `always_enqueue`:
   - policy = `skip_if_active` → set run status `"skipped"`, done
   - policy = `coalesce_if_active` → set run status `"coalesced"`, link to active issue's run, done
7. Otherwise: `issueSvc.create(...)` with `originKind: "routine_execution"`
8. **`queueIssueAssignmentWakeup` called IMMEDIATELY within the transaction** — agent wakes NOW, not on next heartbeat
9. Run status set to `"issue_created"`, linked issue ID stored

**Agent wake timing:** The agent is woken immediately when the routine fires (within the same DB transaction that creates the Issue). There is no extra heartbeat cycle delay.

---

## 10. Gotchas — What Breaks

### G1: Scheduler latency of up to 30 seconds
Routines are not minute-precise. The tick runs every 30s, so actual fire time = cron time ± 0–30s. For time-critical workflows, this is usually fine, but do not design logic that requires sub-30s precision.
(source: `server/src/config.ts:331`)

### G2: Archived routines cannot be reactivated
Once archived, a routine is permanently disabled. `PATCH /api/routines/{id}` with `{"status":"active"}` after archiving throws a 409 conflict.
(source: `server/src/services/routines.ts` — `if (routine.status === "archived") throw conflict(...)`)

### G3: `coalesce_if_active` is the default — second fire silently does nothing
If the previous Issue is still open when the next schedule tick fires, the new run is marked `coalesced` and no new Issue is created. This is correct behavior for weekly content batches, but it means the agent will NOT get a second task until it finishes the first. Check `routine_runs` history if runs appear to be missing.

### G4: Required variables block schedule triggers
If a routine title/description has `{{tokens}}` and those variables are marked `required: true` with no `defaultValue`, adding a schedule trigger will fail. Either set `defaultValue` on all variables or pass values via manual run only.
(source: `server/src/services/routines.ts:1169` — `assertScheduleCompatibleVariables`)

### G5: Heartbeats must be enabled on imported agents
After importing a company template, agent heartbeats are disabled by default. Without heartbeats, the agent's wakeup fires but no heartbeat run executes, so routine Issues sit in queue unprocessed.
(source: documented common pitfall in spin-up-new-company.md)

### G6: `projectId` is required in the API docs example but optional in the validator
The Create Routine API docs show `projectId` as required, but the Zod schema marks it `optional().nullable()`. In practice it can be omitted. If you pass an invalid projectId, you get a 404/422, not silent acceptance.

### G7: Webhook secret shown only once
On trigger creation, `webhookSecret` is returned in the response. It is stored encrypted. If you lose it, use `POST /api/routine-triggers/{triggerId}/rotate-secret` to generate a new one — but rotation immediately invalidates the old secret, so update your external system first.

### G8: `always_enqueue` can pile up Issues
If an agent runs slowly and fires miss it, `always_enqueue` creates a new Issue on every fire regardless. With `skip_missed` (default catchUp) + `coalesce_if_active` (default concurrency) you get at most 1 in-progress Issue at any time. Only use `always_enqueue` when parallel execution is explicitly safe.

### G9: `github_hmac` signing mode uses `X-Hub-Signature-256` header, not `X-Paperclip-Signature`
GitHub and Sentry send `X-Hub-Signature-256: sha256=<hex>`. The `github_hmac` mode reads this header. The generic `hmac_sha256` mode reads `X-Paperclip-Signature` instead. Using the wrong mode causes silent 401 failures.
(source: GitHub Issue #1892; `server/src/services/routines.ts:1340-1404`)

### G10: No upstream templates use Routines
As of 2026-04-29, 0 of 17 upstream `paperclipai/companies` templates include Routine configurations. The companies git log has no commits mentioning "routine", "cron", "schedule", or "trigger". All template workflows use manually assigned Issues or CEO-directed task creation. **Do not expect to import a template and get Routines for free — they must be created manually.**

---

## 11. How to Debug a Routine That Did Not Fire

**Step 1: Check routine status**
```bash
curl -sS "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '.status, .triggers'
```
- `status` must be `"active"` (not `"paused"` or `"archived"`)
- Each trigger `enabled` must be `true`

**Step 2: Check nextRunAt**
```bash
curl -sS "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '.triggers[].nextRunAt'
```
If `nextRunAt` is null or far in the past with no recent `lastFiredAt`, the trigger was never activated or the scheduler missed it.

**Step 3: Check run history**
```bash
curl -sS "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID/runs?limit=20" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '.[] | {status, source, triggeredAt, failureReason}'
```
Look for:
- `"coalesced"` or `"skipped"` — previous Issue was still active; not a bug
- `"failed"` with `failureReason` — issue creation failed; check `failureReason`
- No records at all — scheduler never reached this routine

**Step 4: Check assignee agent**
- Confirm `assigneeAgentId` points to an active (not terminated) agent
- Confirm the agent has heartbeats enabled
- Check if the agent's heartbeat ran after the routine fired: `GET /api/agents/{agentId}/heartbeat-runs`

**Step 5: Check for coalesced run blocking**
If `concurrencyPolicy = "coalesce_if_active"` and runs keep coalescing:
```bash
# Find the active blocking issue
curl -sS "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '.activeIssue'
```
The active issue's status and last update shows if the agent is stuck.

**Step 6: Force a manual run to test**
```bash
curl -sS -X POST "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID/run" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual","idempotencyKey":"debug-'$(date +%s)'"}'
```
Check the returned run status immediately. If `"issue_created"` — dispatch worked. If `"failed"` — read `failureReason`.

---

## 12. Best-Practice Recommendations

**R1: Use `coalesce_if_active` + `skip_missed` (both defaults) for content workflows.**
This gives "run at most one at a time, don't stack up missed runs." Correct for Hinomaru weekly batch, Globalisto content runs, any weekly/daily creative workflow.

**R2: One Routine per recurring deliverable.**
A Routine fires → creates one Issue → agent produces one output. Do not create a Routine for each step inside one workflow. Issue = deliverable, not pipeline step.
(source: porting-existing-workflows.md §Anti-pattern 1)

**R3: Use `{{date}}` in title for natural dedup and searchability.**
Title `"Content batch for {{date}}"` makes each Issue instantly identifiable and prevents confusion when reviewing run history. The built-in `{{date}}` is `YYYY-MM-DD UTC` — always available, no variable declaration needed.

**R4: Do not rely on the schedule trigger for sub-minute timing.**
The scheduler tick is 30s. If you need tight timing, use the external cron fallback pattern (Pattern B) where your existing cron calls `POST /api/routines/{id}/run` directly.

**R5: Use `github_hmac` for GitHub/Sentry webhooks.**
Do not use `hmac_sha256` for GitHub-originated webhooks — they send `X-Hub-Signature-256`, not `X-Paperclip-Signature`. The `github_hmac` mode was specifically added for this. Using the wrong mode causes silent auth failures.

**R6: Keep `assigneeAgentId` set before going to `active`.**
A routine without an assignee is auto-downgraded to draft/inactive status. It will not fire. Set the assignee and confirm status is `"active"` before expecting fires.

**R7: Verify `nextRunAt` after adding a schedule trigger.**
After `POST /api/routines/{id}/triggers`, immediately `GET /api/routines/{id}` and check `triggers[x].nextRunAt`. If it's null or in the past, the cron expression may be invalid or the timezone rejected.

**R8: Never archive a routine you might want to pause.**
Archiving is irreversible. Use `PATCH {"status":"paused"}` to temporarily stop firing, `{"status":"active"}` to resume. Archive only when permanently decommissioning.

**R9: Supply `idempotencyKey` on external cron fallback calls.**
When using the manual-run endpoint from an external cron, include an `idempotencyKey` derived from the scheduled time (e.g., `"weekly-YYYY-WW"`). This prevents duplicate runs if your external cron fires twice.

---

## 13. Open Questions

**Q1: Can variables be passed via webhook payload?**
The source confirms that webhook payloads can include a `variables` key (source: `server/src/services/routines.ts:1412-1414`):
```typescript
variables: isPlainRecord(input.payload) && isPlainRecord(input.payload.variables)
  ? input.payload.variables
  : null
```
So yes — pass `{"variables":{"week":"2026-04-28"}}` in the webhook body. **Not confirmed in API docs; inferred from source only.**

**Q2: Is there a `MAX_CATCH_UP_RUNS` environment variable override?**
The constant `MAX_CATCH_UP_RUNS = 25` is hardcoded in `server/src/services/routines.ts:49`. No env var override found. Confirmed hardcoded cap.

**Q3: Do Routines support `parentIssueId` propagation to child Issues?**
Yes — the `parentIssueId` on the routine row is passed to `issueSvc.create()` as `parentId`. Created Issues will appear as children of the specified parent Issue in the hierarchy. This allows CEO-created "season" Issues to parent all weekly batch Issues.
(source: `server/src/services/routines.ts:779`)

**Q4: What happens if the assignee agent is paused when a Routine fires?**
The Issue is created regardless of agent status. `queueIssueAssignmentWakeup` is called. Whether the agent processes it depends on whether heartbeats are running. A paused agent with no heartbeats will queue the Issue but never execute it until resumed.

**Q5: Does the Paperclip dashboard UI support creating Routines?**
Not confirmed from source or API docs. The `/api/` endpoints work via API. Visual dashboard support for Routines is not documented in any upstream material as of 2026-04-29.
