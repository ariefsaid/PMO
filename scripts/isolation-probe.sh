#!/usr/bin/env bash
# Cross-org probes use the reviewed expectations in isolation-probe-denominator.json.
# Writes require a dedicated disposable tenant A; never use a client org.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DENOMINATOR="$SCRIPT_DIR/isolation-probe-denominator.json"
for name in BASE ANON SERVICE JWT_B A_ORG B_ORG A_ROWS_JSON; do
  [ -n "${!name:-}" ] || { echo "isolation-probe: required input missing: $name" >&2; exit 2; }
done
node "$SCRIPT_DIR/check-isolation-denominator.mjs" --validate-inputs || exit $?
[ "$A_ORG" != "$B_ORG" ] || { echo 'isolation-probe: tenant A and B must differ' >&2; exit 2; }
_work=$(mktemp -d "${TMPDIR:-/tmp}/isolation-probe.XXXXXX") || exit 2
trap 'rm -rf "$_work"' EXIT
jq '.tables' "$DENOMINATOR" > "$_work/tables"
TABLES_JSON="$_work/tables"
BODY="$_work/body"
for file in checks leaks errors skips; do : > "$_work/$file"; done
hdr_b=(-H "apikey: $ANON" -H "Authorization: Bearer $JWT_B" -H "Content-Type: application/json")
hdr_anon=(-H "apikey: $ANON" -H "Authorization: Bearer $ANON")
hdr_service=(-H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE")
say(){ printf '%s\n' "$*"; }
flag(){ printf '%s\n' "$*" >> "$_work/leaks"; say "  ⛔ LEAK  $*" >&2; }
probe_error(){ printf '%s\n' "$*" >> "$_work/errors"; say "  ❌ PROBE-ERROR  $*" >&2; }
skip(){ printf '%s\n' "$*" >> "$_work/skips"; say "  ⚠ SKIPPED  $*" >&2; }
check(){ printf 'x\n' >> "$_work/checks"; }
req(){
  local code
  : > "$BODY"
  code=$(curl -sS -o "$BODY" -w '%{http_code}' "$@" 2>/dev/null) || { : > "$BODY"; code=000; }
  printf '%s' "$code"
}
# Authenticate B before accepting any denial; the service read independently establishes its scope.
code=$(req "${hdr_b[@]}" "$BASE/auth/v1/user")
[ "$code" = 200 ] && uid=$(jq -er '.id | select(type=="string" and test("^[0-9a-fA-F-]{36}$"))' "$BODY") || { echo 'isolation-probe: JWT_B is not a valid authenticated token' >&2; exit 4; }
code=$(req "${hdr_service[@]}" "$BASE/rest/v1/profiles?select=org_id,status&id=eq.$uid&limit=1")
[ "$code" = 200 ] && jq -e --arg org "$B_ORG" 'type=="array" and length==1 and .[0].org_id==$org and .[0].status=="active"' "$BODY" >/dev/null 2>&1 || { echo 'isolation-probe: JWT_B profile must be active in B org' >&2; exit 4; }
code=$(req "${hdr_service[@]}" "$BASE/rest/v1/platform_operators?select=user_id&user_id=eq.$uid&limit=1")
[ "$code" = 200 ] && jq -e 'type=="array" and length==0' "$BODY" >/dev/null 2>&1 || { echo 'isolation-probe: JWT_B must be a verified non-operator' >&2; exit 4; }
# Verify every supplied target before by-id RPCs can treat source-declared masking as denial.
A_MEMBER_EMAIL=''
while IFS=$'\t' read -r table pk id; do
  [ -n "$table" ] || continue
  select_columns=org_id; [ "$table" != profiles ] || select_columns=org_id,email
  code=$(req "${hdr_service[@]}" "$BASE/rest/v1/$table?select=$select_columns&$pk=eq.$id&limit=1")
  [ "$code" = 200 ] && jq -e --arg org "$A_ORG" 'type=="array" and length==1 and .[0].org_id==$org' "$BODY" >/dev/null 2>&1 || { echo 'isolation-probe: A_ROWS_JSON target not verified as belonging to A' >&2; exit 4; }
  [ "$table" != profiles ] || A_MEMBER_EMAIL=$(jq -r '.[0].email // ""' "$BODY")
done < <(jq -r '.[] | [.table,.pk,.id] | @tsv' "$A_ROWS_JSON")
[ "${ISOLATION_VALIDATE_ONLY:-0}" != 1 ] || exit 0

# B's HTTP 401 is always an error, even if an error body claims permission denial.
# Anonymous table reads may be 401/403 after client SELECT grants are revoked.
table_read(){
  local name=$1 code=$2 expectation=$3 key=${4:-org_id} principal=${5:-B}
  check
  if [ "$code" = 403 ] || { [ "$principal" = anon ] && [ "$code" = 401 ]; }; then
    if [ "$expectation" = none ]; then say "  EXPECTED-DENIAL  $name HTTP $code"; return; fi
  fi
  [ "$code" = 200 ] && jq -e 'type=="array" and all(.[]; type=="object")' "$BODY" >/dev/null 2>&1 || { probe_error "$name HTTP $code expected JSON array"; return; }
  case "$expectation" in
    none) jq -e 'length==0' "$BODY" >/dev/null || { flag "$name returned rows"; return; } ;;
    own-org-only) jq -e --arg org "$B_ORG" --arg key "$key" 'all(.[]; .[$key]==$org)' "$BODY" >/dev/null || { flag "$name returned foreign rows"; return; } ;;
    parent-org-only) jq -e --arg org "$B_ORG" 'all(.[]; .acceptance.org_id==$org)' "$BODY" >/dev/null || { flag "$name returned foreign-parent rows"; return; } ;;
    global-readable) ;;
    *) probe_error "$name unknown expectation"; return ;;
  esac
  say "  PASS  $name ($expectation)"
}
table_update(){
  local name=$1 code=$2
  check
  if [ "$code" = 403 ] && jq -e '.code=="42501"' "$BODY" >/dev/null 2>&1; then say "  EXPECTED-DENIAL  $name"; return; fi
  [ "$code" = 200 ] && jq -e 'type=="array"' "$BODY" >/dev/null 2>&1 || { probe_error "$name HTTP $code unknown write outcome"; return; }
  jq -e 'length==0' "$BODY" >/dev/null || { flag "$name accepted write"; return; }
  say "  EXPECTED-DENIAL  $name"
}
if [ "${RPC_ONLY:-0}" != 1 ]; then
  while IFS=$'\t' read -r t has_org pk columns expectation by_id; do
    select_columns=$columns
    [ "$t" != work_order_acceptance_lines ] || select_columns='acceptance_id,acceptance:work_order_acceptances(org_id)'
    [ "$t" != subcontract_acceptance_lines ] || select_columns='acceptance_id,acceptance:subcontract_acceptances(org_id)'
    code=$(req "${hdr_b[@]}" "$BASE/rest/v1/$t?select=$select_columns&limit=3")
    org_key=org_id; [ "$has_org" = true ] || org_key=$pk
    table_read "table $t blind read" "$code" "$expectation" "$org_key"
    if [ "$by_id" != applicable ]; then say "  N/A  $t by-id read/update — $by_id"; continue; fi
    aid=$(jq -r --arg t "$t" '.[]|select(.table==$t)|.id' "$A_ROWS_JSON")
    if [ -z "$aid" ]; then skip "$t by-id read"; skip "$t update"; continue; fi
    code=$(req "${hdr_b[@]}" "$BASE/rest/v1/$t?$pk=eq.$aid&select=$columns")
    # Granted tenant tables deny by returning []; none also permits a denied SELECT grant.
    table_read "table $t by-id read" "$code" none
    if [ "${PROBE_A_DISPOSABLE:-0}" != 1 ]; then skip "$t update — needs disposable tenant A"; continue; fi
    code=$(req -X PATCH "${hdr_b[@]}" -H 'Prefer: return=representation' "$BASE/rest/v1/$t?$pk=eq.$aid" -d "{\"$pk\":\"$aid\"}")
    table_update "table $t update" "$code"
  done < <(jq -r '.[] | [.table,.has_org,.pk,.columns,.b_read,.by_id] | @tsv' "$TABLES_JSON")
  while IFS=$'\t' read -r t columns; do
    code=$(req "${hdr_anon[@]}" "$BASE/rest/v1/$t?select=$columns&limit=1")
    table_read "anon table $t read" "$code" none org_id anon
  done < <(jq -r '.[] | [.table,.columns] | @tsv' "$TABLES_JSON")
fi

rpc(){
  local fn=$1 payload=$2 spec code sqlstate shape rpc_class
  spec=$(jq -ce --arg fn "$fn" '.rpcs[]|select(.name==$fn)' "$DENOMINATOR") || { probe_error "rpc $fn missing expectation"; return; }
  rpc_class=$(jq -r '.class' <<< "$spec")
  if [ "$rpc_class" = write ] && [ "${PROBE_A_DISPOSABLE:-0}" != 1 ]; then skip "$fn — needs disposable tenant A"; return; fi
  code=$(req -X POST "${hdr_b[@]}" "$BASE/rest/v1/rpc/$fn" -d "$payload")
  check
  say "  rpc $fn → $code" >&2
  if [ "$code" = 401 ]; then probe_error "rpc $fn HTTP 401"; return; fi
  sqlstate=$(jq -r '.code // .sqlstate // ""' "$BODY" 2>/dev/null) || sqlstate=''
  if jq -e --arg code "$code" --arg state "$sqlstate" '.expect_denial | any(.[]; (.http|tostring)==$code and .sqlstate==$state)' <<< "$spec" >/dev/null; then
    say "  EXPECTED-DENIAL  rpc $fn" >&2; return
  fi
  case "$code" in
    200|201)
      jq -e 'true' "$BODY" >/dev/null 2>&1 || { probe_error "rpc $fn invalid JSON"; return; }
      shape=$(jq -r '.shape // ""' <<< "$spec")
      if [ -n "$shape" ] && [ "$code" != 200 ]; then probe_error "rpc $fn unexpected shape HTTP $code"; return; fi
      if [ "$rpc_class" = read ]; then
        if [ "$shape" = must-deny ]; then flag "rpc $fn unexpectedly returned cross-tenant read data"; return; fi
        jq -e 'type=="boolean"' "$BODY" >/dev/null || { probe_error "rpc $fn expected boolean"; return; }
        say "  PASS  rpc $fn (own-org boolean read)" >&2
        return
      fi
      if [ "$shape" = empty-array ]; then
        jq -e 'type=="array"' "$BODY" >/dev/null || { probe_error "rpc $fn expected empty array"; return; }
        jq -e 'length==0' "$BODY" >/dev/null && { say "  EXPECTED-DENIAL  rpc $fn" >&2; return; }
      elif [ "$shape" = false ]; then
        jq -e 'type=="boolean"' "$BODY" >/dev/null || { probe_error "rpc $fn expected false"; return; }
        jq -e '.==false' "$BODY" >/dev/null && { say "  EXPECTED-DENIAL  rpc $fn" >&2; return; }
      fi
      if [ "$rpc_class" = inert ] && jq -e '.==null or .==false or (type=="array" and length==0)' "$BODY" >/dev/null; then
        probe_error "rpc $fn unexpected empty success"; return
      fi
      flag "rpc $fn returned data or accepted write" ;;
    204)
      if [ "$(jq -r '.class' <<< "$spec")" = write ]; then flag "rpc $fn accepted write"; else probe_error "rpc $fn HTTP 204"; fi ;;
    *) probe_error "rpc $fn unexpected HTTP $code SQLSTATE $sqlstate" ;;
  esac
}
A_PROFILE=$(jq -r '.[]|select(.table=="profiles")|.id' "$A_ROWS_JSON")
A_PROC=$(jq -r '.[]|select(.table=="procurements")|.id' "$A_ROWS_JSON")
c=$(rpc org_reads_erp_ledger "{}")
c=$(rpc org_credit_balance "{\"p_org_id\":\"$A_ORG\"}")
c=$(rpc operator_usage_summary "{\"p_org_id\":\"$A_ORG\"}")
c=$(rpc operator_agent_run_stats "{\"p_org_id\":\"$A_ORG\"}")
c=$(rpc operator_list_orgs "{}")
c=$(rpc org_has_member_email "$(jq -nc --arg org "$A_ORG" --arg email "$A_MEMBER_EMAIL" '{p_org_id:$org,p_email:$email}')")
c=$(rpc get_process_gates "{\"p_org\":\"$A_ORG\"}")
c=$(rpc actor_authorization_state "{\"p_org_id\":\"$A_ORG\",\"p_user_id\":\"$A_PROFILE\"}")
c=$(rpc admin_set_user_status "{\"p_profile_id\":\"$A_PROFILE\",\"p_status\":\"active\",\"p_org_id\":\"$A_ORG\"}")
c=$(rpc operator_toggle_feature "{\"p_org_id\":\"$A_ORG\",\"p_key\":\"probe\",\"p_enabled\":false}")
c=$(rpc operator_grant_credits "{\"p_org_id\":\"$A_ORG\",\"p_amount\":0,\"p_note\":\"probe\"}")
c=$(rpc reserve_credits "{\"p_org_id\":\"$A_ORG\",\"p_amount\":0.01,\"p_run_id\":\"b0000000-0000-4000-8000-0000000000aa\"}")
c=$(rpc claim_erp_sweep_lock "{\"p_org_id\":\"$A_ORG\",\"p_holder\":\"b0000000-0000-4000-8000-0000000000ab\",\"p_ttl\":\"15 minutes\"}")
c=$(rpc mark_erp_statement_report_refresh_attempt "{\"p_org_id\":\"$A_ORG\",\"p_holder\":\"b0000000-0000-4000-8000-0000000000ab\",\"p_binding\":{}}")
c=$(rpc release_erp_sweep_lock "{\"p_org_id\":\"$A_ORG\",\"p_holder\":\"b0000000-0000-4000-8000-0000000000ab\"}")
c=$(rpc claim_ops_job_lease "{\"p_job\":\"probe\",\"p_holder\":\"b0000000-0000-4000-8000-0000000000ab\",\"p_ttl\":\"1 minute\"}")
c=$(rpc release_ops_job_lease "{\"p_job\":\"probe\",\"p_holder\":\"b0000000-0000-4000-8000-0000000000ab\"}")
c=$(rpc replace_erp_account_chart "{\"p_org_id\":\"$A_ORG\",\"p_company\":\"Probe\",\"p_rows\":[]}")
c=$(rpc finish_erp_gl_replay "{\"p_org_id\":\"$A_ORG\",\"p_company\":\"Probe\",\"p_replay_id\":\"b0000000-0000-4000-8000-0000000000ac\",\"p_watermark\":\"0\"}")
c=$(rpc replace_erp_gl_voucher_rows "{\"p_org_id\":\"$A_ORG\",\"p_company\":\"Probe\",\"p_voucher_type\":\"Journal Entry\",\"p_voucher_no\":\"Probe\",\"p_rows\":[],\"p_current_names\":[\"Probe\"]}")
c=$(rpc replace_erp_ple_voucher_rows "{\"p_org_id\":\"$A_ORG\",\"p_company\":\"Probe\",\"p_voucher_type\":\"Journal Entry\",\"p_voucher_no\":\"Probe\",\"p_rows\":[],\"p_current_names\":[\"Probe\"]}")
c=$(rpc erp_ledger_voucher_replace_check "{\"p_org_id\":\"$A_ORG\",\"p_company\":\"Probe\",\"p_voucher_type\":\"Journal Entry\",\"p_voucher_no\":\"Probe\",\"p_rows\":[],\"p_current_names\":[\"Probe\"]}")
c=$(rpc finish_erp_ple_voucher_backfill "{\"p_org_id\":\"$A_ORG\",\"p_company\":\"Probe\"}")
c=$(rpc mark_erp_statement_replay_for_missing_accounts "{\"p_org_id\":\"$A_ORG\",\"p_company\":\"Probe\"}")
c=$(rpc create_vault_secret_for_org "{\"p_org_id\":\"$A_ORG\",\"p_external_tier\":\"clickup\",\"p_secret_value\":\"probe\",\"p_secret_name\":\"probe_b_forgery\",\"p_actor_id\":\"$A_PROFILE\"}")
c=$(rpc m365_disconnect_cascade "{\"p_org_id\":\"$A_ORG\",\"p_user_id\":\"$A_PROFILE\",\"p_reason\":\"probe\"}")
c=$(rpc audit_m365_event "{\"p_action\":\"m365.probe\",\"p_org_id\":\"$A_ORG\",\"p_actor_id\":\"$A_PROFILE\",\"p_entity_id\":\"$A_PROFILE\",\"p_detail\":{\"probe\":\"#490 forgery test\"}}")
if [ -n "$A_PROC" ] && [ "$A_PROC" != null ]; then
  c=$(rpc capture_vendor_invoice "{\"p_procurement_id\":\"$A_PROC\",\"p_status\":\"Received\",\"p_invoice_date\":\"2026-09-08\",\"p_reference_number\":\"PROBE-B\",\"p_amount\":1,\"p_notes\":\"#490 probe\",\"p_tax_treatment\":\"exclusive\",\"p_tax_amount\":0,\"p_tax_rate\":0,\"p_tax_template\":null}")
else skip "capture_vendor_invoice (procurements)"; fi
if [ -n "$A_PROC" ] && [ "$A_PROC" != null ]; then
  c=$(rpc create_procurement_invoice "{\"p_procurement_id\":\"$A_PROC\",\"p_status\":\"Received\",\"p_invoice_date\":\"2026-09-08\",\"p_amount\":1,\"p_tax_treatment\":\"exclusive\",\"p_tax_amount\":0,\"p_withheld_amount\":0}")
else skip "create_procurement_invoice (procurements)"; fi
if [ -n "$A_PROC" ] && [ "$A_PROC" != null ]; then
  c=$(rpc approve_procurement_amount "{\"p_procurement_id\":\"$A_PROC\",\"p_amount\":1}")
  c=$(rpc procurement_payment_within_ceiling "{\"p_procurement_id\":\"$A_PROC\"}")
else
  skip "approve_procurement_amount (procurements)"
  skip "procurement_payment_within_ceiling (procurements)"
fi
A_PROJECT=$(jq -r '.[]|select(.table=="projects")|.id' "$A_ROWS_JSON")
if [ -n "$A_PROJECT" ] && [ "$A_PROJECT" != null ]; then
  c=$(rpc get_financial_statement_catalogue "$(jq -nc --arg project "$A_PROJECT" '{p_project_id:$project}')")
  c=$(rpc get_financial_statement "$(jq -nc --arg project "$A_PROJECT" '{p_period_kind:"month",p_period_start:"2026-09-01",p_statement:"profit_and_loss",p_project_id:$project,p_view_kind:"project_totals",p_unassigned:false}')")
else
  skip "get_financial_statement_catalogue (projects)"
  skip "get_financial_statement (projects)"
fi
A_COMPANY=$(jq -r '.[]|select(.table=="companies")|.id' "$A_ROWS_JSON")
A_SI=$(jq -r '.[]|select(.table=="sales_invoices")|.id' "$A_ROWS_JSON")
if [ -n "$A_PROJECT" ] && [ "$A_PROJECT" != null ]; then
  c=$(rpc get_projects_money_collection "{\"p_project_ids\":[\"$A_PROJECT\"]}")
else skip "get_projects_money_collection (projects)"; fi
if [ -n "$A_SI" ] && [ "$A_SI" != null ] && [ -n "$A_PROJECT" ] && [ "$A_PROJECT" != null ]; then
  c=$(rpc assign_sales_invoice_project "{\"p_si_id\":\"$A_SI\",\"p_project_id\":\"$A_PROJECT\"}")
else
  skip "assign_sales_invoice_project (sales_invoices/projects)"
fi
if [ -n "$A_SI" ] && [ "$A_SI" != null ]; then
  c=$(rpc set_sales_invoice_billing_kind "{\"p_si_id\":\"$A_SI\",\"p_billing_kind\":\"other\"}")
else
  skip "set_sales_invoice_billing_kind (sales_invoices)"
fi
A_PI=$(jq -r '.[]|select(.table=="procurement_invoices")|.id' "$A_ROWS_JSON")
A_CLAIM=$(jq -r '.[]|select(.table=="expense_claims")|.id' "$A_ROWS_JSON")
A_BUDGET=$(jq -r '.[]|select(.table=="budget_versions")|.id' "$A_ROWS_JSON")
A_SLIP=$(jq -r '.[]|select(.table=="vendor_withholding_slips")|.id' "$A_ROWS_JSON")
A_VENDOR_BILL=$(jq -r '.[]|select(.table=="procurement_invoices")|.id' "$A_ROWS_JSON")
A_PO=$(jq -r '.[]|select(.table=="purchase_orders")|.id' "$A_ROWS_JSON")
A_SCA=$(jq -r '.[]|select(.table=="subcontract_acceptances")|.id' "$A_ROWS_JSON")
A_WO=$(jq -r '.[]|select(.table=="work_orders")|.id' "$A_ROWS_JSON")
A_ACCEPTANCE=$(jq -r '.[]|select(.table=="work_order_acceptances")|.id' "$A_ROWS_JSON")
A_ACCEPTANCE_WORK_ORDER=$(jq -r '.[]|select(.table=="work_order_acceptances")|.work_order_id // empty' "$A_ROWS_JSON")
A_ACCEPTANCE_LINES=$(jq -c '.[]|select(.table=="work_order_acceptances")|.lines // empty' "$A_ROWS_JSON")
for id in A_PROJECT A_COMPANY; do value=${!id}; [ -n "$value" ] && [ "$value" != null ] || skip "create_native_sales_invoice ($id)"; done
if [ -n "$A_PROJECT" ] && [ "$A_PROJECT" != null ]; then
  c=$(rpc create_progress_claim "{\"p_project_id\":\"$A_PROJECT\",\"p_kind\":\"down_payment\",\"p_work_order_id\":null,\"p_lines\":null,\"p_down_payment_amount\":1,\"p_recovery_pct\":1,\"p_recover_remaining\":false}")
else skip "create_progress_claim (projects)"; fi
if [ -n "$A_PO" ] && [ "$A_PO" != null ]; then
  c=$(rpc set_subcontract_po_lines "{\"p_po_id\":\"$A_PO\",\"p_lines\":[{\"boq_item_id\":\"$A_PO\",\"quantity\":1,\"rate\":1,\"unit\":\"ls\"}]}")
  c=$(rpc issue_subcontract_po_lines "{\"p_po_id\":\"$A_PO\"}")
else skip "set_subcontract_po_lines (purchase_orders)"; skip "issue_subcontract_po_lines (purchase_orders)"; fi
if [ -n "$A_PO" ] && [ "$A_PO" != null ]; then
  c=$(rpc prepare_subcontract_acceptance "{\"p_po_id\":\"$A_PO\",\"p_acceptance_date\":\"2026-09-08\",\"p_lines\":[{\"boq_item_id\":\"$A_PO\",\"quantity\":1}]}")
else skip "prepare_subcontract_acceptance (purchase_orders)"; fi
if [ -n "$A_PROC" ] && [ "$A_PROC" != null ]; then
  c=$(rpc capture_subcontract_vendor_invoice "{\"p_procurement_id\":\"$A_PROC\",\"p_status\":\"Received\",\"p_invoice_date\":\"2026-09-08\",\"p_lines\":[{\"boq_item_id\":\"$A_PROC\",\"quantity\":1,\"rate\":1}]}")
else skip "capture_subcontract_vendor_invoice (procurements)"; fi
if [ -n "$A_PI" ] && [ "$A_PI" != null ]; then
  c=$(rpc attribute_subcontract_bill_lines "{\"p_invoice_id\":\"$A_PI\",\"p_lines\":[{\"boq_item_id\":\"$A_PI\",\"quantity\":1,\"rate\":1}]}")
else skip "attribute_subcontract_bill_lines (procurement_invoices)"; fi
A_VAR=$(jq -r '.[]|select(.table=="po_variations")|.id' "$A_ROWS_JSON")
A_BOQ=$(jq -r '.[]|select(.table=="boq_items")|.id' "$A_ROWS_JSON")
if [ -n "$A_PO" ] && [ "$A_PO" != null ] && [ -n "$A_BOQ" ] && [ "$A_BOQ" != null ]; then
  c=$(rpc request_po_variation "{\"p_po_id\":\"$A_PO\",\"p_origin\":\"pre_work\",\"p_lines\":[{\"boq_item_id\":\"$A_BOQ\",\"additional_quantity\":1}],\"p_reason\":\"probe\"}")
else skip "request_po_variation (purchase_orders, boq_items)"; fi
if [ -n "$A_VAR" ] && [ "$A_VAR" != null ]; then
  c=$(rpc decide_po_variation "{\"p_id\":\"$A_VAR\",\"p_approve\":true}")
  c=$(rpc issue_po_revision "{\"p_variation_id\":\"$A_VAR\"}")
  c=$(rpc link_po_variation "{\"p_variation_id\":\"$A_VAR\",\"p_work_order_id\":null,\"p_not_passed_reason\":\"probe\"}")
else
  skip "decide_po_variation (po_variations fixture)"
  skip "issue_po_revision (po_variations fixture)"
  skip "link_po_variation (po_variations fixture)"
fi
if [ -n "$A_SCA" ] && [ "$A_SCA" != null ]; then
  c=$(rpc confirm_subcontract_acceptance "{\"p_id\":\"$A_SCA\"}")
  c=$(rpc withdraw_subcontract_acceptance "{\"p_id\":\"$A_SCA\"}")
else
  skip "confirm_subcontract_acceptance (subcontract_acceptances fixture)"
  skip "withdraw_subcontract_acceptance (subcontract_acceptances fixture)"
fi
if [ -n "$A_ACCEPTANCE_WORK_ORDER" ] && [ -n "$A_ACCEPTANCE_LINES" ] \
  && [ "$A_ACCEPTANCE_LINES" != null ] \
  && jq -e 'type=="array" and length>0 and all(.[]; (.boq_item_id|type)=="string" and (.quantity|type)=="number" and .quantity>0)' <<< "$A_ACCEPTANCE_LINES" >/dev/null; then
  c=$(rpc prepare_work_order_acceptance "$(jq -nc --arg wo "$A_ACCEPTANCE_WORK_ORDER" --argjson lines "$A_ACCEPTANCE_LINES" '{p_work_order_id:$wo,p_acceptance_date:"2026-09-08",p_is_final:false,p_lines:$lines,p_document_id:null,p_note:null,p_acceptance_id:null}')")
else skip "prepare_work_order_acceptance (requires work_order_acceptances.work_order_id and nonempty lines fixture)"; fi
if [ -n "$A_ACCEPTANCE" ] && [ "$A_ACCEPTANCE" != null ]; then
  c=$(rpc confirm_work_order_acceptance "{\"p_id\":\"$A_ACCEPTANCE\"}")
  c=$(rpc withdraw_work_order_acceptance "{\"p_id\":\"$A_ACCEPTANCE\"}")
else
  skip "confirm_work_order_acceptance (work_order_acceptances fixture)"
  skip "withdraw_work_order_acceptance (work_order_acceptances fixture)"
fi
if [ -n "$A_PROJECT" ] && [ "$A_PROJECT" != null ] && [ -n "$A_COMPANY" ] && [ "$A_COMPANY" != null ]; then
  c=$(rpc create_native_sales_invoice "{\"p_project_id\":\"$A_PROJECT\",\"p_customer_id\":\"$A_COMPANY\",\"p_lines\":[{\"description\":\"probe\",\"qty\":1,\"rate\":1}],\"p_work_order_id\":null}")
fi
if [ -n "$A_SI" ] && [ "$A_SI" != null ]; then
  c=$(rpc transition_native_sales_invoice "{\"p_id\":\"$A_SI\",\"p_to\":\"Cancelled\"}")
  c=$(rpc record_native_receipt "{\"p_sales_invoice_id\":\"$A_SI\",\"p_amount\":1,\"p_received_amount\":1,\"p_withheld_amount\":0,\"p_date\":\"2026-09-08\"}")
else skip "transition_native_sales_invoice (sales_invoices)"; skip "record_native_receipt (sales_invoices)"; fi
A_RECEIPT=$(jq -r '.[]|select(.table=="incoming_payments")|.id' "$A_ROWS_JSON")
if [ -n "$A_RECEIPT" ] && [ "$A_RECEIPT" != null ]; then c=$(rpc cancel_native_receipt "{\"p_receipt_id\":\"$A_RECEIPT\"}"); else skip "cancel_native_receipt (incoming_payments)"; fi
for target in "set_sales_invoice_efaktur:A_SI:p_si_id" "set_procurement_invoice_efaktur:A_PI:p_invoice_id"; do fn=${target%%:*}; rest=${target#*:}; id=${rest%%:*}; arg=${rest#*:}; value=${!id}; if [ -n "$value" ] && [ "$value" != null ]; then c=$(rpc "$fn" "{\"$arg\":\"$value\",\"p_efaktur_number\":\"123.456\",\"p_efaktur_date\":\"2026-09-08\"}"); else skip "$fn ($id)"; fi; done
if [ -n "$A_COMPANY" ] && [ "$A_COMPANY" != null ]; then c=$(rpc set_vendor_tax_defaults "{\"p_company_id\":\"$A_COMPANY\",\"p_vat_rate\":0,\"p_pph_type\":null,\"p_pph_rate\":null}"); else skip "set_vendor_tax_defaults (companies)"; fi
if [ -n "$A_VENDOR_BILL" ] && [ "$A_VENDOR_BILL" != null ] && [ -n "$A_COMPANY" ] && [ "$A_COMPANY" != null ]; then
  c=$(rpc record_vendor_withholding_slip "{\"p_slip_id\":\"b0000000-0000-4000-8000-0000000000aa\",\"p_vendor_id\":\"$A_COMPANY\",\"p_slip_number\":\"PROBE-B\",\"p_slip_date\":\"2026-09-08\",\"p_tax_period\":\"2026-09-01\",\"p_pph_type\":\"pph23\",\"p_tax_base\":1,\"p_withheld_amount\":1,\"p_invoice_ids\":[\"$A_VENDOR_BILL\"],\"p_declared_invoice_ids\":[]}")
else skip "record_vendor_withholding_slip (procurement_invoices/companies)"; fi
if [ -n "$A_SLIP" ] && [ "$A_SLIP" != null ]; then
  c=$(rpc correct_vendor_withholding_slip "{\"p_slip_id\":\"$A_SLIP\",\"p_expected_revision\":1,\"p_slip_number\":\"123\",\"p_slip_date\":\"2026-09-08\",\"p_tax_period\":\"2026-09-01\",\"p_reason\":\"probe\"}")
  c=$(rpc void_vendor_withholding_slip "{\"p_slip_id\":\"$A_SLIP\",\"p_expected_revision\":1,\"p_reason\":\"probe\"}")
else skip "correct_vendor_withholding_slip (vendor_withholding_slips)"; skip "void_vendor_withholding_slip (vendor_withholding_slips)"; fi
if [ -n "$A_CLAIM" ] && [ "$A_CLAIM" != null ]; then c=$(rpc record_expense_advance_return "{\"p_id\":\"$A_CLAIM\",\"p_amount\":0.01,\"p_reference\":\"probe\"}"); else skip "record_expense_advance_return (expense_claims)"; fi
if [ -n "$A_BUDGET" ] && [ "$A_BUDGET" != null ]; then c=$(rpc activate_budget_version "{\"version_id\":\"$A_BUDGET\"}"); else skip "activate_budget_version (budget_versions)"; fi
A_IMPREST_FLOAT=$(jq -r '.[]|select(.table=="imprest_floats")|.id' "$A_ROWS_JSON")
A_IMPREST_CHANGE=$(jq -r '.[]|select(.table=="imprest_float_changes")|.id' "$A_ROWS_JSON")
A_IMPREST_PLAN=$(jq -r '.[]|select(.table=="imprest_plans")|.id' "$A_ROWS_JSON")
if [ -n "$A_PROJECT" ] && [ "$A_PROJECT" != null ]; then c=$(rpc establish_imprest_float "{\"p_project\":\"$A_PROJECT\",\"p_custodian\":\"b0000000-0000-4000-8000-0000000000aa\",\"p_amount\":1}"); else skip "establish_imprest_float (projects)"; fi
if [ -n "$A_IMPREST_FLOAT" ] && [ "$A_IMPREST_FLOAT" != null ]; then c=$(rpc propose_imprest_float_amount "{\"p_float\":\"$A_IMPREST_FLOAT\",\"p_amount\":1}"); else skip "propose_imprest_float_amount (imprest_floats)"; fi
if [ -n "$A_IMPREST_CHANGE" ] && [ "$A_IMPREST_CHANGE" != null ]; then c=$(rpc decide_imprest_float_change "{\"p_change\":\"$A_IMPREST_CHANGE\",\"p_approve\":false}"); else skip "decide_imprest_float_change (imprest_float_changes)"; fi
if [ -n "$A_IMPREST_PLAN" ] && [ "$A_IMPREST_PLAN" != null ]; then c=$(rpc transition_imprest_plan "{\"p_id\":\"$A_IMPREST_PLAN\",\"p_to\":\"Cancelled\"}"); else skip "transition_imprest_plan (imprest_plans)"; fi
# Counts are append-only, so a write that slipped through could never be removed: probe with an invalid amount. The org
# check runs first (P0002); a regression reaches the amount check instead (P0001) and fails the run without writing a row.
if [ -n "$A_IMPREST_FLOAT" ] && [ "$A_IMPREST_FLOAT" != null ]; then c=$(rpc record_imprest_count "{\"p_float\":\"$A_IMPREST_FLOAT\",\"p_counted\":-1,\"p_note\":\"probe\"}"); else skip "record_imprest_count (imprest_floats)"; fi
if [ -n "$A_PROJECT" ] && [ "$A_PROJECT" != null ]; then c=$(rpc imprest_float_choices "{\"p_project\":\"$A_PROJECT\"}"); else skip "imprest_float_choices (projects)"; fi
A_BUDGET_LINE=$(jq -r '.[]|select(.table=="budget_line_items")|.id' "$A_ROWS_JSON")
if [ -n "$A_BUDGET_LINE" ] && [ "$A_BUDGET_LINE" != null ]; then c=$(rpc recategorise_budget_lines "{\"p_line_ids\":[\"$A_BUDGET_LINE\"],\"p_category\":\"Vehicle\"}"); else skip "recategorise_budget_lines (budget_line_items)"; fi
checks=$(wc -l < "$_work/checks" | tr -d ' ')
leaks=$(wc -l < "$_work/leaks" | tr -d ' ')
errors=$(wc -l < "$_work/errors" | tr -d ' ')
skipped=$(wc -l < "$_work/skips" | tr -d ' ')
say "=== checks: $checks  leaks: $leaks  probe_errors: $errors  skipped: $skipped"
[ "$errors" = 0 ] || exit 4
[ "$leaks" = 0 ] || exit 1
[ "${STRICT:-1}" != 1 ] || [ "$skipped" = 0 ] || exit 3
exit 0
