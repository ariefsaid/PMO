-- 1424_issue_closing_report.test.sql — #2678: Closing-time report for issues by department.
-- Spec: docs/specs/closing-time-report.spec.md; Plan: docs/plans/2026-11-21-closing-time-report.md.
-- AC-CTR-003 date range filtering
-- AC-CTR-004 duration math (average and median closing hours)
-- AC-CTR-005 open and overdue issues count
-- AC-CTR-006 custom department grouping
-- AC-CTR-007 unmapped issue types roll up to "Unassigned"
-- AC-CTR-008 RLS isolation between orgs and write role gating

begin;
create extension if not exists pgtap;
select plan(24);

-- Fixture Orgs
insert into organizations (id, name, default_currency) values
  ('26780000-0000-0000-0000-00000000000a', 'CTR Org A', 'USD'),
  ('26780000-0000-0000-0000-00000000000b', 'CTR Org B', 'USD');

-- Fixture Users & Profiles
insert into auth.users (id, email) values
  ('26780000-0000-0000-0000-0000000000a1', 'ctr-admin-a@example.com'),
  ('26780000-0000-0000-0000-0000000000a2', 'ctr-engineer-a@example.com'),
  ('26780000-0000-0000-0000-0000000000b1', 'ctr-admin-b@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('26780000-0000-0000-0000-0000000000a1', '26780000-0000-0000-0000-00000000000a', 'CTR Admin A', 'ctr-admin-a@example.com', 'Admin', 'active'),
  ('26780000-0000-0000-0000-0000000000a2', '26780000-0000-0000-0000-00000000000a', 'CTR Eng A',   'ctr-engineer-a@example.com', 'Engineer', 'active'),
  ('26780000-0000-0000-0000-0000000000b1', '26780000-0000-0000-0000-00000000000b', 'CTR Admin B', 'ctr-admin-b@example.com', 'Admin', 'active');

-- Report Settings (Org A enabled, Org B disabled by default)
insert into public.issue_closing_report_settings (org_id, enabled, grouping_mode) values
  ('26780000-0000-0000-0000-00000000000a', true, 'type'),
  ('26780000-0000-0000-0000-00000000000b', false, 'type');

-- Department Groups for Org A
insert into public.issue_department_groups (id, org_id, name, issue_types) values
  ('26780000-0000-0000-0000-0000000000c1', '26780000-0000-0000-0000-00000000000a', 'Civil & Earthworks', array['Civil', 'Excavation', 'Concrete']),
  ('26780000-0000-0000-0000-0000000000c2', '26780000-0000-0000-0000-00000000000a', 'Electrical & Controls', array['Electrical', 'Instrumentation']);

-- Incidents for Org A
-- 1: Civil, Nov 1, closed 24h later
insert into incident_reports (id, org_id, incident_date, type, severity, status, created_at, closed_at, reported_by) values
  ('26780000-0000-0000-0000-000000000001', '26780000-0000-0000-0000-00000000000a', '2026-11-01', 'Civil', 'Low', 'Closed',
   '2026-11-01 08:00:00+00', '2026-11-02 08:00:00+00', '26780000-0000-0000-0000-0000000000a1');

-- 2: Civil, Nov 3, closed 60h later
insert into incident_reports (id, org_id, incident_date, type, severity, status, created_at, closed_at, reported_by) values
  ('26780000-0000-0000-0000-000000000002', '26780000-0000-0000-0000-00000000000a', '2026-11-03', 'Civil', 'Medium', 'Closed',
   '2026-11-03 08:00:00+00', '2026-11-05 20:00:00+00', '26780000-0000-0000-0000-0000000000a1');

-- 3: Excavation, Nov 4, open and overdue
insert into incident_reports (id, org_id, incident_date, type, severity, status, due_at, created_at, reported_by) values
  ('26780000-0000-0000-0000-000000000003', '26780000-0000-0000-0000-00000000000a', '2026-11-04', 'Excavation', 'High', 'Open',
   '2026-11-06 17:00:00+00', '2026-11-04 08:00:00+00', '26780000-0000-0000-0000-0000000000a1');

-- 4: Electrical, Nov 5, closed 10h later
insert into incident_reports (id, org_id, incident_date, type, severity, status, created_at, closed_at, reported_by) values
  ('26780000-0000-0000-0000-000000000004', '26780000-0000-0000-0000-00000000000a', '2026-11-05', 'Electrical', 'Low', 'Closed',
   '2026-11-05 08:00:00+00', '2026-11-05 18:00:00+00', '26780000-0000-0000-0000-0000000000a1');

-- 5: Piping (unmapped), Nov 6, closed 12h later
insert into incident_reports (id, org_id, incident_date, type, severity, status, created_at, closed_at, reported_by) values
  ('26780000-0000-0000-0000-000000000005', '26780000-0000-0000-0000-00000000000a', '2026-11-06', 'Piping', 'Low', 'Closed',
   '2026-11-06 08:00:00+00', '2026-11-06 20:00:00+00', '26780000-0000-0000-0000-0000000000a1');

-- 6: October issue (outside Nov date range)
insert into incident_reports (id, org_id, incident_date, type, severity, status, created_at, closed_at, reported_by) values
  ('26780000-0000-0000-0000-000000000006', '26780000-0000-0000-0000-00000000000a', '2026-10-15', 'Civil', 'Low', 'Closed',
   '2026-10-15 08:00:00+00', '2026-10-16 08:00:00+00', '26780000-0000-0000-0000-0000000000a1');

-- Incident for Org B
insert into incident_reports (id, org_id, incident_date, type, severity, status, created_at, closed_at, reported_by) values
  ('26780000-0000-0000-0000-0000000000b9', '26780000-0000-0000-0000-00000000000b', '2026-11-01', 'Civil', 'Low', 'Closed',
   '2026-11-01 08:00:00+00', '2026-11-02 08:00:00+00', '26780000-0000-0000-0000-0000000000b1');

-- ── 1. AC-CTR-008: Tables exist and have RLS enabled ─────────────────
select ok(
  (select relrowsecurity from pg_class where relname = 'issue_closing_report_settings'),
  'AC-CTR-008: issue_closing_report_settings has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'issue_department_groups'),
  'AC-CTR-008: issue_department_groups has RLS enabled'
);

-- ── 2. Authenticate as Org A Engineer ─────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '26780000-0000-0000-0000-0000000000a2',
  'email', 'ctr-engineer-a@example.com'
)::text, true);

-- Test settings select
select is(
  (select enabled from public.issue_closing_report_settings where org_id = '26780000-0000-0000-0000-00000000000a'),
  true,
  'Org A active member reads own report setting'
);
select is(
  (select count(*)::int from public.issue_closing_report_settings where org_id = '26780000-0000-0000-0000-00000000000b'),
  0,
  'AC-CTR-008: Org A caller cannot read Org B settings'
);

-- Test department groups select
select is(
  (select count(*)::int from public.issue_department_groups),
  2,
  'Org A active member reads own department groups'
);

-- Engineer cannot insert department group (Admin / PM only)
select throws_ok(
  $$ insert into public.issue_department_groups (name, issue_types) values ('HSE', array['Safety']) $$,
  '42501',
  null,
  'AC-CTR-008: Engineer cannot add department group'
);

-- ── 3. AC-CTR-004 & AC-CTR-005: Raw Type Grouping Mode ────────────────
-- With date filter for November 2026:
-- Civil: 2 closed (24h, 60h => avg = 42, median = 42), 0 open, 0 overdue
select is(
  (select total_issues from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'type') where department = 'Civil'),
  2::bigint,
  'AC-CTR-003: Civil total in Nov is 2 (Oct issue excluded)'
);
select is(
  (select closed_issues from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'type') where department = 'Civil'),
  2::bigint,
  'AC-CTR-004: Civil closed count is 2'
);
select is(
  (select round(avg_closing_hours, 1) from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'type') where department = 'Civil'),
  42.0::numeric,
  'AC-CTR-004: Civil average closing hours is 42.0h'
);
select is(
  (select round(median_closing_hours, 1) from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'type') where department = 'Civil'),
  42.0::numeric,
  'AC-CTR-004: Civil median closing hours is 42.0h'
);

-- Excavation: 1 open, 1 overdue, 0 closed
select is(
  (select open_issues from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'type') where department = 'Excavation'),
  1::bigint,
  'AC-CTR-005: Excavation has 1 open issue'
);
select is(
  (select overdue_issues from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'type') where department = 'Excavation'),
  1::bigint,
  'AC-CTR-005: Excavation has 1 overdue issue'
);
select is(
  (select avg_closing_hours from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'type') where department = 'Excavation'),
  null,
  'AC-CTR-004: Excavation has null avg closing hours because none closed'
);

-- Electrical: 1 closed, 10h
select is(
  (select round(avg_closing_hours, 1) from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'type') where department = 'Electrical'),
  10.0::numeric,
  'AC-CTR-004: Electrical average closing hours is 10.0h'
);

-- ── 4. AC-CTR-006 & AC-CTR-007: Department Groups Mode ────────────────
-- 'Civil & Earthworks' includes 'Civil' and 'Excavation'
-- Total = 3 (2 Civil closed + 1 Excavation open), Closed = 2, Open = 1, Overdue = 1, Avg = 42.0
select is(
  (select total_issues from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'department_groups') where department = 'Civil & Earthworks'),
  3::bigint,
  'AC-CTR-006: Civil & Earthworks department group combines Civil and Excavation issues (total 3)'
);
select is(
  (select closed_issues from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'department_groups') where department = 'Civil & Earthworks'),
  2::bigint,
  'AC-CTR-006: Civil & Earthworks has 2 closed issues'
);
select is(
  (select open_issues from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'department_groups') where department = 'Civil & Earthworks'),
  1::bigint,
  'AC-CTR-006: Civil & Earthworks has 1 open issue'
);
select is(
  (select overdue_issues from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'department_groups') where department = 'Civil & Earthworks'),
  1::bigint,
  'AC-CTR-006: Civil & Earthworks has 1 overdue issue'
);
select is(
  (select round(avg_closing_hours, 1) from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'department_groups') where department = 'Civil & Earthworks'),
  42.0::numeric,
  'AC-CTR-006: Civil & Earthworks avg closing hours is 42.0h'
);

-- Electrical & Controls: 1 closed (10h)
select is(
  (select total_issues from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'department_groups') where department = 'Electrical & Controls'),
  1::bigint,
  'AC-CTR-006: Electrical & Controls department group has 1 issue'
);

-- AC-CTR-007: 'Piping' is unmapped in groups mode, rolls up under 'Unassigned'
select is(
  (select total_issues from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'department_groups') where department = 'Unassigned'),
  1::bigint,
  'AC-CTR-007: Unmapped Piping issue rolls up under Unassigned'
);
select is(
  (select round(avg_closing_hours, 1) from public.get_issue_closing_time_report('2026-11-01', '2026-11-30', 'department_groups') where department = 'Unassigned'),
  12.0::numeric,
  'AC-CTR-007: Unassigned closing time matches Piping issue (12.0h)'
);

-- ── 5. Cross-Org Isolation ───────────────────────────────────────────
-- Org B's issue is NOT included in Org A's report
select is(
  (select count(*)::int from public.get_issue_closing_time_report(null, null, 'type') where department = 'Civil' and total_issues > 3),
  0,
  'AC-CTR-008: Org A report does not include Org B issues'
);

-- Authenticate as Org B Admin
select set_config('request.jwt.claims', json_build_object(
  'sub', '26780000-0000-0000-0000-0000000000b1',
  'email', 'ctr-admin-b@example.com'
)::text, true);

select is(
  (select total_issues from public.get_issue_closing_time_report(null, null, 'type') where department = 'Civil'),
  1::bigint,
  'AC-CTR-008: Org B caller sees only Org B issues (1 Civil issue)'
);

select * from finish();
rollback;
