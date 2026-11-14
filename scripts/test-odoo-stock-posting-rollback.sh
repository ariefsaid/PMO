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
select plan(2);
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
select * from finish();
rollback;
'''
Path(sys.argv[1]).write_text(sql)
PY
supabase test db "$test_file"
