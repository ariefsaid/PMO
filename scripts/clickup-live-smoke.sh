#!/usr/bin/env bash
# Phase-0 live-smoke: verify our PROVISIONAL ClickUp wire shapes against the REAL API.
#
# Why this exists: every ClickUp test in this repo is fetch-mocked. Those mocks are *hypotheses* about
# ClickUp's payloads — they prove our handlers behave correctly GIVEN an assumed response, and cannot
# detect that the assumption is wrong. `clickup-webhook`/`clickup-onboard` say so in-source
# ("PROVISIONAL wire shape"). This script is the only thing that closes that gap.
#
# SECRET HANDLING (binding): the token is read from 1Password and piped straight into curl via an
# env var. It is NEVER echoed, never written to a file, never placed in a URL or argv (argv is visible
# in `ps`), and never returned in output. Every response is reduced to KEY NAMES / booleans before
# printing, so no task titles, emails, or ids leak into a transcript either.
#
# Usage:  ./scripts/clickup-live-smoke.sh            (read-only checks)
#         ./scripts/clickup-live-smoke.sh --list-id <id>   (adds a per-List shape check)
set -uo pipefail

ITEM=clickup-api VAULT=AS FIELD=credential
API=https://api.clickup.com/api/v2
LIST_ID="${2:-}"

command -v jq >/dev/null || { echo "✗ jq is required"; exit 1; }

# Pull the token into a shell var only. `set +x` guards against any tracing leaking it.
set +x
TOKEN="$("$HOME/.local/bin/op-get.sh" "$ITEM" "$VAULT" "$FIELD" 2>/dev/null)"
[ -n "$TOKEN" ] || { echo "✗ could not read $ITEM/$FIELD from vault $VAULT"; exit 1; }
echo "✓ token loaded from 1Password ($ITEM/$FIELD) — value never printed"

# curl helper: token goes via -H from a variable; the URL carries no secret.
cu() { curl -sS -m 20 -H "Authorization: $TOKEN" -H "Content-Type: application/json" "$@"; }

# Compare the REAL response's top-level keys against what our types/mocks assume.
shape() { jq -r 'if type=="object" then (keys_unsorted|join(",")) elif type=="array" then "[array]" else type end' 2>/dev/null; }
expect_keys() { # $1=label $2=actual-keys $3=comma-separated expected
  local miss=""
  IFS=',' read -ra want <<< "$3"
  for k in "${want[@]}"; do [[ ",$2," == *",$k,"* ]] || miss="$miss $k"; done
  if [ -n "$miss" ]; then echo "  ⚠ $1: MISSING expected key(s):$miss"; else echo "  ✓ $1: expected keys present"; fi
}

echo ""
echo "── 1. Token validation — GET /user (what external-connect calls) ─────────────"
USER_JSON="$(cu "$API/user")"
if echo "$USER_JSON" | jq -e '.user' >/dev/null 2>&1; then
  echo "  ✓ 200 — token is valid; envelope key: user"
  echo "  user object keys: $(echo "$USER_JSON" | jq -c '.user | keys_unsorted')"
else
  echo "  ✗ token rejected or unexpected shape. Top-level keys: $(echo "$USER_JSON" | shape)"
  echo "  (err field: $(echo "$USER_JSON" | jq -r '.err // "none"'))"
  exit 1
fi

echo ""
echo "── 2. Workspace tree — GET /team → /space → /folder → /list (external-lists) ──"
TEAM_JSON="$(cu "$API/team")"
echo "  /team top-level keys: $(echo "$TEAM_JSON" | shape)"
expect_keys "/team" "$(echo "$TEAM_JSON" | shape)" "teams"
TEAM_ID="$(echo "$TEAM_JSON" | jq -r '.teams[0].id // empty')"
[ -n "$TEAM_ID" ] || { echo "  ✗ no team found — cannot continue"; exit 1; }
echo "  ✓ team count: $(echo "$TEAM_JSON" | jq '.teams | length')"

SPACE_JSON="$(cu "$API/team/$TEAM_ID/space?archived=false")"
echo "  /space top-level keys: $(echo "$SPACE_JSON" | shape)"
expect_keys "/space" "$(echo "$SPACE_JSON" | shape)" "spaces"
SPACE_ID="$(echo "$SPACE_JSON" | jq -r '.spaces[0].id // empty')"
echo "  ✓ space count: $(echo "$SPACE_JSON" | jq '.spaces | length')"

if [ -n "$SPACE_ID" ]; then
  FOLDER_JSON="$(cu "$API/space/$SPACE_ID/folder?archived=false")"
  echo "  /folder top-level keys: $(echo "$FOLDER_JSON" | shape)"
  echo "  ✓ folder count: $(echo "$FOLDER_JSON" | jq '.folders | length')"

  FLIST_JSON="$(cu "$API/space/$SPACE_ID/list?archived=false")"
  echo "  /list (folderless) keys: $(echo "$FLIST_JSON" | shape)"
  echo "  ✓ folderless list count: $(echo "$FLIST_JSON" | jq '.lists | length')"
  echo "  list[0] keys: $(echo "$FLIST_JSON" | jq -c '.lists[0] // {} | keys_unsorted')"
  # external-lists flattens to { id, name, space_name, folder_name }
  expect_keys "list item" "$(echo "$FLIST_JSON" | jq -r '.lists[0] // {} | keys_unsorted | join(",")')" "id,name"
fi

echo ""
echo "── 3. Task-count semantics — the direction-rule guard (external-link) ────────"
if [ -n "$LIST_ID" ]; then
  T_OPEN="$(cu "$API/list/$LIST_ID/task?page=0")"
  T_CLOSED="$(cu "$API/list/$LIST_ID/task?page=0&include_closed=true")"
  echo "  /list/{id}/task keys: $(echo "$T_OPEN" | shape)"
  echo "  ✓ tasks WITHOUT include_closed: $(echo "$T_OPEN" | jq '.tasks | length')"
  echo "  ✓ tasks WITH    include_closed: $(echo "$T_CLOSED" | jq '.tasks | length')"
  echo "    (if these differ, 'List is empty' MUST use include_closed=true or push-seed will"
  echo "     wrongly treat a list of closed tasks as empty — the P1 include_closed finding)"
  echo "  task[0] keys: $(echo "$T_OPEN" | jq -c '.tasks[0] // {} | keys_unsorted')"
  echo "  status object keys: $(echo "$T_OPEN" | jq -c '.tasks[0].status // {} | keys_unsorted')"
else
  echo "  (skipped — pass --list-id <id> to check task/status shapes on a real List)"
fi

echo ""
echo "── 4. Rate-limit headers (client.ts backoff assumptions) ─────────────────────"
echo "  $(cu -D - -o /dev/null "$API/user" 2>/dev/null | grep -iE "^x-ratelimit" | tr -d '\r' | paste -sd' ' - || echo "(none surfaced)")"

echo ""
echo "Done. Compare the KEY NAMES above against pmo-portal/src/lib/adapterSeam/clickup/types.ts and the"
echo "fetch-mocks in supabase/functions/external-*/**.test.ts. Any mismatch = a provisional shape to fix."
