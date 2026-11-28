begin;
create extension if not exists pgtap;
select plan(8);
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('28030000-0000-0000-0000-000000000002', 'Schedule rights', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('28030000-0000-0000-0000-000000000061', 'schedule-pa@example.com'),
  ('28030000-0000-0000-0000-000000000062', 'schedule-planner@example.com'),
  ('28030000-0000-0000-0000-000000000063', 'schedule-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('28030000-0000-0000-0000-000000000061', '28030000-0000-0000-0000-000000000002', 'Reporting', 'schedule-pa@example.com', 'Engineer', 'active', 'project_administrator'),
  ('28030000-0000-0000-0000-000000000062', '28030000-0000-0000-0000-000000000002', 'Planner', 'schedule-planner@example.com', 'Engineer', 'active', 'planner'),
  ('28030000-0000-0000-0000-000000000063', '28030000-0000-0000-0000-000000000002', 'Admin', 'schedule-admin@example.com', 'Admin', 'active', null);
create temp table ids (id uuid);
grant all on ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"28030000-0000-0000-0000-000000000063","role":"authenticated"}', true);
insert into ids select save_scheduled_report(null, 'Admin schedule', 'daily_progress', 'daily', null, '08:00', '{}', array['Engineer'], false);
select set_config('request.jwt.claims', '{"sub":"28030000-0000-0000-0000-000000000061","role":"authenticated"}', true);
select lives_ok($$insert into ids select save_scheduled_report(null, 'Progress', 'daily_progress', 'daily', null, '08:00', '{}', array['Engineer'], false)$$, 'AC-RR-009 project administrator creates a progress schedule');
select lives_ok($$insert into ids select save_scheduled_report(null, 'Summary', 'overdue_tasks', 'weekly', 1, '08:00', '{}', array['Engineer'], false)$$, 'AC-RR-009 project administrator creates a summary schedule');
select is((select count(*)::int from scheduled_reports), 2, 'project administrator reads schedules created by that role');
select lives_ok($$select set_scheduled_report_enabled((select id from scheduled_reports where name = 'Progress'), true)$$, 'project administrator enables a schedule');
select throws_ok($$select set_scheduled_report_enabled((select id from ids limit 1), true)$$, '42501', 'admin only', 'project administrator cannot edit an Admin schedule');
select throws_ok($$select save_scheduled_report(null, 'Forbidden', 'daily_progress', 'daily', null, '08:00', array['28030000-0000-0000-0000-000000000063']::uuid[], array['foreman'], true)$$, '42501', null, 'project administrator cannot target a light role');
select set_config('request.jwt.claims', '{"sub":"28030000-0000-0000-0000-000000000062","role":"authenticated"}', true);
select is((select count(*)::int from scheduled_reports), 0, 'planner cannot read schedules');
select throws_ok($$select save_scheduled_report(null, 'No', 'daily_progress', 'daily', null, '08:00', '{}', array['Engineer'], false)$$, '42501', 'admin only', 'planner cannot create a schedule');
select * from finish();
rollback;
