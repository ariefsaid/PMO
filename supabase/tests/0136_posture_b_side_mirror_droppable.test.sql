-- AC-XING-004 — the ERPNext crossing (#481, step 4 of #590): the Posture-B side mirror is
-- reversible by construction (ADR-0059 §6, invariant 7). Dropping `timesheet_erp_mirror` and
-- `budget_version_erp_mirror` must lose NO row PMO owns — the mirror carries only external-side
-- state, never a fact PMO itself is the source of truth for.
begin;
-- ⚑ 7 TAP-emitting assertions below (set_eq, 2×lives_ok, 2×has_table, 2×is_empty); the
-- `create temporary table xing_before` step is setup, not a test. The plan's own draft declared
-- plan(8) — pg_prove caught the miscount ("planned 8 tests but ran 7", 0 of the 7 failing) — fixed
-- here to match the assertions actually written, never inflated to hit an arbitrary count.
select plan(7);

-- 1. The side mirror is EXACTLY these two tables. A third one appearing must break this test, not
--    silently escape A4's scope.
select set_eq(
  $$ select table_name::text from information_schema.tables
      where table_schema = 'public' and table_name like '%\_erp\_mirror' $$,
  $$ values ('timesheet_erp_mirror'), ('budget_version_erp_mirror') $$,
  'AC-XING-004 the Posture-B side mirror is exactly timesheet_erp_mirror + budget_version_erp_mirror'
);

-- 2. Record the PMO SoT row counts BEFORE the drop.
create temporary table xing_before as
select 'timesheets'         as t, count(*)::bigint as n from public.timesheets
union all select 'timesheet_entries',  count(*) from public.timesheet_entries
union all select 'budget_versions',    count(*) from public.budget_versions
union all select 'budget_line_items',  count(*) from public.budget_line_items
union all select 'projects',           count(*) from public.projects;

-- 3. RESTRICT, not CASCADE: invariant 7 says the mirror carries only external-side state, so nothing
--    PMO owns may depend on it. A dependency here is the finding, and it must be loud.
select lives_ok(
  'drop table public.timesheet_erp_mirror restrict',
  'AC-XING-004 timesheet_erp_mirror drops with RESTRICT — nothing PMO owns depends on it'
);
select lives_ok(
  'drop table public.budget_version_erp_mirror restrict',
  'AC-XING-004 budget_version_erp_mirror drops with RESTRICT — nothing PMO owns depends on it'
);

-- 4. Every PMO SoT table still exists and still holds every row.
select has_table('public', 'timesheets',        'AC-XING-004 timesheets survives the drop');
select has_table('public', 'budget_versions',   'AC-XING-004 budget_versions survives the drop');
select is_empty(
  $$ select b.t from xing_before b
       join (select 'timesheets' as t, count(*)::bigint as n from public.timesheets
             union all select 'timesheet_entries', count(*) from public.timesheet_entries
             union all select 'budget_versions',   count(*) from public.budget_versions
             union all select 'budget_line_items', count(*) from public.budget_line_items
             union all select 'projects',          count(*) from public.projects) a
         on a.t = b.t
      where a.n <> b.n $$,
  'AC-XING-004 dropping both side mirrors changes no PMO row count'
);
select is_empty(
  $$ select external_record_id from public.external_refs where domain = 'timesheets' limit 1 $$,
  'AC-XING-004 (context) the seed carries no timesheets external_refs, so the count check above is not vacuous'
);

select * from finish();
rollback;
