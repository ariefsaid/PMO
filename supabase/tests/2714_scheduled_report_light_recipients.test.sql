-- 2714_scheduled_report_light_recipients.test.sql — #2711, M-2. A report chosen by role leaves the field accounts out.
-- Migration under test: 1463 (the role arm of scheduled_report_tick skips a light account).
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   drop `and not public.is_light_role_key(p.built_in_role)` from the tick .. 'a report chosen by role skips a field account'
begin;
create extension if not exists pgtap;
select plan(5);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled)
  values ('27140000-0000-0000-0000-00000000000a', 'LAS Org', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('27140000-0000-0000-0000-0000000000a1', 'las-admin@example.com'),
  ('27140000-0000-0000-0000-0000000000a3', 'las-eng@example.com'),
  ('27140000-0000-0000-0000-0000000000a5', 'las-foreman@example.com'),
  ('27140000-0000-0000-0000-0000000000a6', 'las-field@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27140000-0000-0000-0000-0000000000a1', '27140000-0000-0000-0000-00000000000a', 'LAS Admin', 'las-admin@example.com', 'Admin', 'active', null),
  ('27140000-0000-0000-0000-0000000000a3', '27140000-0000-0000-0000-00000000000a', 'LAS Eng', 'las-eng@example.com', 'Engineer', 'active', null),
  ('27140000-0000-0000-0000-0000000000a5', '27140000-0000-0000-0000-00000000000a', 'LAS Foreman', 'las-foreman@example.com', 'Engineer', 'active', 'foreman'),
  ('27140000-0000-0000-0000-0000000000a6', '27140000-0000-0000-0000-00000000000a', 'LAS Field', 'las-field@example.com', 'Engineer', 'active', 'field_user');
insert into scheduled_reports (id, org_id, name, kind, frequency, send_time, recipient_roles, enabled, created_by, created_at)
  values ('27140000-0000-0000-0000-0000000000e1', '27140000-0000-0000-0000-00000000000a', 'LAS report',
          'overdue_tasks', 'daily', '00:00', '{Engineer}', true, '27140000-0000-0000-0000-0000000000a1', now() - interval '1 day');

select is(public.scheduled_report_tick(), 1, 'M-2 a report chosen by role reaches the full Engineer only');
select is((select count(*)::int from public.email_outbox where report_id = '27140000-0000-0000-0000-0000000000e1'), 1,
  'M-2 exactly one recipient row is queued for the report');
select is((select recipient_id from public.email_outbox where report_id = '27140000-0000-0000-0000-0000000000e1'),
  '27140000-0000-0000-0000-0000000000a3'::uuid, 'M-2 the full Engineer receives it');
select is((select count(*)::int from public.email_outbox
            where report_id = '27140000-0000-0000-0000-0000000000e1'
              and recipient_id in ('27140000-0000-0000-0000-0000000000a5', '27140000-0000-0000-0000-0000000000a6')), 0,
  'M-2 a report chosen by role skips a field account');
select is((select queued from public.scheduled_report_runs where report_id = '27140000-0000-0000-0000-0000000000e1'),
  1, 'M-2 the run records the one row it queued');

select * from finish();
rollback;
