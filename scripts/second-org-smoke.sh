#!/usr/bin/env bash
# second-org-smoke.sh — #623 (map #618): the post-deploy smoke that would have caught #616.
#
# Signs in as a SECOND-org user (never the seed org — that is where the wrong default is the right
# value) and, through the public REST surface exactly as the app does — NO org_id sent — creates one
# row per core entity, reads it back, and deletes it. Every step must be 2xx and the read must return
# the row; anything else is a second-tenant regression. Run it after EVERY prod push, right after
# scripts/isolation-probe.sh.
#
# Inputs (env): BASE (https://<ref>.supabase.co) · ANON (anon key) · SMOKE_EMAIL / SMOKE_PASSWORD
# (an Admin of a lifecycle=test org on that project; never a real client's user).
# Exit 0 = all steps passed; 1 = at least one failed (each failure printed).
set -uo pipefail
: "${BASE:?}" "${ANON:?}" "${SMOKE_EMAIL:?}" "${SMOKE_PASSWORD:?}"
body="${TMPDIR:-/tmp}/smoke.body"; fails=0; steps=0
fail(){ fails=$((fails+1)); echo "✘ $*" >&2; }
req(){ curl -s -o "$body" -w "%{http_code}" "$@"; }

# 1. sign in
code=$(req -X POST -H "apikey: $ANON" -H "Content-Type: application/json" \
  "$BASE/auth/v1/token?grant_type=password" -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}")
[ "$code" = "200" ] || { echo "sign-in failed ($code)" >&2; exit 1; }
JWT=$(jq -r .access_token "$body"); UID_=$(jq -r .user.id "$body")
H=(-H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -H "Prefer: return=representation")

# create <table> <json> -> sets LAST_ID ('' on failure); checks 201 + the row is readable by id.
# Not $(…): a subshell would drop the step/fail counters and let a failed create pass silently.
create(){ local t=$1 json=$2; LAST_ID=""
  steps=$((steps+1)); code=$(req -X POST "${H[@]}" "$BASE/rest/v1/$t" -d "$json")
  if [ "$code" != "201" ]; then fail "create $t → $code: $(head -c 200 "$body")"; return; fi
  LAST_ID=$(jq -r '.[0].id' "$body")
  steps=$((steps+1)); code=$(req "${H[@]}" "$BASE/rest/v1/$t?id=eq.$LAST_ID&select=id,org_id")
  [ "$code" = "200" ] && [ "$(jq length "$body")" = "1" ] || fail "read-back $t/$LAST_ID → $code, $(jq -c . "$body" 2>/dev/null | head -c 120)"
}
del(){ local t=$1 id=$2; [ -n "$id" ] || return
  steps=$((steps+1)); code=$(req -X DELETE "${H[@]}" "$BASE/rest/v1/$t?id=eq.$id")
  [ "$code" = "200" ] && [ "$(jq length "$body")" = "1" ] || fail "delete $t/$id → $code"
}

tag="smoke-$(date +%s)"
create companies "{\"name\":\"$tag co\",\"type\":\"Client\"}"; CO=$LAST_ID
create projects  "{\"name\":\"$tag project\",\"status\":\"Leads\",\"client_id\":\"$CO\",\"project_manager_id\":\"$UID_\"}"; PR=$LAST_ID
create contacts  "{\"company_id\":\"$CO\",\"full_name\":\"$tag contact\"}"; CT=$LAST_ID
create meetings  "{\"title\":\"$tag meeting\",\"project_id\":\"$PR\"}"; MT=$LAST_ID
create tasks     "{\"name\":\"$tag task\",\"status\":\"To Do\",\"project_id\":\"$PR\"}"; TK=$LAST_ID
# org of every created row must be the caller's org, never the seed literal
for pair in "companies:$CO" "projects:$PR" "contacts:$CT" "meetings:$MT" "tasks:$TK"; do t=${pair%%:*}; id=${pair#*:}; [ -n "$id" ] || continue
  steps=$((steps+1)); code=$(req "${H[@]}" "$BASE/rest/v1/$t?id=eq.$id&select=org_id")
  [ "$(jq -r '.[0].org_id' "$body")" != "00000000-0000-0000-0000-000000000001" ] || fail "$t/$id landed in the SEED org"
done
del tasks "$TK"; del meetings "$MT"; del contacts "$CT"; del projects "$PR"; del companies "$CO"

echo "second-org smoke: $steps steps, $fails failed"
[ "$fails" = 0 ]
