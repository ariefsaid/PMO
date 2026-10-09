#!/usr/bin/env bash
# scripts/spikes/ppnc-vat-rollback.sh — #956 plan task D13: exercise the 0283 ROLLBACK against the
# LOCAL Docker DB (never linked/cloud) and restore.
#
# What it proves, inside ONE transaction that is always rolled back (the shared local data is never
# mutated):
#   1. After the 0283 down SQL, the PRE-0283 guard/setter behavior is back: a CANCELLED invoice
#      re-locks the VAT flag — the Finance setter's flag flip is refused with 0253's exact 42501
#      message, and the flag keeps its old value.
#   2. The VAT column, the captured project history table and the cancelled invoice's tax facts all
#      survive the rollback unchanged.
# Then `supabase db reset` restores the current (0283-applied) local schema either way.
#
# Bounded (statement_timeout + ON_ERROR_STOP), trap-guarded, DB-locked, no payload/credential
# output — only PASS notices. Verify:
#   scripts/with-db-lock.sh bash -c 'supabase db reset && bash scripts/spikes/ppnc-vat-rollback.sh'
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ ${PMO_DB_LOCK_HELD:-0} != 1 ]]; then
  exec scripts/with-db-lock.sh bash scripts/spikes/ppnc-vat-rollback.sh
fi
trap 'if [[ ${PMO_DB_LOCK_HELD:-0} == 1 ]]; then supabase db reset; else scripts/with-db-lock.sh supabase db reset; fi' EXIT
psql_local() { docker exec -i supabase_db_pmo-portal psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres; }

echo 'Applying 0283 rollback in a transaction on local supabase_db_pmo-portal...'
{
  printf '%s\n' 'begin;'
  printf '%s\n' "set local statement_timeout='30s';"
  cat supabase/migrations/rollback/0283_vat_flag_unlock_down.sql
  cat <<'SQL'
insert into organizations(id,name) values ('95601300-0000-0000-0000-000000000001','VAT rollback proof');
insert into auth.users(id,email) values ('95601300-0000-0000-0000-0000000000a1','vat-rollback@example.test');
insert into profiles(id,org_id,full_name,email,role) values
 ('95601300-0000-0000-0000-0000000000a1','95601300-0000-0000-0000-000000000001','Finance','vat-rollback@example.test','Finance');
insert into companies(id,org_id,name,type) values
 ('95601300-0000-0000-0000-0000000000c1','95601300-0000-0000-0000-000000000001','VAT rollback customer','Client');
insert into projects(id,org_id,name,status) values
 ('95601300-0000-0000-0000-0000000000b1','95601300-0000-0000-0000-000000000001','Cancelled invoice','Leads');
insert into sales_invoices(tax_treatment,tax_amount,id,org_id,project_id,customer_id,si_number,invoice_date,amount,
 erp_outstanding_amount,status,erp_docstatus) values
 ('exclusive',50,'95601300-0000-0000-0000-0000000000e1','95601300-0000-0000-0000-000000000001',
 '95601300-0000-0000-0000-0000000000b1','95601300-0000-0000-0000-0000000000c1','SI-ROLLBACK','2026-10-01',550,0,'Cancelled',2);
set local role authenticated;
set local request.jwt.claims='{"sub":"95601300-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
begin
  begin
    perform set_project_contract_value('95601300-0000-0000-0000-0000000000b1',100,
      p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false);
    raise exception 'rollback behavior regression: cancelled invoice did not re-lock VAT';
  exception when insufficient_privilege then
    if sqlerrm <> 'whether this project is subject to VAT is locked once the project has an invoice' then raise; end if;
    raise notice 'PASS: pre-0283 setter refuses the VAT flip after a cancelled invoice (0253 message, 42501)';
  end;
end $$;
reset role;
do $$
begin
  if (select subject_to_vat from projects where id='95601300-0000-0000-0000-0000000000b1') is not true then
    raise exception 'the refused flag flip changed the project VAT state';
  end if;
  raise notice 'PASS: the VAT flag is still locked at its pre-refusal value (true)';
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='subject_to_vat') then
    raise exception 'VAT project column was not preserved';
  end if;
  if (select count(*) from sales_invoices where id='95601300-0000-0000-0000-0000000000e1') <> 1
     or (select tax_amount from sales_invoices where id='95601300-0000-0000-0000-0000000000e1') <> 50 then
    raise exception 'invoice/tax history was not preserved';
  end if;
  if to_regclass('public.record_changes') is null then raise exception 'project history table was not preserved'; end if;
  raise notice 'PASS: VAT column, project history table, and the cancelled invoice tax survive the rollback';
end $$;
rollback;
SQL
} | psql_local

echo 'PASS: rollback assertions completed; restoring current local schema with supabase db reset.'
