begin;
select plan(2);

-- AC-LOW-1: every one of the 16 business tables has relforcerowsecurity = true.
-- Two counts mirror the pattern in 0001_rls_enabled.test.sql: a positive count
-- (all 16 present with FORCE on) and a zero count (none missing FORCE).

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any (array[
            'organizations','profiles','companies','projects','procurements',
            'procurement_items','procurement_quotations','procurement_documents',
            'budget_versions','budget_line_items','timesheets','timesheet_entries',
            'tasks','task_dependencies','incident_reports','project_documents'])
      and c.relforcerowsecurity = true),
  16,
  'AC-LOW-1: all 16 business tables have FORCE ROW LEVEL SECURITY enabled');

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any (array[
            'organizations','profiles','companies','projects','procurements',
            'procurement_items','procurement_quotations','procurement_documents',
            'budget_versions','budget_line_items','timesheets','timesheet_entries',
            'tasks','task_dependencies','incident_reports','project_documents'])
      and c.relforcerowsecurity = false),
  0,
  'AC-LOW-1: no business table is missing FORCE ROW LEVEL SECURITY');

select * from finish();
rollback;
