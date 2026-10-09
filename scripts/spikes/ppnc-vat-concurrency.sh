#!/usr/bin/env bash
# AC-PPNC-016: local-only two-session proof. Never connects to a linked database.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ ${PMO_DB_LOCK_HELD:-0} != 1 ]]; then
  exec scripts/with-db-lock.sh bash "$0"
fi
psql_local() { docker exec -i supabase_db_pmo-portal psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1; }
tmp=$(mktemp -d)
tag="vat956_$$"
org=95601600-0000-0000-0000-000000000001
actor=95601600-0000-0000-0000-0000000000a1
customer=95601600-0000-0000-0000-0000000000c1
failed=0
cleanup() {
  psql_local <<SQL >/dev/null
select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${tag}%';
begin;
set local session_replication_role=replica;
delete from external_command_outbox where org_id='$org';
delete from sales_invoice_authors where org_id='$org';
delete from sales_invoices where org_id='$org';
delete from progress_claim_evidence where org_id='$org';
delete from progress_claim_lines where org_id='$org';
delete from progress_claims where org_id='$org';
delete from project_documents where org_id='$org';
delete from record_changes where org_id='$org';
delete from audit_events where org_id='$org';
delete from projects where org_id='$org';
delete from companies where org_id='$org';
delete from profiles where org_id='$org';
delete from auth.users where id='$actor';
delete from organizations where id='$org';
commit;
SQL
  rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
psql_local <<SQL >/dev/null
insert into organizations(id,name) values ('$org','Synthetic VAT concurrency proof');
insert into auth.users(id,email) values ('$actor','vat-concurrency@example.test');
insert into profiles(id,org_id,full_name,email,role) values ('$actor','$org','Synthetic Finance','vat-concurrency@example.test','Finance');
insert into companies(id,org_id,name,type) values ('$customer','$org','Synthetic customer','Client');
SQL

# A FIFO keeps T1's transaction open. READY and pg_stat_activity are the barrier;
# polling sleeps merely bound observation and never decide the transaction order.
interleave() {
  local name=$1 first_sql=$2 second_sql=$3 expected=$4 postcondition=$5
  local project=$6 first second waiting=0 ready=0
  psql_local <<SQL >/dev/null
insert into projects(id,org_id,name,status,currency,tax_treatment,tax_amount,tax_rate,tax_base_numerator,tax_base_denominator)
values ('$project','$org','$name','Leads','IDR','exclusive',0,12,11,12) on conflict(id) do nothing;
SQL
  mkfifo "$tmp/$name.pipe"
  exec 3<>"$tmp/$name.pipe"
  psql_local <"$tmp/$name.pipe" >"$tmp/$name.first" 2>&1 & first=$!
  printf '%s\n' "set application_name='${tag}_${name}_first';" 'begin;' \
    "set local request.jwt.claims='{\"sub\":\"$actor\",\"role\":\"authenticated\"}';" \
    "$first_sql" "select 'READY';" >&3
  for ((i=0;i<100;i++)); do
    if grep -qx READY "$tmp/$name.first" && [[ $(psql_local <<<"select count(*) from pg_stat_activity where application_name='${tag}_${name}_first' and state='idle in transaction';") == 1 ]]; then ready=1; break; fi
    if ! kill -0 "$first" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [[ $ready != 1 ]]; then echo "FAIL $name: T1 barrier unavailable"; read_log "$tmp/$name.first"; exit 1; fi
  psql_local >"$tmp/$name.second" 2>&1 <<SQL &
set application_name='${tag}_${name}_second';
begin;
set local statement_timeout='15s';
set local request.jwt.claims='{"sub":"$actor","role":"authenticated"}';
create function pg_temp.attempt() returns text language plpgsql as \$\$
declare detail text;
begin
  $second_sql
  return 'success';
exception when others then
  get stacked diagnostics detail=pg_exception_detail;
  return coalesce(nullif(detail,''),sqlstate);
end \$\$;
select pg_temp.attempt();
commit;
SQL
  second=$!
  for ((i=0;i<100;i++)); do
    if [[ $(psql_local <<<"select count(*) from pg_stat_activity s where s.application_name='${tag}_${name}_second' and s.wait_event_type='Lock' and exists(select 1 from pg_stat_activity f where f.application_name='${tag}_${name}_first' and f.pid=any(pg_blocking_pids(s.pid)));") == 1 ]]; then waiting=1; break; fi
    if ! kill -0 "$second" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [[ $waiting == 1 ]]; then echo "PASS $name: T2 waits on T1 project transaction";
  else echo "RACE $name: T2 completed without project serialization"; failed=1; fi
  printf '%s\n' 'commit;' '\q' >&3
  exec 3>&-
  if ! wait "$first"; then echo "FAIL $name: T1 did not commit"; failed=1; fi
  if ! wait "$second"; then echo "FAIL $name: T2 statement failed unexpectedly"; failed=1; fi
  if grep -qx "$expected" "$tmp/$name.second"; then echo "PASS $name: T2 outcome=$expected";
  else echo "FAIL $name: expected T2 outcome=$expected"; read_log "$tmp/$name.second"; failed=1; fi
  if [[ $(psql_local <<<"select ($postcondition);") == t ]]; then echo "PASS $name: committed VAT, invoice/body and history consistent";
  else echo "RACE $name: committed facts violate VAT/history oracle"; failed=1; fi
}
read_log() { while IFS= read -r line; do printf '%s\n' "$line"; done <"$1"; }
setter() { printf "select set_project_contract_value('%s',100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false);" "$1"; }
native() { printf "select create_native_sales_invoice('%s','$customer','[{\"item_code\":\"SVC\",\"description\":\"Concurrency\",\"qty\":1,\"rate\":100}]');" "$1"; }
# Both native orderings: a reserved old context refuses the setter; a setter-first
# create waits, reads the committed new flag, and records zero tax.
p=95601600-0000-0000-0000-0000000000b1
interleave native_first "$(native "$p")" "perform set_project_contract_value('$p',100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false);" vat-live-invoice \
 "(select subject_to_vat from projects where id='$p') and (select count(*)=1 and min(tax_amount)=11 from sales_invoices where project_id='$p') and not exists(select 1 from record_changes where entity_id='$p' and changes ? 'subject_to_vat')" "$p"
p=95601600-0000-0000-0000-0000000000b2
interleave setter_first "$(setter "$p")" "perform create_native_sales_invoice('$p','$customer','[{\"item_code\":\"SVC\",\"description\":\"Concurrency\",\"qty\":1,\"rate\":100}]');" success \
 "not (select subject_to_vat from projects where id='$p') and (select count(*)=1 and min(tax_amount)=0 from sales_invoices where project_id='$p') and (select count(*)=1 from record_changes where entity_id='$p' and changes->'subject_to_vat'=jsonb_build_object('old',true,'new',false) and actor_id='$actor' and created_at is not null)" "$p"
p=95601600-0000-0000-0000-0000000000b3
body="jsonb_build_object('erp_doc_kind','sales-invoice','projectId','$p','vat_flag_at_resolution',true)"
interleave stale_insert "$(setter "$p")" "insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('$org','revenue','proof-create','proof-create','erpnext','create','pending',$body);" vat-context-changed \
 "not (select subject_to_vat from projects where id='$p') and not exists(select 1 from external_command_outbox where idempotency_key='proof-create') and (select count(*)=1 from record_changes where entity_id='$p' and changes->'subject_to_vat'=jsonb_build_object('old',true,'new',false) and actor_id='$actor' and created_at is not null)" "$p"
# Failed claim revival uses authoritative identity, no payload projectId.
p=95601600-0000-0000-0000-0000000000b4
# interleave creates the project, so insert failed fixtures inside T1 before flipping.
claim=95601600-0000-0000-0000-0000000000d1
# The fixture must be visible to T2 before T1's VAT transaction begins.
psql_local <<SQL >/dev/null
insert into projects(id,org_id,name,status) values ('$p','$org','Revival staging','Leads');
insert into progress_claims(id,org_id,project_id,kind,currency,gross_amount,created_by) values ('$claim','$org','$p','progress','IDR',100,'$actor');
insert into project_documents(id,org_id,project_id,category,title,author_id) values ('95601600-0000-0000-0000-0000000000e1','$org','$p','Evidence','Synthetic evidence','$actor');
insert into progress_claim_evidence(org_id,claim_id,document_id,document_status,attached_by) values ('$org','$claim','95601600-0000-0000-0000-0000000000e1','Approved','$actor');
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,payload_digest) values ('$org','revenue','$claim','proof-revival','erpnext','create','failed','{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true}','unchanged-proof-digest');
SQL
# Existing fixture project is retained; the generic setup is ON CONFLICT DO NOTHING.
interleave stale_revival "$(setter "$p")" "update external_command_outbox set state='pending' where idempotency_key='proof-revival';" vat-context-changed \
 "not (select subject_to_vat from projects where id='$p') and (select state='failed' and payload=jsonb_build_object('erp_doc_kind','sales-invoice','vat_flag_at_resolution',true) and payload_digest='unchanged-proof-digest' from external_command_outbox where idempotency_key='proof-revival') and (select count(*)=1 from record_changes where entity_id='$p' and changes->'subject_to_vat'=jsonb_build_object('old',true,'new',false) and actor_id='$actor' and created_at is not null)" "$p"
if [[ $failed != 0 ]]; then echo 'AC-PPNC-016 FAIL'; exit 1; fi
echo 'AC-PPNC-016 PASS: all four interleaves serialized, no superseded VAT facts'
