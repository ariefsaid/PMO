#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/odoo_stock_posting_rollback.generated.test.sql
trap 'rm -f "$test_file"' EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
up = Path('supabase/migrations/0879_odoo_stock_posting.sql').read_text()
down = Path('supabase/migrations/rollback/0879_odoo_stock_posting_down.sql').read_text()
# Rollbacks run newest first: 0886's cost-lines foreign key needs 0879's unique index, so 0879's rollback needs 0886's first (#2282).
# 0886 wraps itself in begin/commit; inline in this transaction those two lines must go.
import re
strip = lambda t: re.sub(r'^(begin|commit);$', '', t, flags=re.M)
up886 = strip(Path('supabase/migrations/0886_odoo_stock_cost_lines.sql').read_text())
down886 = strip(Path('supabase/migrations/rollback/0886_odoo_stock_cost_lines_down.sql').read_text())
sql = '''begin;
select plan(8);
create function public.test_stock_down() returns void language plpgsql as $fn$
begin execute $down$''' + down + '''$down$; end $fn$;
create function public.test_cost_down() returns void language plpgsql as $fn$
begin execute $down$''' + down886 + '''$down$; end $fn$;
select lives_ok($$select public.test_cost_down()$$,'NFR-OSP-002 0886 empty rollback succeeds, ahead of 0879');
select lives_ok($$select public.test_stock_down()$$,'NFR-OSP-002 empty rollback succeeds');
''' + up + up886 + '''
select is((select count(*)::int from pg_class where relnamespace='public'::regnamespace and relkind='r'
  and relname in ('odoo_stock_cost_lines','odoo_stock_cost_census_seen','odoo_stock_cost_checks')),3,'NFR-OSP-002 round trip restores the 0886 tables');
select is((select count(*)::int from pg_proc where pronamespace='public'::regnamespace and proname in ('odoo_stock_cost_epoch','odoo_stock_cost_tie',
  'apply_odoo_stock_cost_page','mark_odoo_stock_cost_census_seen','finish_odoo_stock_cost_census','mark_odoo_stock_cost_double_counts',
  'record_odoo_stock_cost_check','project_consumption_moves','project_uncategorised_actuals')),9,'NFR-OSP-002 round trip restores the 0886 functions');
select is((select count(*)::int from pg_policies where schemaname='public' and policyname in ('odoo_stock_cost_lines_select','odoo_stock_cost_checks_select')),2,
  'NFR-OSP-002 round trip restores the 0886 policies');
select ok(has_table_privilege('authenticated','public.odoo_stock_cost_checks','select')
  and not has_table_privilege('authenticated','public.odoo_stock_cost_census_seen','select')
  and has_function_privilege('service_role','public.apply_odoo_stock_cost_page(uuid,jsonb,text)','execute')
  and not has_function_privilege('authenticated','public.apply_odoo_stock_cost_page(uuid,jsonb,text)','execute'),'NFR-OSP-002 round trip restores the 0886 grants');
insert into public.organizations(id,name) values ('15080000-0000-0000-0000-000000000001','Stock rollback');
alter table public.external_command_outbox disable trigger external_command_outbox_zz_stock_command;
insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state)
values ('15080000-0000-0000-0000-000000000001','inventory','fixture','stock:fixture','odoo','create','pending');
alter table public.external_command_outbox enable trigger external_command_outbox_zz_stock_command;
select throws_like($$select public.test_stock_down()$$,'STK_ROLLBACK_COMMANDS_EXIST%', 'NFR-OSP-002 rollback refuses existing command');
delete from public.external_command_outbox where domain='inventory' and org_id='15080000-0000-0000-0000-000000000001';
insert into auth.users(id,email) values ('15080000-0000-0000-0000-000000000002','stock-rollback@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values ('15080000-0000-0000-0000-000000000002','15080000-0000-0000-0000-000000000001','Stock rollback','stock-rollback@example.invalid','Admin','active');
insert into public.stock_warehouses(id,org_id,code,name,kind) values ('15080000-0000-0000-0000-000000000003','15080000-0000-0000-0000-000000000001','ROLL','Rollback','central');
insert into public.stock_documents(id,org_id,number,kind,warehouse_id,occurred_on,created_by) values ('15080000-0000-0000-0000-000000000004','15080000-0000-0000-0000-000000000001','ROLL','receive','15080000-0000-0000-0000-000000000003',current_date,'15080000-0000-0000-0000-000000000002');
insert into public.stock_erp_mirror(org_id,stock_document_id,company_id,state,fetched_at,command_generation) values ('15080000-0000-0000-0000-000000000001','15080000-0000-0000-0000-000000000004',42,'pending',now(),0);
select throws_like($$select public.test_stock_down()$$,'STK_ROLLBACK_MIRROR_EXISTS%', 'NFR-OSP-002 rollback refuses mirror evidence');
select * from finish();
rollback;
'''
Path(sys.argv[1]).write_text(sql)
PY
supabase test db "$test_file"
