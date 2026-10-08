-- record_changes_catalog_gate.test.sql — #719 record change history, the standing catalog gate (spec D1, D2).
-- AC-CHG-011: every registry table carries the capture trigger (AFTER INSERT OR UPDATE, FOR EACH ROW); no
-- capture trigger exists off-registry; every column of a tracked table is classified exactly once (captured /
-- flag / omit) and nothing is classified that does not exist; every captured kind is a known kind; every
-- captured column is SELECT-able by authenticated; every registry entity has a record_history_visible arm.
-- The gate names its offenders, and a planted-defect self-test proves each check can turn red.
-- This is the 0074 lesson's missing half: a trigger attached by list silently misses what is added later.
-- Migration under test: 0260_record_change_history.sql.
begin;
create extension if not exists pgtap;
select plan(9);

create temp view chg_gate_gaps as
with cfg as (
  select c.table_name, k.col, k.cls, k.kind
    from public.record_history_config c
    cross join lateral (
      select e.key as col, 'captured'::text as cls, e.value #>> '{}' as kind from jsonb_each(c.captured) e
      union all select unnest(c.flag_cols), 'flag', null
      union all select unnest(c.omit_cols), 'omit', null) k),
cols as (
  select c.relname::text as table_name, a.attname::text as col
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
     and c.relname in (select table_name from public.record_history_config)),
trg as (
  select t.tgrelid::regclass::text as rel, t.tgname::text as tgname, t.tgtype::int as tgtype
    from pg_trigger t
   where not t.tgisinternal and t.tgfoid = 'public.record_change_capture()'::regprocedure)
select cols.table_name || '.' || cols.col || ' unclassified' as gap
  from cols left join cfg using (table_name, col) where cfg.col is null
union all
select cfg.table_name || '.' || cfg.col || ' classified more than once'
  from cfg group by cfg.table_name, cfg.col having count(*) > 1
union all
select cfg.table_name || '.' || cfg.col || ' classified but does not exist'
  from cfg left join cols using (table_name, col) where cols.col is null
union all
select cfg.table_name || '.' || cfg.col || ' unknown kind ' || coalesce(cfg.kind, 'null')
  from cfg where cfg.cls = 'captured'
   and coalesce(cfg.kind, '') not in ('text', 'number', 'money', 'date', 'timestamp', 'enum', 'ref', 'bool')
union all
select cfg.table_name || '.' || cfg.col || ' captured but not SELECT-able by authenticated'
  from cfg join cols using (table_name, col)
 where cfg.cls = 'captured'
   and not has_column_privilege('authenticated', 'public.' || cfg.table_name, cfg.col, 'SELECT')
union all
select c.table_name || ' has no capture trigger'
  from public.record_history_config c
 where not exists (select 1 from trg where trg.rel = c.table_name)
union all
select trg.rel || '.' || trg.tgname || ' captures off-registry'
  from trg where trg.rel not in (select table_name from public.record_history_config)
union all
select trg.rel || '.' || trg.tgname || ' is not AFTER INSERT OR UPDATE FOR EACH ROW'
  from trg where trg.tgtype <> (1 | 4 | 16);   -- ROW | INSERT | UPDATE, not BEFORE, no DELETE

-- record_history_visible arm per registry entity: an entity without an arm raises.
create function pg_temp.chg_arm_gaps() returns text language plpgsql as $$
declare r record; v_out text;
begin
  for r in select entity_type from public.record_history_config order by entity_type loop
    begin
      perform public.record_history_visible(r.entity_type, gen_random_uuid());
    exception when others then
      v_out := concat_ws(', ', v_out, r.entity_type);
    end;
  end loop;
  return v_out;
end $$;

-- ── the live catalog is clean ───────────────────────────────────────────────────────────────────
select is((select string_agg(gap, '; ' order by gap) from chg_gate_gaps), null,
  'AC-CHG-011 registry, triggers, classification and column privileges agree (offenders named)');
select is(pg_temp.chg_arm_gaps(), null,
  'AC-CHG-011 every registry entity has a record_history_visible arm');
select is((select count(*)::int from public.record_history_config), 14,
  'AC-CHG-011 the registered set includes the two vendor-withholding-slip tables: 14 tables');

-- ── planted defects: each check turns red and names the defect ──────────────────────────────────
savepoint plant;
alter table public.companies add column zz_planted_col text;
select is((select string_agg(gap, '; ' order by gap) from chg_gate_gaps), 'companies.zz_planted_col unclassified',
  'AC-CHG-011 self-test: a new unclassified column on a tracked table is named');
rollback to savepoint plant;

drop trigger contacts_zz_record_change on public.contacts;
select is((select string_agg(gap, '; ' order by gap) from chg_gate_gaps), 'contacts has no capture trigger',
  'AC-CHG-011 self-test: a tracked table that lost its trigger is named');
rollback to savepoint plant;

create trigger incident_reports_zz_record_change after insert or update on public.incident_reports
  for each row execute function public.record_change_capture();
select is((select string_agg(gap, '; ' order by gap) from chg_gate_gaps),
  'incident_reports.incident_reports_zz_record_change captures off-registry',
  'AC-CHG-011 self-test: a capture trigger on a table outside the registry is named');
rollback to savepoint plant;

do $$
declare v_cols text;
begin
  select string_agg(quote_ident(attname), ', ') into v_cols
    from pg_attribute where attrelid = 'public.companies'::regclass and attnum > 0 and not attisdropped
     and attname <> 'name';
  execute 'revoke select on public.companies from authenticated';
  execute format('grant select (%s) on public.companies to authenticated', v_cols);
end $$;
select is((select string_agg(gap, '; ' order by gap) from chg_gate_gaps),
  'companies.name captured but not SELECT-able by authenticated',
  'AC-CHG-011 self-test: a captured column whose SELECT is revoked is named');
rollback to savepoint plant;

insert into public.record_history_config (entity_type, table_name, captured, omit_cols)
  select 'zz_planted_entity', 'incident_reports', '{}'::jsonb,
         array_agg(attname::text) from pg_attribute
   where attrelid = 'public.incident_reports'::regclass and attnum > 0 and not attisdropped;
select is(pg_temp.chg_arm_gaps(), 'zz_planted_entity',
  'AC-CHG-011 self-test: a registry entity with no visibility arm is named');
rollback to savepoint plant;

-- ── restored ────────────────────────────────────────────────────────────────────────────────────
select is((select string_agg(gap, '; ' order by gap) from chg_gate_gaps), null,
  'AC-CHG-011 (control) the catalog is clean again after the planted defects are rolled back');

select * from finish();
rollback;
