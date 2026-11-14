#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/odoo_stock_posting_rollback.generated.test.sql
trap 'rm -f "$test_file"' EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
up = Path('supabase/migrations/0869_odoo_stock_posting.sql').read_text()
down = Path('supabase/migrations/rollback/0869_odoo_stock_posting_down.sql').read_text()
sql = '''begin;
select plan(3);
create function public.test_stock_down() returns void language plpgsql as $fn$
begin execute $down$''' + down + '''$down$; end $fn$;
select lives_ok($$select public.test_stock_down()$$,'AC-OSP-005 empty rollback succeeds');
''' + up + '''
insert into public.organizations(id,name) values ('15080000-0000-0000-0000-000000000001','Stock rollback');
alter table public.external_command_outbox disable trigger external_command_outbox_zz_stock_command;
insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state)
values ('15080000-0000-0000-0000-000000000001','inventory','fixture','stock:fixture','odoo','create','pending');
alter table public.external_command_outbox enable trigger external_command_outbox_zz_stock_command;
select throws_like($$select public.test_stock_down()$$,'STK_ROLLBACK_COMMANDS_EXIST%', 'AC-OSP-006 rollback refuses existing command');
delete from public.external_command_outbox where domain='inventory' and org_id='15080000-0000-0000-0000-000000000001';
insert into auth.users(id,email) values ('15080000-0000-0000-0000-000000000002','stock-rollback@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values ('15080000-0000-0000-0000-000000000002','15080000-0000-0000-0000-000000000001','Stock rollback','stock-rollback@example.invalid','Admin','active');
insert into public.stock_warehouses(id,org_id,code,name,kind) values ('15080000-0000-0000-0000-000000000003','15080000-0000-0000-0000-000000000001','ROLL','Rollback','central');
insert into public.stock_documents(id,org_id,number,kind,warehouse_id,occurred_on,created_by) values ('15080000-0000-0000-0000-000000000004','15080000-0000-0000-0000-000000000001','ROLL','receive','15080000-0000-0000-0000-000000000003',current_date,'15080000-0000-0000-0000-000000000002');
insert into public.stock_erp_mirror(org_id,stock_document_id,company_id,state,fetched_at,command_generation) values ('15080000-0000-0000-0000-000000000001','15080000-0000-0000-0000-000000000004',42,'pending',now(),0);
select throws_like($$select public.test_stock_down()$$,'STK_ROLLBACK_MIRROR_EXISTS%', 'AC-OSP-007 rollback refuses mirror evidence');
select * from finish();
rollback;
'''
Path(sys.argv[1]).write_text(sql)
PY
supabase test db "$test_file"
