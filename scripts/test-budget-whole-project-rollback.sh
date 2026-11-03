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
cleanup() { rm -f "$probe" "$probe.plan" "$probe.row" "$log"; }
trap cleanup EXIT

# One multi-statement script per probe runs through psql in the local database container: the CLI's
# `db query --file` rejects multi-statement input ("cannot insert multiple commands into a prepared
# statement"), which would make this evidence meaningless.
db_container="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_')"
[ -n "$db_container" ] || { echo "FAIL: local Supabase database container not found" >&2; exit 1; }
psql_file() { docker exec -i "$db_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$1"; }

# ── 1. Each independent down refusal predicate is live: version mode, stored plan, stored row. ────
python3 - "$probe" <<'PY'
import sys
from pathlib import Path

down_rpc = Path('supabase/migrations/rollback/0577_budget_distribution_rpc_down.sql').read_text()
base = """
insert into organizations (id, name)
values ('1473a000-0000-0000-0000-000000000001', 'Whole Project Rollback Org');
insert into projects (id, org_id, name, status, start_date, end_date)
values ('1473a111-0000-0000-0000-000000000001', '1473a000-0000-0000-0000-000000000001',
        'Rollback Project', 'Ongoing Project', date '2027-01-01', date '2027-12-31');
"""
version = """
insert into budget_versions (id, org_id, project_id, version, name, status, budget_mode)
values ('1473a222-0000-0000-0000-000000000001', '1473a000-0000-0000-0000-000000000001',
        '1473a111-0000-0000-0000-000000000001', 1, 'Rollback Draft', 'Draft', 'per_year');
"""
plan = """
insert into budget_distribution_plans (org_id, budget_version_id, method, inputs, category_overrides, basis)
values ('1473a000-0000-0000-0000-000000000001', '1473a222-0000-0000-0000-000000000001', 'by_days',
        '{}'::jsonb, '{}'::jsonb,
        '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb);
"""
year_row = """
insert into budget_year_distributions (org_id, budget_version_id, category, fiscal_year, ordinal, amount, method, is_override)
values ('1473a000-0000-0000-0000-000000000001', '1473a222-0000-0000-0000-000000000001',
        'Labor', 'FY27', 0, 1.00, 'by_days', false);
"""
Path(sys.argv[1]).write_text('begin;\n' + base + version.replace("'per_year'", "'whole_project'") + down_rpc + '\nrollback;\n')
Path(sys.argv[1] + '.plan').write_text('begin;\n' + base + version + plan + down_rpc + '\nrollback;\n')
Path(sys.argv[1] + '.row').write_text('begin;\n' + base + version + year_row + down_rpc + '\nrollback;\n')
PY

for refusal_case in version plan row; do
  case_file="$probe"
  [ "$refusal_case" = "plan" ] && case_file="$probe.plan"
  [ "$refusal_case" = "row" ] && case_file="$probe.row"
  if psql_file "$case_file" >"$log" 2>&1; then
    echo "FAIL: reversing 0577 did not refuse for its $refusal_case predicate" >&2
    cat "$log" >&2
    exit 1
  fi
  if ! grep -q 'rollback refused: whole-project budget data must be removed or migrated first' "$log"; then
    echo "FAIL: 0577's $refusal_case probe failed for the wrong reason" >&2
    cat "$log" >&2
    exit 1
  fi
  echo "✓ refuse: 0577's $refusal_case data predicate is independently enforced"
done

# ── 2. Clean reverse in migration order, forward again, with catalog checks between each step. ────
python3 - "$probe" <<'PY'
import sys
from pathlib import Path

m = Path('supabase/migrations')
down_rpc = (m / 'rollback/0577_budget_distribution_rpc_down.sql').read_text()
down_schema = (m / 'rollback/0576_budget_whole_project_schema_down.sql').read_text()
up_schema = (m / '0576_budget_whole_project_schema.sql').read_text()
up_rpc = (m / '0577_budget_distribution_rpc.sql').read_text()

baseline_sources = {
    'clone_budget_version': Path('supabase/migrations/0180_rpc_active_member_gate.sql').read_text(),
    'activate_budget_version': Path('supabase/migrations/0366_budget_travel_vehicle_categories.sql').read_text(),
    'enforce_draft_line_item': Path('supabase/migrations/0241_budget_line_version_pin.sql').read_text(),
}

def baseline_function(name, source):
    marker = f'create or replace function public.{name}'
    start = source.index(marker)
    end = source.index('$$;', start) + 3
    return source[start:end].replace(f'public.{name}', f'rollback_expected.{name}', 1)

expected_definitions = '\n'.join(baseline_function(name, source) for name, source in baseline_sources.items())
expected_grants = """
revoke all on function rollback_expected.clone_budget_version(uuid) from public, anon;
grant execute on function rollback_expected.clone_budget_version(uuid) to authenticated, service_role;
revoke all on function rollback_expected.activate_budget_version(uuid) from public, anon;
grant execute on function rollback_expected.activate_budget_version(uuid) to authenticated, service_role;
revoke all on function rollback_expected.enforce_draft_line_item() from public, anon, authenticated;
grant execute on function rollback_expected.enforce_draft_line_item() to public, service_role;
"""

SAVE = "public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb,jsonb)"
checks = f"""
create schema rollback_expected;
{expected_definitions}
{expected_grants}
insert into organizations (id,name) values ('14800000-0000-0000-0000-000000000001','Rollback evidence org');
insert into projects (id,org_id,name,status,start_date,end_date)
values ('14801111-0000-0000-0000-000000000001','14800000-0000-0000-0000-000000000001','Rollback evidence project','Ongoing Project','2027-01-01','2027-12-31');
insert into budget_versions (id,org_id,project_id,version,name,status,budget_mode)
values ('14802222-0000-0000-0000-000000000001','14800000-0000-0000-0000-000000000001','14801111-0000-0000-0000-000000000001',1,'Rollback history witness','Draft','per_year');
insert into public.record_changes (org_id,entity_type,entity_id,op,changes)
values ('14800000-0000-0000-0000-000000000001','budget_version','14802222-0000-0000-0000-000000000001','update',
        '{{"budget_mode":{{"old":"per_year","new":"whole_project"}}}}'::jsonb);
create temporary table rollback_history_config_before on commit drop as
  select captured from public.record_history_config where entity_type='budget_version';
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
  if (select captured from public.record_history_config where entity_type='budget_version')
       is distinct from (select captured - 'budget_mode' from rollback_history_config_before) then
    raise exception 'down 0576 did not restore the pre-S3 history capture config';
  end if;
  if not exists (select 1 from public.record_changes
                  where entity_id='14802222-0000-0000-0000-000000000001'
                    and changes='{{"budget_mode":{{"old":"per_year","new":"whole_project"}}}}'::jsonb) then
    raise exception 'down 0576 changed an existing record_changes history payload';
  end if;
end;
$check$;
select 'down 0576: mode column and distribution tables removed' as step;
do $check$
declare v_actual text; v_expected text; v_actual_acl text[]; v_expected_acl text[];
begin
  select pg_get_functiondef('public.clone_budget_version(uuid)'::regprocedure),
         pg_get_functiondef('rollback_expected.clone_budget_version(uuid)'::regprocedure)
    into v_actual, v_expected;
  if replace(v_actual, 'FUNCTION public.clone_budget_version', 'FUNCTION rollback_expected.clone_budget_version')
       is distinct from v_expected then
    raise exception 'down 0577 clone body differs from origin/dev 0180';
  end if;
  select array_agg(a.grantee::text || ':' || a.privilege_type || ':' || a.is_grantable order by a.grantee,a.privilege_type)
    into v_actual_acl from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid='public.clone_budget_version(uuid)'::regprocedure;
  select array_agg(a.grantee::text || ':' || a.privilege_type || ':' || a.is_grantable order by a.grantee,a.privilege_type)
    into v_expected_acl from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid='rollback_expected.clone_budget_version(uuid)'::regprocedure;
  if v_actual_acl is distinct from v_expected_acl then raise exception 'down 0577 clone grants differ from origin/dev baseline'; end if;

  select pg_get_functiondef('public.activate_budget_version(uuid)'::regprocedure),
         pg_get_functiondef('rollback_expected.activate_budget_version(uuid)'::regprocedure)
    into v_actual, v_expected;
  if replace(v_actual, 'FUNCTION public.activate_budget_version', 'FUNCTION rollback_expected.activate_budget_version')
       is distinct from v_expected then
    raise exception 'down 0577 activation body differs from origin/dev 0366';
  end if;
  select array_agg(a.grantee::text || ':' || a.privilege_type || ':' || a.is_grantable order by a.grantee,a.privilege_type)
    into v_actual_acl from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid='public.activate_budget_version(uuid)'::regprocedure;
  select array_agg(a.grantee::text || ':' || a.privilege_type || ':' || a.is_grantable order by a.grantee,a.privilege_type)
    into v_expected_acl from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid='rollback_expected.activate_budget_version(uuid)'::regprocedure;
  if v_actual_acl is distinct from v_expected_acl then raise exception 'down 0577 activation grants differ from origin/dev baseline'; end if;

  select pg_get_functiondef('public.enforce_draft_line_item()'::regprocedure),
         pg_get_functiondef('rollback_expected.enforce_draft_line_item()'::regprocedure)
    into v_actual, v_expected;
  if replace(v_actual, 'FUNCTION public.enforce_draft_line_item', 'FUNCTION rollback_expected.enforce_draft_line_item')
       is distinct from v_expected then
    raise exception 'down 0576 line-item guard body differs from origin/dev 0241';
  end if;
  select array_agg(a.grantee::text || ':' || a.privilege_type || ':' || a.is_grantable order by a.grantee,a.privilege_type)
    into v_actual_acl from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid='public.enforce_draft_line_item()'::regprocedure;
  select array_agg(a.grantee::text || ':' || a.privilege_type || ':' || a.is_grantable order by a.grantee,a.privilege_type)
    into v_expected_acl from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid='rollback_expected.enforce_draft_line_item()'::regprocedure;
  if v_actual_acl is distinct from v_expected_acl then raise exception 'down 0576 line-item guard grants differ from origin/dev baseline'; end if;
end;
$check$;
select 'rollback bodies and ACLs match actual origin/dev definitions' as step;
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
do $check$
begin
  if (select captured from public.record_history_config where entity_type='budget_version')
       is distinct from (select captured from rollback_history_config_before) then
    raise exception 'up 0576 did not restore the pre-down history capture map';
  end if;
  if not exists (select 1 from public.record_changes
                  where entity_id='14802222-0000-0000-0000-000000000001'
                    and changes='{{"budget_mode":{{"old":"per_year","new":"whole_project"}}}}'::jsonb) then
    raise exception 'the historical budget_mode record was not retained through down/up';
  end if;
end;
$check$;
select 'down/up: history config and existing history event are preserved' as step;
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
grep -q 'rollback bodies and ACLs match actual origin/dev definitions' "$log" || { cat "$log" >&2; exit 1; }
grep -q 'down/up: history config and existing history event are preserved' "$log" || { cat "$log" >&2; exit 1; }
grep -q 'up 0577: save restored with exactly one signature' "$log" || { cat "$log" >&2; exit 1; }
echo "✓ round trip: 0577 down → 0576 down → 0576 up → 0577 up preserves the shipped shape"
echo "whole-project rollback probe: OK"
