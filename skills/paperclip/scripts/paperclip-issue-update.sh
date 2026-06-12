#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/paperclip-issue-update.sh [--issue-id ID] [--status STATUS] [--comment TEXT] [--dry-run]

Reads a multiline markdown comment from stdin when stdin is piped. This preserves
newlines when building the JSON payload for PATCH /api/issues/{issueId}.

Examples:
  scripts/paperclip-issue-update.sh --issue-id "$PAPERCLIP_TASK_ID" --status in_progress <<'MD'
  Investigating formatting

  - Pulled the raw comment body
  - Comparing it with the run transcript
  MD

  scripts/paperclip-issue-update.sh --issue-id "$PAPERCLIP_TASK_ID" --status done --dry-run <<'MD'
  Done

  - Fixed the issue update helper
  MD
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

issue_id="${PAPERCLIP_TASK_ID:-}"
status=""
comment_arg=""
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue-id)
      issue_id="${2:-}"
      shift 2
      ;;
    --status)
      status="${2:-}"
      shift 2
      ;;
    --comment)
      comment_arg="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$issue_id" ]]; then
  printf 'Missing issue id. Pass --issue-id or set PAPERCLIP_TASK_ID.\n' >&2
  exit 1
fi

comment=""
if [[ -n "$comment_arg" ]]; then
  comment="$comment_arg"
elif [[ ! -t 0 ]]; then
  comment="$(cat)"
fi

require_command python3

payload="$(
  STATUS="$status" COMMENT="$comment" python3 -c '
import json, os, sys
out = {}
status = os.environ.get("STATUS", "")
comment = os.environ.get("COMMENT", "")
if status:
    out["status"] = status
if comment:
    out["comment"] = comment
sys.stdout.write(json.dumps(out))
'
)"

if [[ "$dry_run" == "1" ]]; then
  printf '%s\n' "$payload"
  exit 0
fi

if [[ -z "${PAPERCLIP_API_URL:-}" || -z "${PAPERCLIP_API_KEY:-}" ]]; then
  printf 'Missing PAPERCLIP_API_URL or PAPERCLIP_API_KEY.\n' >&2
  exit 1
fi

# PAPERCLIP_RUN_ID is set by paperclip's heartbeat runner, but chat/Discord and
# manual wakes don't have one. Synthesize a unique fallback so the
# X-Paperclip-Run-Id header is always present (the audit trail still gets a
# traceable value, just not tied to a heartbeat run).
if [[ -z "${PAPERCLIP_RUN_ID:-}" ]]; then
  PAPERCLIP_RUN_ID="manual-$(date -u +%Y%m%dT%H%M%SZ)-$$"
fi

# --fail-with-body: HTTP 4xx/5xx exits non-zero (so callers notice a rejected
# update) while still printing the error body for diagnosis.
curl -sS --fail-with-body -X PATCH \
  "$PAPERCLIP_API_URL/api/issues/$issue_id" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H 'Content-Type: application/json' \
  --data-binary "$payload"
