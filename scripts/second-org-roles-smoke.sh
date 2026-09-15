#!/usr/bin/env bash
# second-org-roles-smoke.sh — the per-ROLE day-1 walk of a second org on the hosted project (#618 follow-up).
#
# second-org-smoke.sh proves one Admin can create five core rows. RIS's day one is twelve people in four
# non-Admin roles touching every workflow (OD-RIS-1), and the last two second-tenant classes (#616, #632)
# were only visible from inside a non-seed org. This script signs in as an Admin of a lifecycle=test org,
# creates one member per role THROUGH the app's own write paths (Admin profiles insert, no org_id sent),
# then walks each role's journeys exactly as the app does — REST + RPC, never org_id — asserting every
# write lands in the caller's org and every read/transition answers 2xx. Cleans up after itself.
#
# Env: BASE · ANON · SERVICE (service_role: ONLY to create/delete the throwaway auth users and set their
# passwords) · SMOKE_EMAIL / SMOKE_PASSWORD (the test org's Admin). Exit 0 = all steps passed.
set -uo pipefail
: "${BASE:?}" "${ANON:?}" "${SERVICE:?}" "${SMOKE_EMAIL:?}" "${SMOKE_PASSWORD:?}"
body="${TMPDIR:-/tmp}/rsmoke.body"; fails=0; steps=0; SEED=00000000-0000-0000-0000-000000000001
fail(){ fails=$((fails+1)); echo "✘ [$WHO] $*" >&2; }
ok(){ echo "✓ [$WHO] $*"; }
# ⚑ one retry on a transport stall (code 000): a curl that never got an answer proves nothing about the app.
req(){ local c; c=$(curl -s -4 --max-time 30 -o "$body" -w "%{http_code}" "$@"); [ "$c" = "000" ] && c=$(curl -s -4 --max-time 60 -o "$body" -w "%{http_code}" "$@"); echo "$c"; }
SH=(-H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json")

signin(){ WHO=$1; code=$(req -X POST -H "apikey: $ANON" -H "Content-Type: application/json" \
    "$BASE/auth/v1/token?grant_type=password" -d "{\"email\":\"$2\",\"password\":\"$3\"}")
  [ "$code" = "200" ] || { fail "sign-in $2 → $code $(head -c 200 "$body")"; return 1; }
  JWT=$(jq -r .access_token "$body"); UID_=$(jq -r .user.id "$body")
  H=(-H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -H "Prefer: return=representation"); }

# post <table> <json> [label] → LAST_ID; asserts 201 and org_id == ORG (never the seed literal)
post(){ local t=$1 json=$2 label=${3:-$1}; LAST_ID=""; steps=$((steps+1))
  code=$(req -X POST "${H[@]}" "$BASE/rest/v1/$t" -d "$json")
  if [ "$code" != "201" ]; then fail "$label create → $code: $(head -c 240 "$body")"; return 1; fi
  LAST_ID=$(jq -r '.[0].id // empty' "$body"); local org; org=$(jq -r '.[0].org_id // "n/a"' "$body")
  if [ "$org" = "$SEED" ] || { [ "$org" != "n/a" ] && [ "$org" != "$ORG" ]; }; then fail "$label landed in org $org"; return 1; fi
  ok "$label ($org)"; }
# rpc <name> <json> [label] → asserts 2xx
rpc(){ local n=$1 json=$2 label=${3:-rpc $1}; steps=$((steps+1))
  code=$(req -X POST "${H[@]}" "$BASE/rest/v1/rpc/$n" -d "$json")
  # a transport-stall retry can replay a transition the server already applied — "illegal transition X -> X" is that, not a defect
  if grep -q 'illegal transition \([^-]*\) -> \1$' "$body" 2>/dev/null; then ok "$label (applied on first try)"; return 0; fi
  case $code in 2*) ok "$label"; return 0;; *) fail "$label → $code: $(head -c 240 "$body")"; return 1;; esac; }
# get <path> <min-rows> [label]
get(){ local p=$1 min=$2 label=${3:-GET $1}; steps=$((steps+1))
  code=$(req "${H[@]}" "$BASE/rest/v1/$p")
  n=$(jq 'if type=="array" then length else 1 end' "$body" 2>/dev/null || echo 0)
  if [ "$code" = "200" ] && [ "$n" -ge "$min" ]; then ok "$label ($n rows)"; else fail "$label → $code, $n rows: $(head -c 200 "$body")"; fi; }
patch(){ local t=$1 id=$2 json=$3 label=${4:-patch $1}; steps=$((steps+1))
  code=$(req -X PATCH "${H[@]}" "$BASE/rest/v1/$t?id=eq.$id" -d "$json")
  if [ "$code" = "200" ] && [ "$(jq length "$body")" = "1" ]; then ok "$label"; else fail "$label → $code: $(head -c 200 "$body")"; fi; }
del(){ local t=$1 id=$2; [ -n "$id" ] || return 0; steps=$((steps+1))
  code=$(req -X DELETE "${H[@]}" "$BASE/rest/v1/$t?id=eq.$id")
  [ "$code" = "200" ] && [ "$(jq length "$body")" = "1" ] || fail "delete $t/$id → $code $(head -c 160 "$body")"; }

tag="rsmoke-$(date +%s)"
# ── Admin ───────────────────────────────────────────────────────────────────────────────────────
signin Admin "$SMOKE_EMAIL" "$SMOKE_PASSWORD" || exit 1
ADMIN=$UID_
ORG=$(req "${H[@]}" "$BASE/rest/v1/profiles?id=eq.$ADMIN&select=org_id" >/dev/null; jq -r '.[0].org_id' "$body")
[ "$ORG" != "$SEED" ] && [ -n "$ORG" ] || { echo "Admin is in the seed org — wrong user" >&2; exit 1; }
echo "org $ORG"

# throwaway auth users (service role — the only service-role use), then profiles via the Admin's OWN RLS path
# Standing role fixtures (created once, never deleted — an approved timesheet is a permanent record and
# authenticated holds no DELETE on timesheets, so their author cannot be removed). Password rotated per run
# via the GoTrue admin API (service role — its only use here) and never stored. The Engineer reports to the
# PM (manager_id) because the approvals authority is the assigned manager (OD-TS-5).
# bash 3 (macOS): no associative arrays — one var set per role: <VAR> / <VAR>_EMAIL / <VAR>_PW
mkuser(){ local var=$1 role=$2 slug=$3 manager=${4:-null}; local email="smoke-$slug@example.com" pw="Pw-$(openssl rand -hex 10)" id
  req "${SH[@]}" "$BASE/auth/v1/admin/users?page=1&per_page=1000" >/dev/null
  id=$(jq -r --arg e "$email" '.users[]? | select(.email==$e) | .id' "$body" | head -1)
  if [ -n "$id" ]; then
    code=$(req -X PUT "${SH[@]}" "$BASE/auth/v1/admin/users/$id" -d "{\"password\":\"$pw\"}"); [ "$code" = "200" ] || { fail "rotate $role → $code"; return; }
  else
    code=$(req -X POST "${SH[@]}" "$BASE/auth/v1/admin/users" -d "{\"email\":\"$email\",\"password\":\"$pw\",\"email_confirm\":true}")
    [ "$code" = "200" ] || { fail "auth user $role → $code $(head -c 200 "$body")"; return; }
    id=$(jq -r .id "$body")
    post profiles "{\"id\":\"$id\",\"full_name\":\"smoke $role\",\"email\":\"$email\",\"role\":\"$role\",\"status\":\"active\",\"manager_id\":$manager}" "profile $role"
  fi
  eval "$var=$id; ${var}_EMAIL=$email; ${var}_PW=$pw"
  get "profiles?id=eq.$id&select=id,org_id,role,status" 1 "$role profile"
  [ "$(jq -r '.[0].org_id' "$body")" = "$ORG" ] && [ "$(jq -r '.[0].status' "$body")" = active ] || fail "$role profile wrong org/status: $(jq -c . "$body")"; }
PM=; ENG=; FIN=; EXEC=
mkuser PM "Project Manager" pm; mkuser ENG Engineer engineer "\"$PM\""; mkuser FIN Finance finance; mkuser EXEC Executive executive

post companies "{\"name\":\"$tag client\",\"type\":\"Client\"}" client; CLIENT=$LAST_ID
post companies "{\"name\":\"$tag vendor\",\"type\":\"Vendor\"}" vendor; VENDOR=$LAST_ID
post contacts "{\"company_id\":\"$CLIENT\",\"full_name\":\"$tag contact\"}"; CONTACT=$LAST_ID
post projects "{\"name\":\"$tag lead\",\"status\":\"Leads\",\"client_id\":\"$CLIENT\",\"project_manager_id\":\"$PM\"}" "project (Leads)"; LEAD=$LAST_ID
post projects "{\"name\":\"$tag deal\",\"status\":\"Leads\",\"client_id\":\"$CLIENT\",\"project_manager_id\":\"$PM\",\"currency\":\"IDR\"}" "project (to be won)"; PROJ=$LAST_ID
rpc set_project_contract_value "{\"p_id\":\"$PROJ\",\"p_value\":100000000,\"p_tax_treatment\":\"exclusive\",\"p_tax_amount\":0,\"p_tax_rate\":null,\"p_tax_template\":null}" "contract value witnessed by Admin"
post user_views "{\"user_id\":\"$ADMIN\",\"name\":\"$tag view\",\"spec\":{}}" "saved view"; VIEW=$LAST_ID
get "profiles?select=id,role&org_id=eq.$ORG" 5 "team list"

# ── Project Manager ─────────────────────────────────────────────────────────────────────────────
signin "Project Manager" "$PM_EMAIL" "$PM_PW" && {
rpc transition_project "{\"p_id\":\"$LEAD\",\"p_to\":\"PQ Submitted\"}" "pipeline Leads→PQ"
rpc transition_project "{\"p_id\":\"$PROJ\",\"p_to\":\"PQ Submitted\"}" "deal →PQ"
rpc transition_project "{\"p_id\":\"$PROJ\",\"p_to\":\"Quotation Submitted\"}" "deal →Quotation"
rpc transition_project "{\"p_id\":\"$PROJ\",\"p_to\":\"Won, Pending KoM\",\"p_customer_contract_ref\":\"$tag/PO\",\"p_contract_date\":\"2026-09-11\"}" "deal WON (PM wins what Admin valued)"
rpc transition_project "{\"p_id\":\"$PROJ\",\"p_to\":\"Ongoing Project\"}" "deal →Ongoing"
post work_orders "{\"project_id\":\"$PROJ\",\"title\":\"$tag WO\",\"order_value\":25000000,\"currency\":\"IDR\",\"tax_treatment\":\"exclusive\",\"tax_amount\":0}" "work order"; WO=$LAST_ID
WO_VALUE_BY_ADMIN=1  # SoD: whoever set the value cannot issue — the Admin confirms it below, then the PM issues
rpc get_project_drawdown "{\"p_project_id\":\"$PROJ\"}" "drawdown"
post budget_versions "{\"project_id\":\"$PROJ\",\"version\":1,\"name\":\"$tag budget\"}" "budget version"; BV=$LAST_ID
post budget_line_items "{\"budget_version_id\":\"$BV\",\"category\":\"Labor\",\"description\":\"$tag line\",\"budgeted_amount\":5000000}" "budget line"; BL=$LAST_ID
rpc activate_budget_version "{\"version_id\":\"$BV\"}" "budget activate"
rpc get_project_budget "{\"p_project_id\":\"$PROJ\"}" "project budget read"
post project_milestones "{\"project_id\":\"$PROJ\",\"name\":\"$tag ms\",\"target_date\":\"2026-12-31\",\"weight\":1}" milestone; MS=$LAST_ID
post procurements "{\"title\":\"$tag procurement\",\"project_id\":\"$PROJ\",\"vendor_id\":\"$VENDOR\",\"requested_by_id\":\"$PM\",\"total_value\":1500000,\"currency\":\"IDR\"}" procurement; PROC=$LAST_ID
rpc transition_procurement "{\"p_id\":\"$PROC\",\"p_to\":\"Requested\",\"p_notes\":null}" "procurement Requested"
post meetings "{\"title\":\"$tag PM meeting\",\"project_id\":\"$PROJ\",\"occurred_at\":\"2026-09-11T09:00:00Z\"}" meeting; MTG=$LAST_ID
post meeting_attendees "{\"meeting_id\":\"$MTG\",\"profile_id\":\"$ENG\"}" "attendee (engineer)"; ATT=$LAST_ID
patch meetings "$MTG" "{\"notes\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"$tag minutes\"}]}]},\"notes_text\":\"$tag minutes\"}" "minutes saved"
post tasks "{\"name\":\"$tag action\",\"status\":\"To Do\",\"project_id\":\"$PROJ\",\"meeting_id\":\"$MTG\",\"assignee_id\":\"$ENG\"}" "action task from meeting"; T1=$LAST_ID
post tasks "{\"name\":\"$tag subtask\",\"status\":\"To Do\",\"project_id\":\"$PROJ\",\"parent_task_id\":\"$T1\",\"assignee_id\":\"$ENG\"}" "sub-task"; T2=$LAST_ID
post tasks "{\"name\":\"$tag ms task\",\"status\":\"To Do\",\"project_id\":\"$PROJ\",\"milestone_id\":\"$MS\"}" "milestone task"; T3=$LAST_ID
post task_dependencies "{\"task_id\":\"$T3\",\"depends_on_id\":\"$T1\"}" "task dependency"
post project_documents "{\"project_id\":\"$PROJ\",\"category\":\"Report\",\"title\":\"$tag doc\",\"author_id\":\"$PM\"}" "project document"; DOC=$LAST_ID
rpc transition_document_status "{\"p_doc_id\":\"$DOC\",\"p_to\":\"Issued\"}" "document Issued"
post crm_activities "{\"contact_id\":\"$CONTACT\",\"kind\":\"Note\",\"subject\":\"$tag note\"}" "crm activity"; ACT=$LAST_ID
rpc get_projects_delivery "{\"p_ids\":[\"$PROJ\"]}" "delivery read"
}
# ── Engineer ────────────────────────────────────────────────────────────────────────────────────
MON=$(date -v-monday +%F 2>/dev/null || date -d 'last monday' +%F)
signin Engineer "$ENG_EMAIL" "$ENG_PW" && {
get "projects?select=id,name" 1 "sees projects"
get "tasks?select=id&assignee_id=eq.$ENG" 2 "sees own tasks"
patch tasks "$T1" '{"status":"In Progress"}' "own task → In Progress"
get "timesheets?select=week_start_date&user_id=eq.$ENG" 0 "existing timesheets"
used=$(jq -r '.[].week_start_date' "$body"); while echo "$used" | grep -qx "$MON"; do MON=$(date -j -v-7d -f %F "$MON" +%F 2>/dev/null || date -d "$MON -7 days" +%F); done
post timesheets "{\"user_id\":\"$ENG\",\"week_start_date\":\"$MON\"}" "timesheet (week $MON)"; TS=$LAST_ID
rpc save_timesheet_week "{\"p_timesheet_id\":\"$TS\",\"p_week_start_date\":\"$MON\",\"p_upserts\":[{\"project_id\":\"$PROJ\",\"entry_date\":\"$MON\",\"hours\":8,\"notes\":\"$tag\"}],\"p_delete_ids\":[]}" "timesheet entries saved"
get "timesheet_entries?select=id,org_id&timesheet_id=eq.$TS" 1 "entries read back"
[ "$(jq -r '.[0].org_id' "$body")" = "$ORG" ] || fail "timesheet entry landed in $(jq -r '.[0].org_id' "$body")"
rpc transition_timesheet "{\"p_timesheet_id\":\"$TS\",\"p_to\":\"Submitted\",\"p_notes\":null}" "timesheet Submitted"
post incident_reports "{\"incident_date\":\"2026-09-11\",\"type\":\"Near Miss\",\"severity\":\"Low\",\"project_id\":\"$PROJ\",\"description\":\"$tag\",\"reported_by\":\"$ENG\"}" "incident report"; INC=$LAST_ID
post meetings "{\"title\":\"$tag eng meeting\",\"project_id\":\"$PROJ\"}" "engineer meeting"; MTG2=$LAST_ID
post tasks "{\"name\":\"$tag eng task\",\"status\":\"To Do\",\"project_id\":\"$PROJ\",\"assignee_id\":\"$ENG\"}" "engineer task"; T4=$LAST_ID
post notifications "{\"owner_id\":\"$ENG\",\"title\":\"$tag\"}" notification; NOTE=$LAST_ID
rpc can_read_meeting "{\"p_meeting_id\":\"$MTG\"}" "attendee can read PM meeting"; [ "$(cat "$body")" = "true" ] || fail "attendee cannot read the meeting they attend"
del notifications "${NOTE:-}"  # owner-only delete
}
# ── Admin confirms the work-order value (SoD witness), PM then issues ──
signin Admin "$SMOKE_EMAIL" "$SMOKE_PASSWORD" && rpc set_work_order_value "{\"p_id\":\"$WO\",\"p_value\":25000000,\"p_tax_treatment\":\"exclusive\",\"p_tax_amount\":0}" "work order value confirmed by Admin"
# ── Project Manager approves ────────────────────────────────────────────────────────────────────
signin "Project Manager" "$PM_EMAIL" "$PM_PW" && {
rpc transition_work_order "{\"p_id\":\"$WO\",\"p_to\":\"Issued\",\"p_over_commit_ack\":null}" "work order Issued"
get "timesheets?select=id,status&status=eq.Submitted" 1 "approvals queue"
rpc transition_timesheet "{\"p_timesheet_id\":\"$TS\",\"p_to\":\"Approved\",\"p_notes\":null}" "timesheet Approved"
}
# ── Finance ─────────────────────────────────────────────────────────────────────────────────────
signin Finance "$FIN_EMAIL" "$FIN_PW" && {
rpc transition_procurement "{\"p_id\":\"$PROC\",\"p_to\":\"Approved\",\"p_notes\":null}" "procurement Approved"
rpc create_procurement_quotation "{\"p_procurement_id\":\"$PROC\",\"p_vendor_id\":\"$VENDOR\",\"p_total_amount\":1400000,\"p_received_date\":\"2026-09-11\",\"p_import_key\":null,\"p_import_batch_id\":null,\"p_imported_at\":null}" "quotation"; QUOTE=$(jq -r 'if type=="object" then .id else . end' "$body" 2>/dev/null)
post sales_invoices "{\"project_id\":\"$PROJ\",\"customer_id\":\"$CLIENT\",\"amount\":25000000,\"currency\":\"IDR\",\"tax_treatment\":\"exclusive\",\"tax_amount\":0,\"invoice_date\":\"2026-09-11\",\"work_order_id\":\"$WO\"}" "sales invoice"; SI=$LAST_ID
post incoming_payments "{\"customer_id\":\"$CLIENT\",\"sales_invoice_id\":\"$SI\",\"amount\":25000000,\"currency\":\"IDR\",\"date\":\"2026-09-11\"}" "incoming payment"; IP=$LAST_ID
rpc get_finance_budget_review '{}' "finance budget review"
rpc get_budget_push_status "{\"p_project_id\":\"$PROJ\"}" "budget push status"
}
# ── Executive ───────────────────────────────────────────────────────────────────────────────────
signin Executive "$EXEC_EMAIL" "$EXEC_PW" && {
rpc get_executive_dashboard '{}' "executive dashboard"
rpc get_sales_pipeline '{}' "sales pipeline"
rpc get_win_rate '{"p_from":"2026-01-01","p_to":"2026-12-31"}' "win rate"
get "projects?select=id&order=name" 2 "sees projects"
get "work_orders?select=id" 1 "sees work orders"
rpc org_credit_balance "{\"p_org_id\":\"$ORG\"}" "credit balance"
}
# ── Cleanup (Admin) ─────────────────────────────────────────────────────────────────────────────
signin Admin "$SMOKE_EMAIL" "$SMOKE_PASSWORD" && {
# Money + approval records are permanent by design (no DELETE grant on timesheets / work_orders / procurements /
# sales_invoices / incoming_payments; an activated budget is frozen) — they stay in the test org with the project
# that owns them. Everything else is removed.
req -X DELETE "${H[@]}" "$BASE/rest/v1/task_dependencies?task_id=eq.${T3:-none}" >/dev/null
for t in "${T4:-}" "${T3:-}" "${T2:-}" "${T1:-}"; do del tasks "$t"; done
del meeting_attendees "${ATT:-}"; del meetings "${MTG2:-}"; del meetings "${MTG:-}"
del incident_reports "${INC:-}"; del crm_activities "${ACT:-}"
del project_documents "${DOC:-}"; del project_milestones "${MS:-}"
del projects "${LEAD:-}"; del contacts "${CONTACT:-}"; del user_views "${VIEW:-}"
echo "kept (permanent records): project $PROJ · work order $WO · procurement $PROC · timesheet $TS · SI $SI · IP $IP"
}
echo "steps=$steps fails=$fails"; [ "$fails" = 0 ]
