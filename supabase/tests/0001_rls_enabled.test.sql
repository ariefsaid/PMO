begin;
select plan(2);

-- AC-105: every one of the 16 business tables has rowsecurity = true.
-- Asserted as two counts to avoid name/text collation pitfalls in results_eq:
--   (1) exactly 16 of the named business tables exist with RLS on;
--   (2) zero named business tables exist with RLS off (no gaps).
select is(
  (select count(*)::int from pg_tables
     where schemaname = 'public'
       and tablename = any (array[
         'organizations','profiles','companies','projects','procurements','procurement_items',
         'procurement_quotations','procurement_documents','budget_versions','budget_line_items',
         'timesheets','timesheet_entries','tasks','task_dependencies','incident_reports','project_documents'])
       and rowsecurity = true),
  16,
  'AC-105: all 16 business tables have RLS enabled');

select is(
  (select count(*)::int from pg_tables
     where schemaname = 'public'
       and tablename = any (array[
         'organizations','profiles','companies','projects','procurements','procurement_items',
         'procurement_quotations','procurement_documents','budget_versions','budget_line_items',
         'timesheets','timesheet_entries','tasks','task_dependencies','incident_reports','project_documents'])
       and rowsecurity = false),
  0,
  'AC-105: no business table is missing RLS');

select * from finish();
rollback;
