#!/usr/bin/env bash
# Prove 0578/0579 refuse rollback after range/cancellation evidence and that a clean reverse/forward
# round-trip restores the installed function definitions, grants and schema. Run only in the locked
# local DB lane after reset. Every rollback probe runs in a transaction; the trap verifies the exact
# installed catalog snapshot after every exit path that entered a probe.
set -euo pipefail
if [[ "${PMO_DB_LOCK_HELD:-0}" != "1" ]]; then
  echo "FAIL: run this rollback proof inside scripts/with-db-lock.sh" >&2
  exit 2
fi
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

down0578="supabase/migrations/rollback/0578_budget_range_units_down.sql"
down0579="supabase/migrations/rollback/0579_budget_range_activation_down.sql"
up0578="supabase/migrations/0578_budget_range_units.sql"
up0579="supabase/migrations/0579_budget_range_activation.sql"
db_container="${PMO_DB_CONTAINER:-supabase_db_pmo-portal}"
probe="$(mktemp -t budget-range-rollback.XXXXXX.sql)"
log="$(mktemp -t budget-range-rollback.XXXXXX.log)"
snapshot_sql="$(mktemp -t budget-range-snapshot.XXXXXX.sql)"
baseline="$(mktemp -t budget-range-snapshot.XXXXXX.before)"
after="$(mktemp -t budget-range-snapshot.XXXXXX.after)"
expected_sql="$(mktemp -t budget-range-expected.XXXXXX.sql)"
probe_entered=0
cleanup() {
  local status=$?
  trap - EXIT
  if [ "$probe_entered" -eq 1 ]; then
    if psql_file < "$snapshot_sql" >"$after" 2>"$log" && cmp -s "$baseline" "$after"; then
      echo "OK: installed 0578/0579 catalog is restored after rollback probes"
    else
      cat "$log" >&2 || true
      diff -u "$baseline" "$after" >&2 || true
      echo "FAIL: rollback probe did not restore the installed catalog" >&2
      status=1
    fi
    if [ "$status" -ne 0 ]; then
      echo "Recovery proof: rerunning directly affected contracts before releasing the DB lock" >&2
      if ! supabase test db \
        supabase/tests/budget_archive_cancel_intents.test.sql \
        supabase/tests/budget_whole_project_lock_order.test.sql \
        supabase/tests/budget_range_activation.test.sql \
        supabase/tests/budget_range_concurrency.test.sql \
        supabase/tests/budget_range_outbox_state.test.sql >>"$log" 2>&1; then
        cat "$log" >&2
        echo "FAIL: restored-head contract recovery proof failed" >&2
        status=1
      fi
    fi
  fi
  rm -f "$probe" "$log" "$snapshot_sql" "$baseline" "$after" "$expected_sql"
  exit "$status"
}
trap cleanup EXIT

target="$(docker inspect --format '{{.Name}}' "$db_container" 2>/dev/null || true)"
[ "$target" = "/$db_container" ] || { echo "FAIL: refusing non-local database target '$target'" >&2; exit 1; }
psql_file() { docker exec -i "$db_container" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1 -f -; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cat > "$snapshot_sql" <<'SQL'
set statement_timeout='60s';
set lock_timeout='5s';
do $$
declare
  expected text[] := array[
    'public.activate_budget_version(uuid)',
    'public.budget_account_identity(uuid,text,text)',
    'public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb)',
    'public.budget_account_identity(uuid,text,text,text)',
    'public.budget_archive_target_inventory(uuid)',
    'public.budget_range_units_revert()',
    'public.enforce_budget_archive_outbox_state()',
    'public.get_budget_archive_targets(uuid)',
    'public.queue_budget_archive_cancel(uuid,uuid,uuid)',
    'public.read_budget_range_outbox_state(uuid,integer,text,text)',
    'public.record_outbox_ref(uuid,integer,text,text,text,text)',
    'public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)'
  ];
  resolved integer;
  distinct_oids integer;
begin
  select count(*), count(distinct p.oid)::integer into resolved, distinct_oids
    from unnest(expected) as e(signature)
    join pg_proc p on p.oid=to_regprocedure(e.signature)
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind='f'
     and length(btrim(coalesce(p.prosrc,'')))>0
     and length(btrim(coalesce(pg_get_functiondef(p.oid),'')))>0;
  if resolved <> cardinality(expected) or distinct_oids <> cardinality(expected) then
    raise exception 'expected 12 exact, nonempty public function identities with distinct OIDs; resolved %, distinct OIDs %', resolved, distinct_oids;
  end if;
end $$;

with expected(signature) as (values
  ('public.activate_budget_version(uuid)'),
  ('public.budget_account_identity(uuid,text,text)'),
  ('public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb)'),
  ('public.budget_account_identity(uuid,text,text,text)'),
  ('public.budget_archive_target_inventory(uuid)'),
  ('public.budget_range_units_revert()'),
  ('public.enforce_budget_archive_outbox_state()'),
  ('public.get_budget_archive_targets(uuid)'),
  ('public.queue_budget_archive_cancel(uuid,uuid,uuid)'),
  ('public.read_budget_range_outbox_state(uuid,integer,text,text)'),
  ('public.record_outbox_ref(uuid,integer,text,text,text,text)'),
  ('public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)')
)
select 'function|' || e.signature || '|namespace=' || n.oid::text || ':' || n.nspname ||
       '|identity=' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|definition=' ||
       replace(pg_get_functiondef(p.oid), chr(10), E'\\n') || '|acl=' || coalesce(p.proacl::text,'<default>') ||
       '|config=' || coalesce(array_to_string(p.proconfig,','),'<none>') ||
       '|owner=' || pg_get_userbyid(p.proowner) || '|security=' || p.prosecdef::text ||
       '|volatility=' || p.provolatile::text || '|kind=' || p.prokind::text
  from expected e join pg_proc p on p.oid=to_regprocedure(e.signature)
  join pg_namespace n on n.oid=p.pronamespace
 order by e.signature;

do $$
declare expected_count integer;
begin
  with expected(table_name,column_name) as (values
    ('budget_version_account_erp_mirror','to_fiscal_year'),
    ('budget_archive_cancel_intents','to_fiscal_year'),
    ('budget_archive_cancel_intents','erp_modified'),
    ('external_command_outbox','budget_range_operation'),
    ('budget_archive_requests','queued_by_activation')
  )
  select count(*) into expected_count from expected e
   join pg_class c on c.oid=to_regclass('public.' || e.table_name)
   join pg_attribute a on a.attrelid=c.oid and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
  where length(btrim(format_type(a.atttypid,a.atttypmod)))>0;
  if expected_count <> 5 then raise exception 'expected exactly five nonempty range schema columns, found %', expected_count; end if;
end $$;

with expected(table_name,column_name) as (values
  ('budget_version_account_erp_mirror','to_fiscal_year'),
  ('budget_archive_cancel_intents','to_fiscal_year'),
  ('budget_archive_cancel_intents','erp_modified'),
  ('external_command_outbox','budget_range_operation'),
  ('budget_archive_requests','queued_by_activation')
)
select 'column|' || e.table_name || '.' || e.column_name || '|' ||
       coalesce(format_type(a.atttypid,a.atttypmod),'<missing>') || '|' ||
       coalesce(a.attnotnull::text,'<missing>') || '|' ||
       coalesce(pg_get_expr(d.adbin,d.adrelid),'<no-default>') || '|' ||
       coalesce(a.attidentity::text,'<missing>') || '|' || coalesce(a.attgenerated::text,'<missing>') || '|' ||
       coalesce(a.attcollation::regcollation::text,'<missing>')
  from expected e
  left join pg_class c on c.oid=to_regclass('public.' || e.table_name)
  left join pg_attribute a on a.attrelid=c.oid and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
 order by e.table_name,e.column_name;

do $$
declare required_count integer;
begin
  with required(name) as (values
    ('budget_account_mirror_range_check'),
    ('budget_version_account_erp_mirror_scope_unique'),
    ('budget_archive_cancel_intents_range_check')
  )
  select count(*) into required_count from required r
   where exists(select 1 from pg_constraint c where c.conname=r.name
     and c.conrelid in ('public.budget_version_account_erp_mirror'::regclass,
                        'public.budget_archive_cancel_intents'::regclass)
     and c.convalidated);
  if required_count <> 3 then raise exception 'expected exactly three validated range constraints, found %', required_count; end if;
  if exists(select 1 from pg_constraint c where c.conrelid='public.budget_version_account_erp_mirror'::regclass
       and c.conname='budget_version_account_erp_mi_org_id_budget_version_id_fisc_key') then
    raise exception 'legacy annual unique constraint unexpectedly remains beside the range key';
  end if;
end $$;

with expected(name) as (values
  ('budget_account_mirror_range_check'),
  ('budget_version_account_erp_mirror_scope_unique'),
  ('budget_version_account_erp_mi_org_id_budget_version_id_fisc_key'),
  ('budget_archive_cancel_intents_range_check')
)
select 'constraint|' || e.name || '|' || coalesce(pg_get_constraintdef(c.oid,true),'<missing>') || '|' ||
       coalesce(c.convalidated::text,'<missing>') || '|' || coalesce(c.condeferrable::text,'<missing>') || '|' ||
       coalesce(c.condeferred::text,'<missing>') || '|' || coalesce(c.conislocal::text,'<missing>')
  from expected e left join pg_constraint c on c.conrelid in
    ('public.budget_version_account_erp_mirror'::regclass,'public.budget_archive_cancel_intents'::regclass)
   and c.conname=e.name
 order by e.name;

do $$
declare resolved integer;
begin
  with expected(name) as (values
    ('budget_version_account_erp_mirror_scope_unique'),
    ('budget_account_mirror_range_lookup_idx'),
    ('budget_archive_cancel_range_queue_idx')
  )
  select count(*) into resolved from expected e join pg_class i
    on i.relnamespace='public'::regnamespace and i.relname=e.name and i.relkind='i'
  where pg_get_indexdef(i.oid) is not null;
  if resolved <> 3 then raise exception 'expected exactly three nonempty range index definitions, resolved %', resolved; end if;
end $$;

do $$
declare trigger_count integer;
begin
  select count(*) into trigger_count from pg_trigger t
   where t.tgrelid='public.external_command_outbox'::regclass and not t.tgisinternal
     and t.tgname='external_command_outbox_zz_enforce_budget_archive_outbox_state'
     and t.tgfoid=to_regprocedure('public.enforce_budget_archive_outbox_state()')
     and t.tgenabled='O';
  if trigger_count <> 1 then raise exception 'expected one enabled archive trigger bound to its public function OID, found %', trigger_count; end if;
end $$;

with expected(name) as (values
  ('budget_version_account_erp_mirror_scope_unique'),
  ('budget_account_mirror_range_lookup_idx'),
  ('budget_archive_cancel_range_queue_idx')
)
select 'index|' || e.name || '|' || coalesce(pg_get_indexdef(c.oid),'<missing>')
       || '|' || coalesce(ix.indisvalid::text,'<missing>') || '|' || coalesce(ix.indisready::text,'<missing>')
       || '|' || coalesce(ix.indislive::text,'<missing>') || '|' || coalesce(ix.indisunique::text,'<missing>')
       || '|' || coalesce(ix.indnkeyatts::text,'<missing>')
  from expected e left join pg_class c on c.relnamespace='public'::regnamespace and c.relname=e.name and c.relkind='i'
  left join pg_index ix on ix.indexrelid=c.oid
 order by e.name;

select 'trigger|' || t.tgname || '|' || pg_get_triggerdef(t.oid,true) || '|' ||
       t.tgenabled::text || '|' || t.tgfoid::regprocedure::text
  from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where c.oid='public.external_command_outbox'::regclass and not t.tgisinternal
   and t.tgname like '%enforce_budget_archive_outbox_state%'
 order by t.tgname;

select 'view|public.budget_push_mirror_rows|namespace=' || c.relnamespace::regnamespace::text ||
       '|definition=' || replace(pg_get_viewdef(c.oid,true), chr(10), E'\\n') ||
       '|acl=' || coalesce(c.relacl::text,'<default>') || '|options=' || coalesce(c.reloptions::text,'<none>') ||
       '|owner=' || pg_get_userbyid(c.relowner) ||
       '|anon=' || has_table_privilege('anon',c.oid,'select')::text ||
       '|authenticated=' || has_table_privilege('authenticated',c.oid,'select')::text ||
       '|service_role=' || has_table_privilege('service_role',c.oid,'select')::text
  from pg_class c where c.oid='public.budget_push_mirror_rows'::regclass;

do $$ begin
  if to_regclass('public.budget_push_mirror_rows') is null
     or length(btrim(coalesce(pg_get_viewdef(to_regclass('public.budget_push_mirror_rows'),true),'')))=0 then
    raise exception 'expected a nonempty public budget mirror view definition';
  end if;
end $$;
SQL

psql_file < "$snapshot_sql" >"$baseline" 2>"$log" || { cat "$log" >&2; fail 'installed catalog snapshot failed'; }

base="
insert into public.organizations(id,name) values ('1478aa00-0000-0000-0000-000000000001','Range rollback org');
insert into auth.users(id,email) values ('1478aa00-0000-0000-0000-000000000002','range-rollback@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values
  ('1478aa00-0000-0000-0000-000000000002','1478aa00-0000-0000-0000-000000000001','Rollback Finance','range-rollback@example.invalid','Finance','active');
insert into public.projects(id,org_id,name,status,start_date,end_date) values
  ('1478aa00-0000-0000-0000-000000000003','1478aa00-0000-0000-0000-000000000001','Range rollback project','Ongoing Project','2027-01-01','2028-12-31');
insert into public.budget_versions(id,org_id,project_id,version,name,status,created_by,budget_mode) values
  ('1478aa00-0000-0000-0000-000000000004','1478aa00-0000-0000-0000-000000000001','1478aa00-0000-0000-0000-000000000003',1,'Range rollback version','Draft','1478aa00-0000-0000-0000-000000000002','per_year');
"

expect_refusal() {
  local label="$1" down="$2" expected="$3" fixture="$4"
  {
    printf "begin;\nset local statement_timeout='60s';\nset local lock_timeout='5s';\n%s\n" "$base"
    printf '%s\n' "$fixture"
    cat "$down"
    printf '\nrollback;\n'
  } > "$probe"
  probe_entered=1
  if psql_file < "$probe" >"$log" 2>&1; then
    fail "$label rollback unexpectedly succeeded"
  fi
  if ! grep -Fq "$expected" "$log"; then
    cat "$log" >&2
    fail "$label rollback refused for the wrong reason"
  fi
  echo "OK: $label refuses while its witness exists"
}

RANGE_VERSION="update public.budget_versions set budget_mode='whole_project' where id='1478aa00-0000-0000-0000-000000000004';"
expect_refusal "0579 range mode" "$down0579" "0579 rollback refused: range or cancellation history would be stranded" "$RANGE_VERSION"
expect_refusal "0578 range mode" "$down0578" "0578 rollback refused: range budget history would be stranded" "$RANGE_VERSION"

RANGE_MIRROR="
insert into public.budget_version_account_erp_mirror
  (org_id,budget_version_id,fiscal_year,to_fiscal_year,erp_account,budget_intent,push_state)
values ('1478aa00-0000-0000-0000-000000000001','1478aa00-0000-0000-0000-000000000004','FY27','FY28','Labor','ensure','pending');"
expect_refusal "0578 range mirror" "$down0578" "0578 rollback refused: range budget history would be stranded" "$RANGE_MIRROR"

RANGE_REFERENCE="
insert into public.external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id)
values ('1478aa00-0000-0000-0000-000000000001','budget','1478aa00-0000-0000-0000-000000000004:r:FY27:FY28:Labor','erpnext','BUD-RANGE-ROLLBACK');"
expect_refusal "0578 range reference" "$down0578" "0578 rollback refused: range budget history would be stranded" "$RANGE_REFERENCE"

RANGE_OUTBOX="
insert into public.external_command_outbox
  (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload,budget_range_operation)
values ('1478aa00-0000-0000-0000-000000000001','budget','1478aa00-0000-0000-0000-000000000004:r:FY27:FY28:Labor','range-rollback-command','erpnext','update','pending','1478aa00-0000-0000-0000-000000000002','{}',jsonb_build_object('stage','post_started'));"
expect_refusal "0578 durable command" "$down0578" "0578 rollback refused: range budget history would be stranded" "$RANGE_OUTBOX"

RANGE_INTENT="
insert into public.budget_version_account_erp_mirror
  (id,org_id,budget_version_id,fiscal_year,to_fiscal_year,erp_account,budget_intent,push_state)
values ('1478aa00-0000-0000-0000-000000000005','1478aa00-0000-0000-0000-000000000001','1478aa00-0000-0000-0000-000000000004','FY27','FY28','Labor','ensure','pushed');
insert into public.budget_archive_requests(id,org_id,project_id,budget_version_id,requested_by,cancel_erp,queued_by_activation)
values ('1478aa00-0000-0000-0000-000000000006','1478aa00-0000-0000-0000-000000000001','1478aa00-0000-0000-0000-000000000003','1478aa00-0000-0000-0000-000000000004','1478aa00-0000-0000-0000-000000000002',true,true);
insert into public.budget_archive_cancel_intents
  (id,org_id,request_id,project_id,budget_version_id,source_kind,source_mirror_id,actor_user_id,fiscal_year,to_fiscal_year,erp_account,erp_budget_name,erp_modified,activated_at_witness,state)
values ('1478aa00-0000-0000-0000-000000000007','1478aa00-0000-0000-0000-000000000001','1478aa00-0000-0000-0000-000000000006','1478aa00-0000-0000-0000-000000000003','1478aa00-0000-0000-0000-000000000004','account','1478aa00-0000-0000-0000-000000000005','1478aa00-0000-0000-0000-000000000002','FY27','FY28','Labor','BUD-RANGE-ROLLBACK','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','complete');"
expect_refusal "0579 terminal cancellation history" "$down0579" "0579 rollback refused: range or cancellation history would be stranded" "$RANGE_INTENT"
expect_refusal "0578 terminal range intent" "$down0578" "0578 rollback refused: range budget history would be stranded" "$RANGE_INTENT"

python3 - "$down0578" "$root/supabase/migrations/0577_budget_distribution_rpc.sql" "$expected_sql" <<'PY'
import re
import sys
from pathlib import Path

down578, migration577, output = map(Path, sys.argv[1:])
targets = {
    "activate_budget_version": migration577,
    "record_outbox_ref": down578,
    "budget_archive_target_inventory": down578,
    "enforce_budget_archive_outbox_state": down578,
    "transition_budget_archive_cancel_intent": down578,
    "get_budget_archive_targets": down578,
}
blocks = []
for name, path in targets.items():
    sql = path.read_text()
    matches = list(re.finditer(
        rf"(?ims)^\s*create(?:\s+or\s+replace)?\s+function\s+public\.{name}\b.*?\$\$;", sql
    ))
    if len(matches) != 1:
        raise SystemExit(f"expected one baseline definition for {name} in {path}; got {len(matches)}")
    block, changed = re.subn(
        rf"(?i)(create(?:\s+or\s+replace)?\s+function\s+)public\.{name}\b",
        rf"\1pmo_range_rollback_expected.{name}", matches[0].group(0), count=1
    )
    if changed != 1:
        raise SystemExit(f"could not isolate declaration for {name}")
    blocks.append(block)
output.write_text(
    "create schema pmo_range_rollback_expected;\nset search_path=public,pg_temp;\n"
    + "\n".join(blocks) + "\n"
)
PY

{
  cat <<'SQL'
begin;
set local statement_timeout='60s';
set local lock_timeout='5s';
SQL
  cat "$down0579"
  cat <<'SQL'
do $$
declare
  expected text[] := array[
    'public.activate_budget_version(uuid)',
    'public.budget_account_identity(uuid,text,text)',
    'public.budget_archive_target_inventory(uuid)',
    'public.enforce_budget_archive_outbox_state()',
    'public.get_budget_archive_targets(uuid)',
    'public.record_outbox_ref(uuid,integer,text,text,text,text)',
    'public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)'
  ];
  resolved integer;
  distinct_oids integer;
begin
  select count(*), count(distinct p.oid)::integer into resolved, distinct_oids
    from unnest(expected) e(signature)
    join pg_proc p on p.oid=to_regprocedure(e.signature)
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind='f'
     and length(btrim(coalesce(p.prosrc,'')))>0
     and length(btrim(coalesce(pg_get_functiondef(p.oid),'')))>0;
  if resolved <> cardinality(expected) or distinct_oids <> cardinality(expected) then
    raise exception '0579 downgrade expected seven exact, nonempty public baseline function identities with distinct OIDs; resolved %, distinct OIDs %', resolved, distinct_oids;
  end if;
  if to_regprocedure('public.queue_budget_archive_cancel(uuid,uuid,uuid)') is not null
     or exists(select 1 from information_schema.columns where table_schema='public'
       and table_name='budget_archive_requests' and column_name='queued_by_activation') then
    raise exception '0579 down left activation artifacts';
  end if;
end $$;
SQL
  cat "$down0578"
  cat <<'SQL'
do $$
declare
  expected text[] := array[
    'public.activate_budget_version(uuid)',
    'public.budget_account_identity(uuid,text,text)',
    'public.budget_archive_target_inventory(uuid)',
    'public.enforce_budget_archive_outbox_state()',
    'public.get_budget_archive_targets(uuid)',
    'public.record_outbox_ref(uuid,integer,text,text,text,text)',
    'public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)'
  ];
  resolved integer;
  distinct_oids integer;
begin
  select count(*), count(distinct p.oid)::integer into resolved, distinct_oids
    from unnest(expected) e(signature)
    join pg_proc p on p.oid=to_regprocedure(e.signature)
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind='f'
     and length(btrim(coalesce(p.prosrc,'')))>0
     and length(btrim(coalesce(pg_get_functiondef(p.oid),'')))>0;
  if resolved <> cardinality(expected) or distinct_oids <> cardinality(expected) then
    raise exception '0578 downgrade expected seven exact, nonempty public baseline function identities with distinct OIDs; resolved %, distinct OIDs %', resolved, distinct_oids;
  end if;
  if to_regprocedure('public.budget_account_identity(uuid,text,text,text)') is not null
     or to_regprocedure('public.read_budget_range_outbox_state(uuid,integer,text,text)') is not null
     or to_regprocedure('public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb)') is not null
     or to_regprocedure('public.budget_range_units_revert()') is not null
     or to_regprocedure('public.queue_budget_archive_cancel(uuid,uuid,uuid)') is not null then
    raise exception '0578/0579 down left range function artifacts';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and (
       (table_name='budget_archive_requests' and column_name='queued_by_activation')
    or (table_name='external_command_outbox' and column_name='budget_range_operation')
    or (table_name='budget_version_account_erp_mirror' and column_name='to_fiscal_year')
    or (table_name='budget_archive_cancel_intents' and column_name in ('to_fiscal_year','erp_modified')))) then
    raise exception '0578/0579 down left range columns';
  end if;
  if not exists(select 1 from pg_trigger t where t.tgrelid='public.external_command_outbox'::regclass
       and t.tgname='external_command_outbox_zz_enforce_budget_archive_outbox_state' and not t.tgisinternal)
     or not has_table_privilege('authenticated','public.budget_push_mirror_rows','select')
     or not has_table_privilege('service_role','public.budget_push_mirror_rows','select')
     or has_table_privilege('anon','public.budget_push_mirror_rows','select') then
    raise exception '0578 down did not restore the archive trigger or view grants';
  end if;
  if not has_function_privilege('service_role','public.record_outbox_ref(uuid,integer,text,text,text,text)','execute')
     or has_function_privilege('authenticated','public.record_outbox_ref(uuid,integer,text,text,text,text)','execute')
     or not has_function_privilege('service_role','public.budget_archive_target_inventory(uuid)','execute')
     or has_function_privilege('authenticated','public.budget_archive_target_inventory(uuid)','execute')
     or not has_function_privilege('authenticated','public.get_budget_archive_targets(uuid)','execute')
     or has_function_privilege('anon','public.get_budget_archive_targets(uuid)','execute')
     or not has_function_privilege('service_role','public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)','execute')
     or has_function_privilege('authenticated','public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)','execute') then
    raise exception '0578 down did not restore accepted archive RPC grants';
  end if;
end $$;
SQL
  cat "$expected_sql"
  cat <<'SQL'
do $$
declare
  names text[] := array[
    'activate_budget_version','record_outbox_ref','budget_archive_target_inventory',
    'enforce_budget_archive_outbox_state','transition_budget_archive_cancel_intent',
    'get_budget_archive_targets'
  ];
  name text;
  actual_oid oid;
  expected_oid oid;
  actual_definition text;
  expected_definition text;
begin
  foreach name in array names loop
    select p.oid into actual_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=name;
    select p.oid into expected_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='pmo_range_rollback_expected' and p.proname=name;
    if actual_oid is null or expected_oid is null then
      raise exception 'baseline comparison missing function %', name;
    end if;
    actual_definition := pg_get_functiondef(actual_oid);
    expected_definition := replace(pg_get_functiondef(expected_oid),
      'FUNCTION pmo_range_rollback_expected.', 'FUNCTION public.');
    if actual_definition is distinct from expected_definition then
      raise exception 'downgraded function % differs from accepted 0575/0577 baseline', name;
    end if;
    if (select proconfig from pg_proc where oid=actual_oid) is distinct from
       (select proconfig from pg_proc where oid=expected_oid) then
      raise exception 'downgraded function % changed search_path', name;
    end if;
  end loop;
end $$;
drop schema pmo_range_rollback_expected cascade;
SQL
  cat "$up0578"
  cat "$up0579"
  cat <<'SQL'
do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public'
       and table_name='budget_archive_requests' and column_name='queued_by_activation')
     or not exists(select 1 from information_schema.columns where table_schema='public'
       and table_name='external_command_outbox' and column_name='budget_range_operation')
     or not exists(select 1 from information_schema.columns where table_schema='public'
       and table_name='budget_version_account_erp_mirror' and column_name='to_fiscal_year') then
    raise exception '0578/0579 forward round-trip did not restore range schema';
  end if;
  if not has_function_privilege('service_role','public.read_budget_range_outbox_state(uuid,integer,text,text)','execute')
     or has_function_privilege('authenticated','public.read_budget_range_outbox_state(uuid,integer,text,text)','execute')
     or not has_function_privilege('service_role','public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb)','execute')
     or has_function_privilege('authenticated','public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb)','execute') then
    raise exception '0578 forward round-trip did not restore range RPC grants';
  end if;
end $$;
rollback;
SQL
} > "$probe"
probe_entered=1
psql_file < "$probe" >"$log" 2>&1 || { cat "$log" >&2; fail 'clean reverse/forward round-trip failed'; }
echo "OK: clean 0579→0578 reverse and 0578→0579 forward match baseline and restore current catalog"
