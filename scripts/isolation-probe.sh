#!/usr/bin/env bash
# isolation-probe.sh — adversarial cross-org probe (#490, DD-TEN-1). Run against a HOSTED project
# (production grant defaults), never only against local Docker: a proof that only runs where the grants
# differ from production certifies nothing (0185 / 0210 / 0211 all found that way).
#
# A real signed-in principal of tenant B attempts, on every table and every org-argument RPC, to read
# tenant A's rows blind, read them by id, update them (no-op PATCH), and to call RPCs with A's org/ids;
# the anon key attempts every table. Any row returned or write accepted is a LEAK and is named.
#
# Inputs (env): BASE (https://<ref>.supabase.co) · ANON (anon key) · JWT_B (access token of a tenant-B
# user) · A_ORG (tenant A org id) · B_ORG (tenant B org id — rows B legitimately owns are not leaks) · TABLES_JSON ([{table,has_org,pk}]) · A_ROWS_JSON ([{table,pk,id}] one
# A row per table) · optional A_PROFILE / A_PROC for the RPC layer. Build the two JSON files from the
# catalog with psql (see docs/environments.md § Prod migration state → isolation probe). Never pass
# keys on the command line; source them from 600 files.
#
# Writes: PATCH bodies set a row's pk to itself (no-op); RPC payloads are inert (status=current, amount 0).
# A leak that accepts a write leaves evidence you must clean up — that is the point.
set -u
: "${BASE:?}" "${ANON:?}" "${JWT_B:?}" "${A_ORG:?}" "${B_ORG:?}" "${TABLES_JSON:?}" "${A_ROWS_JSON:?}"
S="${TMPDIR:-/tmp}"
hdr_b=(-H "apikey: $ANON" -H "Authorization: Bearer $JWT_B" -H "Content-Type: application/json")
hdr_anon=(-H "apikey: $ANON" -H "Authorization: Bearer $ANON")
leaks=0; checks=0
say(){ printf '%s\n' "$*"; }
flag(){ leaks=$((leaks+1)); say "  ⛔ LEAK  $*"; }
req(){ curl -s -o "${TMPDIR:-/tmp}/probe.body" -w "%{http_code}" "$@"; }
if [ "${RPC_ONLY:-}" != 1 ]; then
# --- tables, as B ---
for t in $(jq -r '.[].table' "$TABLES_JSON"); do
  has_org=$(jq -r --arg t "$t" '.[]|select(.table==$t)|.has_org' "$TABLES_JSON"); pk=$(jq -r --arg t "$t" '.[]|select(.table==$t)|.pk' "$TABLES_JSON")
  code=$(req "${hdr_b[@]}" "$BASE/rest/v1/$t?select=*&limit=3"); n=$(jq 'if type=="array" then length else -1 end' "${TMPDIR:-/tmp}/probe.body" 2>/dev/null || echo -1); checks=$((checks+1))
  if [ "$code" = "200" ] && [ "$n" -gt 0 ]; then
    # rows visible to B: allowed only if they are B's own (org_id == B) or the table has no org_id and is a justified global
    if [ "$has_org" = "true" ]; then foreign=$(jq --arg b "$B_ORG" '[.[]|select(.org_id!=$b)]|length' "${TMPDIR:-/tmp}/probe.body"); [ "$foreign" -gt 0 ] && flag "B reads $foreign foreign row(s) from $t (blind select)"; else say "  ℹ  $t (no org_id): B sees $n row(s) — review: $(jq -c '.[0]|keys' "${TMPDIR:-/tmp}/probe.body" | cut -c1-100)"; fi
  elif [ "$code" != "200" ]; then say "  ℹ  $t blind select → HTTP $code"; fi
  # targeted read + no-op update on A's row
  aid=$(jq -r --arg t "$t" '.[]|select(.table==$t)|.id' "$A_ROWS_JSON"); [ -z "$aid" ] || [ "$aid" = "null" ] && continue
  code=$(req "${hdr_b[@]}" "$BASE/rest/v1/$t?$pk=eq.$aid&select=*"); n=$(jq 'if type=="array" then length else -1 end' "${TMPDIR:-/tmp}/probe.body" 2>/dev/null || echo -1); checks=$((checks+1)); [ "$code" = "200" ] && [ "$n" -gt 0 ] && flag "B reads A's row $t/$aid by id"
  code=$(req -X PATCH "${hdr_b[@]}" -H "Prefer: return=representation" "$BASE/rest/v1/$t?$pk=eq.$aid" -d "{\"$pk\":\"$aid\"}"); n=$(jq 'if type=="array" then length else -1 end' "${TMPDIR:-/tmp}/probe.body" 2>/dev/null || echo -1); checks=$((checks+1)); [ "$code" = "200" ] && [ "$n" -gt 0 ] && flag "B UPDATES A's row $t/$aid (no-op update returned $n row)"
done
# --- tables, as anon ---
for t in $(jq -r '.[].table' "$TABLES_JSON"); do code=$(req "${hdr_anon[@]}" "$BASE/rest/v1/$t?select=*&limit=1"); n=$(jq 'if type=="array" then length else -1 end' "${TMPDIR:-/tmp}/probe.body" 2>/dev/null || echo -1); checks=$((checks+1)); [ "$code" = "200" ] && [ "$n" -gt 0 ] && flag "ANON reads $n row(s) from $t"; done
fi
# --- org-arg RPCs as B, with A's org / A's ids ---
A_PROFILE=$(jq -r '.[]|select(.table=="profiles")|.id' "$A_ROWS_JSON"); A_PROC=$(jq -r '.[]|select(.table=="procurements")|.id' "$A_ROWS_JSON")
rpc(){ local fn=$1 body=$2; local code; code=$(req -X POST "${hdr_b[@]}" "$BASE/rest/v1/rpc/$fn" -d "$body"); checks=$((checks+1)); say "  rpc $fn → $code $(head -c 110 "${TMPDIR:-/tmp}/probe.body" | tr '\n' ' ')" >&2; echo "$code"; }
c=$(rpc org_credit_balance "{\"p_org_id\":\"$A_ORG\"}"); [ "$c" = 200 ] && ! grep -q '^null$' "${TMPDIR:-/tmp}/probe.body" && flag "org_credit_balance(A) answered B"
c=$(rpc operator_usage_summary "{\"p_org_id\":\"$A_ORG\"}"); [ "$c" = 200 ] && flag "operator_usage_summary(A) answered a non-operator"
c=$(rpc operator_agent_run_stats "{\"p_org_id\":\"$A_ORG\"}"); [ "$c" = 200 ] && flag "operator_agent_run_stats(A) answered a non-operator"
c=$(rpc operator_list_orgs "{}"); [ "$c" = 200 ] && grep -q "$A_ORG" "${TMPDIR:-/tmp}/probe.body" && flag "operator_list_orgs listed A to a non-operator"
c=$(rpc org_has_member_email "{\"p_org_id\":\"$A_ORG\",\"p_email\":\"admin@acme.test\"}"); [ "$c" = 200 ] && grep -q true "${TMPDIR:-/tmp}/probe.body" && flag "org_has_member_email confirms A's member to B (enumeration)"
c=$(rpc get_process_gates "{\"p_org\":\"$A_ORG\"}"); [ "$c" = 200 ] && ! grep -q '^\(null\|\[\]\)$' "${TMPDIR:-/tmp}/probe.body" && flag "get_process_gates(A) answered B"
c=$(rpc actor_authorization_state "{\"p_org_id\":\"$A_ORG\",\"p_user_id\":\"$A_PROFILE\"}"); [ "$c" = 200 ] && ! grep -q '^null$' "${TMPDIR:-/tmp}/probe.body" && flag "actor_authorization_state(A, A-user) answered B"
c=$(rpc admin_set_user_status "{\"p_profile_id\":\"$A_PROFILE\",\"p_status\":\"active\",\"p_org_id\":\"$A_ORG\"}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "admin_set_user_status on A's profile accepted from B"
c=$(rpc operator_toggle_feature "{\"p_org_id\":\"$A_ORG\",\"p_key\":\"probe\",\"p_enabled\":false}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "operator_toggle_feature(A) accepted from B"
c=$(rpc operator_grant_credits "{\"p_org_id\":\"$A_ORG\",\"p_amount\":0,\"p_note\":\"probe\"}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "operator_grant_credits(A) accepted from B"
c=$(rpc reserve_credits "{\"p_org_id\":\"$A_ORG\",\"p_amount\":0.01,\"p_run_id\":\"b0000000-0000-4000-8000-0000000000aa\"}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "reserve_credits(A) accepted from B"
c=$(rpc create_vault_secret_for_org "{\"p_org_id\":\"$A_ORG\",\"p_external_tier\":\"clickup\",\"p_secret_value\":\"probe\",\"p_secret_name\":\"probe_b_forgery\",\"p_actor_id\":\"$A_PROFILE\"}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "create_vault_secret_for_org(A) accepted from B"
c=$(rpc m365_disconnect_cascade "{\"p_org_id\":\"$A_ORG\",\"p_user_id\":\"$A_PROFILE\",\"p_reason\":\"probe\"}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "m365_disconnect_cascade(A) accepted from B"
c=$(rpc audit_m365_event "{\"p_action\":\"m365.probe\",\"p_org_id\":\"$A_ORG\",\"p_actor_id\":\"$A_PROFILE\",\"p_entity_id\":\"$A_PROFILE\",\"p_detail\":{\"probe\":\"#490 forgery test\"}}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "audit_m365_event wrote an audit row INTO A on B's behalf (forgery)"
c=$(rpc capture_vendor_invoice "{\"p_procurement_id\":\"$A_PROC\",\"p_status\":\"Received\",\"p_invoice_date\":\"2026-09-08\",\"p_reference_number\":\"PROBE-B\",\"p_amount\":1,\"p_notes\":\"#490 probe\",\"p_tax_treatment\":\"exclusive\",\"p_tax_amount\":0,\"p_tax_rate\":0,\"p_tax_template\":null}"); [ "$c" = 200 ] || [ "$c" = 201 ] && flag "capture_vendor_invoice on A's procurement accepted from B"
say "=== checks: $checks  leaks: $leaks"
