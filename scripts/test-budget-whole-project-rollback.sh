#!/usr/bin/env bash
# Migration 0576/0577 (whole-project budget storage): prove the reverse refuses while whole-project data
# would be stranded, and that the clean reverse + forward round trip preserves the shipped shape. Every
# statement runs inside a transaction that is rolled back, so the shared local database is untouched.
# Run under scripts/with-db-lock.sh after a reset:
#   scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-budget-whole-project-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

probe="$(mktemp -t whole-project-rollback-probe.XXXXXX.sql)"
log="$(mktemp -t whole-project-rollback-probe.XXXXXX.log)"
cleanup() { rm -f "$probe" "$log"; }
trap cleanup EXIT

# One multi-statement script per probe runs through psql in the local database container: the CLI's
# `db query --file` rejects multi-statement input ("cannot insert multiple commands into a prepared
# statement"), which would make this evidence meaningless.
db_container="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_')"
[ -n "$db_container" ] || { echo "FAIL: local Supabase database container not found" >&2; exit 1; }
psql_file() { docker exec -i "$db_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$1"; }

# ── 1. The down migration must refuse while whole-project data would be stranded. ────────────────
python3 - "$probe" <<'PY'
import sys
from pathlib import Path

down_rpc = Path('supabase/migrations/rollback/0577_budget_distribution_rpc_down.sql').read_text()
fixture = """
insert into organizations (id, name)
values ('1473a000-0000-0000-0000-000000000001', 'Whole Project Rollback Org');
insert into projects (id, org_id, name, status, start_date, end_date)
values ('1473a111-0000-0000-0000-000000000001', '1473a000-0000-0000-0000-000000000001',
        'Rollback Project', 'Ongoing Project', date '2027-01-01', date '2028-12-31');
insert into budget_versions (id, org_id, project_id, version, name, status, budget_mode)
values ('1473a222-0000-0000-0000-000000000001', '1473a000-0000-0000-0000-000000000001',
        '1473a111-0000-0000-0000-000000000001', 1, 'Whole Project Draft', 'Draft', 'whole_project');
insert into budget_distribution_plans (org_id, budget_version_id, method, inputs, category_overrides, basis)
values ('1473a000-0000-0000-0000-000000000001', '1473a222-0000-0000-0000-000000000001', 'by_days',
        '{}'::jsonb, '{}'::jsonb,
        '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb);
"""
Path(sys.argv[1]).write_text('begin;\n' + fixture + down_rpc + '\nrollback;\n')
PY

if psql_file "$probe" >"$log" 2>&1; then
  echo "FAIL: reversing 0577 did not refuse while whole-project data existed" >&2
  cat "$log" >&2
  exit 1
fi
if ! grep -q 'rollback refused: whole-project budget data must be removed or migrated first' "$log"; then
  echo "FAIL: the reverse failed for the wrong reason" >&2
  cat "$log" >&2
  exit 1
fi
echo "✓ refuse: 0577 will not reverse while a whole-project distribution would be stranded"

# ── 2. Clean reverse in migration order, forward again, with catalog checks between each step. ────
python3 - "$probe" <<'PY'
import sys
from pathlib import Path

m = Path('supabase/migrations')
down_rpc = (m / 'rollback/0577_budget_distribution_rpc_down.sql').read_text()
down_schema = (m / 'rollback/0576_budget_whole_project_schema_down.sql').read_text()
up_schema = (m / '0576_budget_whole_project_schema.sql').read_text()
up_rpc = (m / '0577_budget_distribution_rpc.sql').read_text()

SAVE = "public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb,jsonb)"
checks = f"""
do $check$
begin
  if to_regprocedure('{SAVE}') is not null then
    raise exception 'down 0577 left the six-argument save in place';
  end if;
  if to_regprocedure('public.budget_distribution_gaps(uuid)') is not null then
    raise exception 'down 0577 left the gap read in place';
  end if;
  if to_regprocedure('public.activate_budget_version(uuid)') is null then
    raise exception 'down 0577 did not restore activation';
  end if;
end;
$check$;
select 'down 0577: functions reversed and activation restored' as step;
{down_schema}
do $check$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'budget_versions' and column_name = 'budget_mode') then
    raise exception 'down 0576 left the budget_mode column';
  end if;
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name in ('budget_distribution_plans','budget_year_distributions')) then
    raise exception 'down 0576 left a distribution table';
  end if;
end;
$check$;
select 'down 0576: mode column and distribution tables removed' as step;
{up_schema}
do $check$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'budget_versions' and column_name = 'budget_mode') then
    raise exception 'up 0576 did not restore the mode column';
  end if;
end;
$check$;
select 'up 0576: mode column restored' as step;
{up_rpc}
do $check$
begin
  if to_regprocedure('{SAVE}') is null then
    raise exception 'up 0577 did not restore the six-argument save';
  end if;
  if to_regprocedure('public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb)') is not null then
    raise exception 'up 0577 left a five-argument overload behind';
  end if;
end;
$check$;
select 'up 0577: save restored with exactly one signature' as step;
"""
Path(sys.argv[1]).write_text('begin;\n' + down_rpc + '\n' + checks + '\nrollback;\n')
PY

psql_file "$probe" >"$log" 2>&1 || { cat "$log" >&2; exit 1; }
grep -q 'down 0577: functions reversed and activation restored' "$log" || { cat "$log" >&2; exit 1; }
grep -q 'down 0576: mode column and distribution tables removed' "$log" || { cat "$log" >&2; exit 1; }
grep -q 'up 0576: mode column restored' "$log" || { cat "$log" >&2; exit 1; }
grep -q 'up 0577: save restored with exactly one signature' "$log" || { cat "$log" >&2; exit 1; }
echo "✓ round trip: 0577 down → 0576 down → 0576 up → 0577 up preserves the shipped shape"
echo "whole-project rollback probe: OK"
