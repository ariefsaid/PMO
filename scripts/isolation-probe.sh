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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${BASE:?}" "${ANON:?}" "${JWT_B:?}" "${A_ORG:?}" "${B_ORG:?}" "${A_ROWS_JSON:?}"
S="${TMPDIR:-/tmp}"
# TABLES_JSON belongs to the checked-in denominator (#612 item 1). An explicit env override wins;
# otherwise it defaults to the manifest's `tables` array, in a temp file we own and clean up.
_tables_tmp=""
if [ -z "${TABLES_JSON:-}" ]; then
  _tables_tmp="$(mktemp "$S/isolation-tables.XXXXXX")"
  jq -e '.tables | arrays' "$SCRIPT_DIR/isolation-probe-denominator.json" > "$_tables_tmp" \
    || { echo "isolation-probe: cannot read tables from $SCRIPT_DIR/isolation-probe-denominator.json — refusing to probe an empty denominator" >&2; rm -f "$_tables_tmp"; exit 2; }
  TABLES_JSON="$_tables_tmp"
  trap 'rm -f "$_tables_tmp"' EXIT
fi
hdr_b=(-H "apikey: $ANON" -H "Authorization: Bearer $JWT_B" -H "Content-Type: application/json")
hdr_anon=(-H "apikey: $ANON" -H "Authorization: Bearer $ANON")
leaks=0; checks=0; skipped=0; skipped_names=""
say(){ printf '%s\n' "$*"; }
flag(){ leaks=$((leaks+1)); say "  ⛔ LEAK  $*"; }
skip(){ skipped=$((skipped+1)); skipped_names="${skipped_names}${skipped_names:+, }$1"; say "  ⚠ SKIPPED  $1"; }
req(){ curl -s -o "${TMPDIR:-/tmp}/probe.body" -w "%{http_code}" "$@"; }
if [ "${RPC_ONLY:-}" != 1 ]; then
# --- tables, as B ---
for t in $(jq -r '.[].table' "$TABLES_JSON"); do
  has_org=$(jq -r --arg t "$t" '.[]|select(.table==$t)|.has_org' "$TABLES_JSON"); pk=$(jq -r --arg t "$t" '.[]|select(.table==$t)|.pk' "$TABLES_JSON")
  columns=$(jq -r --arg t "$t" '(.[]|select(.table==$t)|.columns) // "*"' "$TABLES_JSON")
  code=$(req "${hdr_b[@]}" "$BASE/rest/v1/$t?select=$columns&limit=3"); n=$(jq 'if type=="array" then length else -1 end' "${TMPDIR:-/tmp}/probe.body" 2>/dev/null || echo -1); checks=$((checks+1))
  if [ "$code" = "200" ] && [ "$n" -gt 0 ]; then
    # rows visible to B: allowed only if they are B's own (org_id == B) or the table has no org_id and is a justified global
    if [ "$has_org" = "true" ]; then foreign=$(jq --arg b "$B_ORG" '[.[]|select(.org_id!=$b)]|length' "${TMPDIR:-/tmp}/probe.body"); [ "$foreign" -gt 0 ] && flag "B reads $foreign foreign row(s) from $t (blind select)"; else say "  ℹ  $t (no org_id): B sees $n row(s) — review: $(jq -c '.[0]|keys' "${TMPDIR:-/tmp}/probe.body" | cut -c1-100)"; fi
  elif [ "$code" != "200" ]; then say "  ℹ  $t blind select → HTTP $code"; fi
  # targeted read + no-op update on A's row
  aid=$(jq -r --arg t "$t" '.[]|select(.table==$t)|.id' "$A_ROWS_JSON")
  if [ -z "$aid" ] || [ "$aid" = "null" ]; then
    skip "$t by-id read"; skip "$t update"; continue
  fi
  code=$(req "${hdr_b[@]}" "$BASE/rest/v1/$t?$pk=eq.$aid&select=$columns"); n=$(jq 'if type=="array" then length else -1 end' "${TMPDIR:-/tmp}/probe.body" 2>/dev/null || echo -1); checks=$((checks+1)); [ "$code" = "200" ] && [ "$n" -gt 0 ] && flag "B reads A's row $t/$aid by id"
  code=$(req -X PATCH "${hdr_b[@]}" -H "Prefer: return=representation" "$BASE/rest/v1/$t?$pk=eq.$aid" -d "{\"$pk\":\"$aid\"}"); n=$(jq 'if type=="array" then length else -1 end' "${TMPDIR:-/tmp}/probe.body" 2>/dev/null || echo -1); checks=$((checks+1)); [ "$code" = "200" ] && [ "$n" -gt 0 ] && flag "B UPDATES A's row $t/$aid (no-op update returned $n row)"
done
# --- tables, as anon ---
for t in $(jq -r '.[].table' "$TABLES_JSON"); do columns=$(jq -r --arg t "$t" '(.[]|select(.table==$t)|.columns) // "*"' "$TABLES_JSON"); code=$(req "${hdr_anon[@]}" "$BASE/rest/v1/$t?select=$columns&limit=1"); n=$(jq 'if type=="array" then length else -1 end' "${TMPDIR:-/tmp}/probe.body" 2>/dev/null || echo -1); checks=$((checks+1)); [ "$code" = "200" ] && [ "$n" -gt 0 ] && flag "ANON reads $n row(s) from $t"; done
fi
# --- org-arg RPCs as B, with A's org / A's ids ---
A_PROFILE=$(jq -r '.[]|select(.table=="profiles")|.id' "$A_ROWS_JSON"); A_PROC=$(jq -r '.[]|select(.table=="procurements")|.id' "$A_ROWS_JSON")
_rpc_count_file=$(mktemp "${TMPDIR:-/tmp}/isolation-rpc-count.XXXXXX")
_rpc_error_file=$(mktemp "${TMPDIR:-/tmp}/isolation-rpc-errors.XXXXXX")
trap 'rm -f "$_rpc_count_file" "$_rpc_error_file" ${_tables_tmp:+'"$_tables_tmp"'}' EXIT
rpc(){
  local fn=$1 body=$2 code
  code=$(req -X POST "${hdr_b[@]}" "$BASE/rest/v1/rpc/$fn" -d "$body")
  printf 'x\n' >> "$_rpc_count_file"
  if [ "$code" = 404 ] || grep -q 'PGRST202' "${TMPDIR:-/tmp}/probe.body"; then
    printf '%s (HTTP %s%s)\n' "$fn" "$code" "$(grep -q 'PGRST202' "${TMPDIR:-/tmp}/probe.body" && printf ', PGRST202')" >> "$_rpc_error_file"
  fi
  say "  rpc $fn → $code $(head -c 110 "${TMPDIR:-/tmp}/probe.body" | tr '\n' ' ')" >&2
  echo "$code"
}
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
if [ -n "$A_PROC" ] && [ "$A_PROC" != null ]; then
  c=$(rpc capture_vendor_invoice "{\"p_procurement_id\":\"$A_PROC\",\"p_status\":\"Received\",\"p_invoice_date\":\"2026-09-08\",\"p_reference_number\":\"PROBE-B\",\"p_amount\":1,\"p_notes\":\"#490 probe\",\"p_tax_treatment\":\"exclusive\",\"p_tax_amount\":0,\"p_tax_rate\":0,\"p_tax_template\":null}"); [ "$c" = 200 ] || [ "$c" = 201 ] && flag "capture_vendor_invoice on A's procurement accepted from B"
else skip "capture_vendor_invoice (procurements)"; fi
if [ -n "$A_PROC" ] && [ "$A_PROC" != null ]; then
  c=$(rpc create_procurement_invoice "{\"p_procurement_id\":\"$A_PROC\",\"p_status\":\"Received\",\"p_invoice_date\":\"2026-09-08\",\"p_amount\":1,\"p_tax_treatment\":\"exclusive\",\"p_tax_amount\":0,\"p_withheld_amount\":0}"); [ "$c" = 200 ] || [ "$c" = 201 ] && flag "create_procurement_invoice on A's procurement accepted from B"
else skip "create_procurement_invoice (procurements)"; fi
A_PROJECT=$(jq -r '.[]|select(.table=="projects")|.id' "$A_ROWS_JSON")
A_COMPANY=$(jq -r '.[]|select(.table=="companies")|.id' "$A_ROWS_JSON")
A_SI=$(jq -r '.[]|select(.table=="sales_invoices")|.id' "$A_ROWS_JSON")
A_PI=$(jq -r '.[]|select(.table=="procurement_invoices")|.id' "$A_ROWS_JSON")
A_CLAIM=$(jq -r '.[]|select(.table=="expense_claims")|.id' "$A_ROWS_JSON")
A_BUDGET=$(jq -r '.[]|select(.table=="budget_versions")|.id' "$A_ROWS_JSON")
A_SLIP=$(jq -r '.[]|select(.table=="vendor_withholding_slips")|.id' "$A_ROWS_JSON")
A_VENDOR_BILL=$(jq -r '.[]|select(.table=="procurement_invoices")|.id' "$A_ROWS_JSON")
for id in A_PROJECT A_COMPANY; do value=${!id}; [ -n "$value" ] && [ "$value" != null ] || skip "create_native_sales_invoice ($id)"; done
if [ -n "$A_PROJECT" ] && [ "$A_PROJECT" != null ]; then
  c=$(rpc create_progress_claim "{\"p_project_id\":\"$A_PROJECT\",\"p_kind\":\"down_payment\",\"p_work_order_id\":null,\"p_lines\":null,\"p_down_payment_amount\":1,\"p_recovery_pct\":1,\"p_recover_remaining\":false}"); [ "$c" = 200 ] || [ "$c" = 201 ] && flag "create_progress_claim on A's project accepted from B"
else skip "create_progress_claim (projects)"; fi
if [ -n "$A_PROJECT" ] && [ "$A_PROJECT" != null ] && [ -n "$A_COMPANY" ] && [ "$A_COMPANY" != null ]; then
  c=$(rpc create_native_sales_invoice "{\"p_project_id\":\"$A_PROJECT\",\"p_customer_id\":\"$A_COMPANY\",\"p_lines\":[{\"description\":\"probe\",\"qty\":1,\"rate\":1}],\"p_work_order_id\":null}"); [ "$c" = 200 ] || [ "$c" = 201 ] && flag "create_native_sales_invoice for A accepted from B"
fi
if [ -n "$A_SI" ] && [ "$A_SI" != null ]; then
  c=$(rpc transition_native_sales_invoice "{\"p_id\":\"$A_SI\",\"p_to\":\"Cancelled\"}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "transition_native_sales_invoice on A accepted from B"
  c=$(rpc record_native_receipt "{\"p_sales_invoice_id\":\"$A_SI\",\"p_amount\":1,\"p_received_amount\":1,\"p_withheld_amount\":0,\"p_date\":\"2026-09-08\"}"); [ "$c" = 200 ] || [ "$c" = 201 ] && flag "record_native_receipt on A accepted from B"
else skip "transition_native_sales_invoice (sales_invoices)"; skip "record_native_receipt (sales_invoices)"; fi
A_RECEIPT=$(jq -r '.[]|select(.table=="incoming_payments")|.id' "$A_ROWS_JSON")
if [ -n "$A_RECEIPT" ] && [ "$A_RECEIPT" != null ]; then c=$(rpc cancel_native_receipt "{\"p_receipt_id\":\"$A_RECEIPT\"}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "cancel_native_receipt on A accepted from B"; else skip "cancel_native_receipt (incoming_payments)"; fi
for target in "set_sales_invoice_efaktur:A_SI:p_si_id" "set_procurement_invoice_efaktur:A_PI:p_invoice_id"; do fn=${target%%:*}; rest=${target#*:}; id=${rest%%:*}; arg=${rest#*:}; value=${!id}; if [ -n "$value" ] && [ "$value" != null ]; then c=$(rpc "$fn" "{\"$arg\":\"$value\",\"p_efaktur_number\":\"123.456\",\"p_efaktur_date\":\"2026-09-08\"}"); [ "$c" = 200 ] && flag "$fn on A accepted from B"; else skip "$fn ($id)"; fi; done
if [ -n "$A_COMPANY" ] && [ "$A_COMPANY" != null ]; then c=$(rpc set_vendor_tax_defaults "{\"p_company_id\":\"$A_COMPANY\",\"p_vat_rate\":0,\"p_pph_type\":null,\"p_pph_rate\":null}"); [ "$c" = 200 ] && flag "set_vendor_tax_defaults on A accepted from B"; else skip "set_vendor_tax_defaults (companies)"; fi
if [ -n "$A_VENDOR_BILL" ] && [ "$A_VENDOR_BILL" != null ] && [ -n "$A_COMPANY" ] && [ "$A_COMPANY" != null ]; then
  c=$(rpc record_vendor_withholding_slip "{\"p_slip_id\":\"b0000000-0000-4000-8000-0000000000aa\",\"p_vendor_id\":\"$A_COMPANY\",\"p_slip_number\":\"PROBE-B\",\"p_slip_date\":\"2026-09-08\",\"p_tax_period\":\"2026-09-01\",\"p_pph_type\":\"pph23\",\"p_tax_base\":1,\"p_withheld_amount\":1,\"p_invoice_ids\":[\"$A_VENDOR_BILL\"],\"p_declared_invoice_ids\":[]}"); [ "$c" = 200 ] && flag "record_vendor_withholding_slip on A accepted from B"
else skip "record_vendor_withholding_slip (procurement_invoices/companies)"; fi
if [ -n "$A_SLIP" ] && [ "$A_SLIP" != null ]; then
  c=$(rpc correct_vendor_withholding_slip "{\"p_slip_id\":\"$A_SLIP\",\"p_expected_revision\":1,\"p_slip_number\":\"123\",\"p_slip_date\":\"2026-09-08\",\"p_tax_period\":\"2026-09-01\",\"p_reason\":\"probe\"}"); [ "$c" = 200 ] && flag "correct_vendor_withholding_slip on A accepted from B"
  c=$(rpc void_vendor_withholding_slip "{\"p_slip_id\":\"$A_SLIP\",\"p_expected_revision\":1,\"p_reason\":\"probe\"}"); [ "$c" = 200 ] && flag "void_vendor_withholding_slip on A accepted from B"
else skip "correct_vendor_withholding_slip (vendor_withholding_slips)"; skip "void_vendor_withholding_slip (vendor_withholding_slips)"; fi
if [ -n "$A_CLAIM" ] && [ "$A_CLAIM" != null ]; then c=$(rpc record_expense_advance_return "{\"p_id\":\"$A_CLAIM\",\"p_amount\":0.01,\"p_reference\":\"probe\"}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "record_expense_advance_return on A accepted from B"; else skip "record_expense_advance_return (expense_claims)"; fi
if [ -n "$A_BUDGET" ] && [ "$A_BUDGET" != null ]; then c=$(rpc activate_budget_version "{\"version_id\":\"$A_BUDGET\"}"); [ "$c" = 200 ] || [ "$c" = 204 ] && flag "activate_budget_version on A accepted from B"; else skip "activate_budget_version (budget_versions)"; fi
checks=$((checks + $(wc -l < "$_rpc_count_file")))
rpc_errors=$(wc -l < "$_rpc_error_file" | tr -d ' ')
rpc_error_names=$(awk 'NR > 1 { printf ", " } { printf "%s", $0 } END { print "" }' "$_rpc_error_file")
say "=== checks: $checks  leaks: $leaks  probe_errors: $rpc_errors${rpc_error_names:+ [$rpc_error_names]}  skipped: $skipped${skipped_names:+ [$skipped_names]}"
[ "$rpc_errors" = 0 ] || exit 4
[ "$leaks" = 0 ] || exit 1
[ "${STRICT:-0}" != 1 ] || [ "$skipped" = 0 ] || exit 3
