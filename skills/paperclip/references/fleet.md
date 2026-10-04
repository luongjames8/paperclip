# Fleet notes (openclaw-fleet carry)

Fleet-only additions to this skill. They live in this file, not in `SKILL.md` or
`api-reference.md`, because those files feed the runner's capability inventory
(heading ids carry line numbers), so inserting lines there breaks the build.

> **Role disambiguation:** This skill is for **calling the paperclip API as an agent** — checking inbox, updating issue status, delegating work, posting comments. If you need to **design a paperclip workflow** (choose primitives, architect chains, wire agents), use the `paperclip-architect` skill instead.

## openclaw_gateway: bootstrap the API env on non-heartbeat wakes

For cloud adapters (e.g. `openclaw_gateway`), heartbeat wakes bake a load instruction into the wake text — but on non-heartbeat wakes (chat/Discord-driven, command-driven, manual) `PAPERCLIP_API_KEY` and the other core vars are EMPTY. Bootstrap them from the on-disk claim file before any API call. The bootstrap is idempotent — it no-ops when `$PAPERCLIP_API_KEY` is already set (heartbeat wake) and populates from the claim file otherwise:

```bash
if [ -z "${PAPERCLIP_API_KEY:-}" ]; then
  _kf="$PWD/paperclip-claimed-api-key.json"
  if [ ! -f "$_kf" ]; then
    _d="$PWD"
    while [ "$_d" != "/" ]; do
      if [ -f "$_d/paperclip-claimed-api-key.json" ]; then _kf="$_d/paperclip-claimed-api-key.json"; break; fi
      _d="$(dirname "$_d")"
    done
  fi
  export PAPERCLIP_API_KEY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["apiKey"])' "$_kf")"
  export PAPERCLIP_API_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["apiUrl"])' "$_kf")"
  export PAPERCLIP_AGENT_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["agentId"])' "$_kf")"
  export PAPERCLIP_COMPANY_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["companyId"])' "$_kf")"
  # No heartbeat run exists on these wakes; synthesize a traceable run id so the
  # mandatory X-Paperclip-Run-Id header on mutating calls is never empty.
  export PAPERCLIP_RUN_ID="${PAPERCLIP_RUN_ID:-manual-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
fi
```

The claim file at `$WORKSPACE/paperclip-claimed-api-key.json` carries `apiKey`, `apiUrl`, `agentId`, and `companyId` — written there at pair time. Run this block once at the start of any Paperclip-touching action, on every wake type.

## Labels (api-reference supplement)

Labels are **company-level entities** (not free-text strings on the issue). You attach them to an
issue with **`labelIds`** (an array of label UUIDs) on create or update — there is no `labels`
string field on issue create/update. To use a label you must know (or create) its id.

```
# List the company's labels → {id, name, color}
GET /api/companies/:companyId/labels

# Create a label (returns its id) — name 1–48 chars, color a 6-digit hex
POST /api/companies/:companyId/labels
{ "name": "stage:new", "color": "#3b82f6" }

# Attach on create
POST /api/companies/:companyId/issues
{ "title": "…", "labelIds": ["<label-id>"] }

# Set/replace on update (labelIds replaces the whole set)
PATCH /api/issues/:issueId
{ "labelIds": ["<label-id-a>", "<label-id-b>"] }

# Filter issues by a label
GET /api/companies/:companyId/issues?labelId=<label-id>

# Delete a label from the company
DELETE /api/labels/:labelId
```

Issue read responses carry both `labelIds: string[]` and `labels: { id, name, color }[]`. Resolve a
label name to its id via `GET …/labels` before attaching; do **not** pass label names where a
`labelId`/`labelIds` is expected.
