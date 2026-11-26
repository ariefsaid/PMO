-- record_changes_catalog_gate.test.sql — #719 record change history, the standing catalog gate (spec D1, D2).
-- AC-CHG-011: every registry table carries the capture trigger (AFTER INSERT OR UPDATE, FOR EACH ROW); no
-- capture trigger exists off-registry; every column of a tracked table is classified exactly once (captured /
-- flag / omit) and nothing is classified that does not exist; every captured kind is a known kind; every
-- captured column is SELECT-able by authenticated; every registry entity's row resolves to a readable table
-- (since 1490 the registry row IS the record_history_visible arm, so the check is "the arm works", not "the
-- function lists it").
-- The gate names its offenders, and a planted-defect self-test proves each check can turn red.
-- This is the 0074 lesson's missing half: a trigger attached by list silently misses what is added later.
-- Migration under test: 0260_record_change_history.sql.
begin;
create extension if not exists pgtap;
select plan(9);

\ir record-changes-catalog-gaps.inc

-- record_history_visible arm per registry entity: every registered row must resolve to a readable table (since
-- 1490 the row is the arm), so this names a registration whose table is gone rather than a missing case arm.
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
  'AC-CHG-011 every registry entity resolves to a readable table (its visibility arm)');
select is((select count(*)::int from public.record_history_config), 21,
  'AC-CHG-011 21 registered record types including PMO and ERP invoice mirrors, the two vendor-withholding-slip tables, pipeline stage entries, usage standards, third-party inspections, crew tool lines and safety days');

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

insert into public.record_history_config (entity_type, table_name, captured)
  values ('zz_planted_entity', 'zz_planted_missing_table', '{}'::jsonb);
select is(pg_temp.chg_arm_gaps(), 'zz_planted_entity',
  'AC-CHG-011 self-test: a registry row whose table cannot be read is named (the row is the arm since 1490)');
rollback to savepoint plant;

-- ── restored ────────────────────────────────────────────────────────────────────────────────────
select is((select string_agg(gap, '; ' order by gap) from chg_gate_gaps), null,
  'AC-CHG-011 (control) the catalog is clean again after the planted defects are rolled back');

select * from finish();
rollback;
