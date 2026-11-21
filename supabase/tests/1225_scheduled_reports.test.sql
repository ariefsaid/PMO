-- 1225_scheduled_reports.test.sql — #2714. AC-SCH-001..008, 010, 012.
-- Written test-first; run by the orchestrator once per wave. Mutation notes at the foot (each named line must turn red).
begin;
create extension if not exists pgtap;
select plan(44);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27140000-0000-0000-0000-00000000000a', 'SCH Org A', 'IDR', 'Pacific/Auckland'),
  ('27140000-0000-0000-0000-00000000000b', 'SCH Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('27140000-0000-0000-0000-0000000000a1', 'sch-admin@example.com'),
  ('27140000-0000-0000-0000-0000000000a2', 'sch-pm@example.com'),
  ('27140000-0000-0000-0000-0000000000a3', 'sch-eng@example.com'),
  ('27140000-0000-0000-0000-0000000000a4', 'sch-fin@example.com'),
  ('27140000-0000-0000-0000-0000000000a5', 'sch-off@example.com'),
  ('27140000-0000-0000-0000-0000000000a6', 'sch-pm2@example.com'),
  ('27140000-0000-0000-0000-0000000000b1', 'sch-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27140000-0000-0000-0000-0000000000a1', '27140000-0000-0000-0000-00000000000a', 'Admin', 'sch-admin@example.com', 'Admin', 'active'),
  ('27140000-0000-0000-0000-0000000000a2', '27140000-0000-0000-0000-00000000000a', 'PM One', 'sch-pm@example.com', 'Project Manager', 'active'),
  ('27140000-0000-0000-0000-0000000000a3', '27140000-0000-0000-0000-00000000000a', 'Engineer', 'sch-eng@example.com', 'Engineer', 'active'),
  ('27140000-0000-0000-0000-0000000000a4', '27140000-0000-0000-0000-00000000000a', 'Finance', 'sch-fin@example.com', 'Finance', 'active'),
  ('27140000-0000-0000-0000-0000000000a5', '27140000-0000-0000-0000-00000000000a', 'Opted out', 'sch-off@example.com', 'Engineer', 'active'),
  ('27140000-0000-0000-0000-0000000000a6', '27140000-0000-0000-0000-00000000000a', 'PM Two', 'sch-pm2@example.com', 'Project Manager', 'active'),
  ('27140000-0000-0000-0000-0000000000b1', '27140000-0000-0000-0000-00000000000b', 'Org B PM', 'sch-b@example.com', 'Project Manager', 'active');
insert into email_user_prefs (user_id, org_id, opted_out) values ('27140000-0000-0000-0000-0000000000a5', '27140000-0000-0000-0000-00000000000a', true);

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;
create function pg_temp.rows(p_report uuid default null) returns int language sql as $$
  select count(*)::int from email_outbox where report_id is not null and (p_report is null or report_id = p_report) $$;
create function pg_temp.local_now() returns timestamp language sql as $$ select now() at time zone 'Pacific/Auckland' $$;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

-- AC-SCH-001: nothing exists -> the tick queues nothing and writes no run
select is(scheduled_report_tick(), 0, 'AC-SCH-001 with no scheduled report the tick queues nothing');
select is((select count(*)::int from scheduled_report_runs), 0, 'AC-SCH-001 and writes no run record');

-- AC-SCH-008 first: only an Admin writes
set local role authenticated;
select pg_temp.act_as('27140000-0000-0000-0000-0000000000a2');
select throws_ok($$select save_scheduled_report(null, 'X', 'daily_progress', 'daily', null, '08:00', '{}', '{Engineer}', true)$$, '42501', 'admin only', 'AC-SCH-008 a non-Admin cannot create a report');
select throws_ok($$insert into scheduled_reports (org_id, name, kind, frequency, send_time, recipient_roles) values ('27140000-0000-0000-0000-00000000000a','X','daily_progress','daily','08:00','{Engineer}')$$, '42501', null, 'AC-SCH-008 no direct client insert');
select throws_ok($$select * from scheduled_report_runs$$, '42501', null, 'AC-SCH-008 no client can read the run record');
select throws_ok($$select * from email_outbox$$, '42501', null, 'AC-SCH-008 no client can read the outbox');
select is((select count(*)::int from scheduled_reports), 0, 'AC-SCH-008 a non-Admin reads no report row');

select pg_temp.act_as('27140000-0000-0000-0000-0000000000a1');
select throws_ok($$select save_scheduled_report(null, 'X', 'nonsense', 'daily', null, '08:00', '{}', '{Engineer}', true)$$, '22023', 'unknown report kind', 'AC-SCH-008 an unknown kind is refused');
select throws_ok($$select save_scheduled_report(null, 'X', 'daily_progress', 'monthly', null, '08:00', '{}', '{Engineer}', true)$$, '22023', 'unknown frequency', 'AC-SCH-008 an unknown frequency is refused');
select throws_ok($$select save_scheduled_report(null, 'X', 'daily_progress', 'weekly', null, '08:00', '{}', '{Engineer}', true)$$, '22023', null, 'AC-SCH-008 weekly needs a weekday');
select throws_ok($$select save_scheduled_report(null, 'X', 'daily_progress', 'daily', null, '08:00', '{}', '{}', true)$$, '22023', null, 'AC-SCH-008 no recipient is refused');
select throws_ok($$select save_scheduled_report(null, 'X', 'daily_progress', 'daily', null, '08:00', '{}', (select array_agg('r' || g) from generate_series(1, 51) g), true)$$, '22023', null, 'AC-SCH-008 more than 50 recipients is refused');
-- AC-SCH-005: a person of another organisation listed by id is dropped, leaving no recipient
select throws_ok($$select save_scheduled_report(null, 'X', 'daily_progress', 'daily', null, '08:00', '{27140000-0000-0000-0000-0000000000b1}', '{}', true)$$, '22023', null, 'AC-SCH-005 another organisation''s person cannot be a recipient');


-- A due daily progress report. Recipients: PM One and Engineer by id, plus the Engineer and Finance roles (the opted-out
-- Engineer matches by role and gets nothing; PM Two is not listed).
insert into ids select 'daily', save_scheduled_report(null, 'Daily progress', 'daily_progress', 'daily', null, '00:00',
  array['27140000-0000-0000-0000-0000000000a2','27140000-0000-0000-0000-0000000000a3']::uuid[], array['Engineer','Finance'], true);
reset role;
select is((select count(*)::int from scheduled_reports where org_id = '27140000-0000-0000-0000-00000000000a'), 1, 'AC-SCH-008 an Admin created the report in their own organisation');

-- AC-SCH-003: created after today's send time -> waits for the next period (no retroactive send)
select is(scheduled_report_tick(), 0, 'AC-SCH-003 a report created after its send time sends nothing today');
update scheduled_reports set created_at = now() - interval '2 days';

-- Site-report data for the local day: validated reports with frozen revenue on Alpha (PM One) and Bravo (PM Two); Org B has its own.
insert into projects (id, org_id, name, status, project_manager_id) values
  ('27140000-0000-0000-0000-0000000000d1', '27140000-0000-0000-0000-00000000000a', 'Alpha Site', 'Ongoing Project', '27140000-0000-0000-0000-0000000000a2'),
  ('27140000-0000-0000-0000-0000000000d2', '27140000-0000-0000-0000-00000000000a', 'Bravo Site', 'Ongoing Project', '27140000-0000-0000-0000-0000000000a6'),
  ('27140000-0000-0000-0000-0000000000d3', '27140000-0000-0000-0000-00000000000b', 'OrgB Site', 'Ongoing Project', '27140000-0000-0000-0000-0000000000b1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27140000-0000-0000-0000-0000000000e1', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000d1', 'WO alpha', 'Issued', 10000, 'exclusive', 0),
  ('27140000-0000-0000-0000-0000000000e2', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000d2', 'WO bravo', 'Issued', 10000, 'exclusive', 0),
  ('27140000-0000-0000-0000-0000000000e3', '27140000-0000-0000-0000-00000000000b', '27140000-0000-0000-0000-0000000000d3', 'WO orgb', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('27140000-0000-0000-0000-0000000000f1', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000d1', 'L1', 'Line', 'm', 100, 5),
  ('27140000-0000-0000-0000-0000000000f2', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000d2', 'L2', 'Line', 'm', 100, 5),
  ('27140000-0000-0000-0000-0000000000f3', '27140000-0000-0000-0000-00000000000b', '27140000-0000-0000-0000-0000000000d3', 'L3', 'Line', 'm', 100, 5);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('27140000-0000-0000-0000-000000000011', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000e1', '27140000-0000-0000-0000-0000000000f1', 100),
  ('27140000-0000-0000-0000-000000000012', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000e2', '27140000-0000-0000-0000-0000000000f2', 100),
  ('27140000-0000-0000-0000-000000000013', '27140000-0000-0000-0000-00000000000b', '27140000-0000-0000-0000-0000000000e3', '27140000-0000-0000-0000-0000000000f3', 100);
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at, validated_by, validated_at) values
  ('27140000-0000-0000-0000-000000000a01', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000d1', '27140000-0000-0000-0000-0000000000e1', pg_temp.local_now()::date, 'validated', '27140000-0000-0000-0000-0000000000a3', now(), '27140000-0000-0000-0000-0000000000a1', now()),
  ('27140000-0000-0000-0000-000000000a02', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000d2', '27140000-0000-0000-0000-0000000000e2', pg_temp.local_now()::date, 'validated', '27140000-0000-0000-0000-0000000000a3', now(), '27140000-0000-0000-0000-0000000000a1', now()),
  ('27140000-0000-0000-0000-000000000a03', '27140000-0000-0000-0000-00000000000b', '27140000-0000-0000-0000-0000000000d3', '27140000-0000-0000-0000-0000000000e3', pg_temp.local_now()::date, 'validated', '27140000-0000-0000-0000-0000000000b1', now(), '27140000-0000-0000-0000-0000000000a1', now());
insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit, frozen_amount, frozen_at) values
  ('27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-000000000a01', 1, '27140000-0000-0000-0000-000000000011', 10, 'm', 1000.00, now()),
  ('27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-000000000a02', 1, '27140000-0000-0000-0000-000000000012', 5, 'm', 2000.00, now()),
  ('27140000-0000-0000-0000-00000000000b', '27140000-0000-0000-0000-000000000a03', 1, '27140000-0000-0000-0000-000000000013', 7, 'm', 9999.00, now());

-- AC-SCH-002 / 005: one tick queues one row per resolved recipient (PM One, Engineer, Finance; not the opted-out Engineer)
select is(scheduled_report_tick(), 3, 'AC-SCH-002 the tick queues one row per recipient');
select is(pg_temp.rows((select v from ids where k = 'daily')), 3, 'AC-SCH-002 three outbox rows exist for the report');
select is((select count(*)::int from scheduled_report_runs where period_key = 'daily_progress:' || pg_temp.local_now()::date::text), 1,
  'AC-SCH-003 the period is the local date in the organisation timezone');
select is((select queued from scheduled_report_runs limit 1), 3, 'the run records how many it queued');
select is(scheduled_report_tick(), 0, 'AC-SCH-002 a second tick queues nothing (no double send)');
select is(pg_temp.rows(), 3, 'AC-SCH-002 still three rows after the re-run');
select is((select count(*)::int from email_outbox where report_id is not null and recipient_id = '27140000-0000-0000-0000-0000000000a5'), 0,
  'AC-SCH-005 an opted-out recipient (matched by role) gets nothing');
select is((select count(*)::int from email_outbox where report_id is not null and recipient_id = '27140000-0000-0000-0000-0000000000a6'), 0,
  'AC-SCH-005 a member who is not listed gets nothing');
select is((select count(*)::int from email_outbox where report_id is not null and recipient_id = '27140000-0000-0000-0000-0000000000b1'), 0,
  'AC-SCH-005 another organisation''s member gets nothing');
select is((select count(*)::int from email_outbox where report_id is not null and recipient_id = '27140000-0000-0000-0000-0000000000a3'), 1,
  'AC-SCH-005 a person listed by id and by role gets exactly one row');
select is((select count(*)::int from email_outbox where report_id is not null and notification_id is null), 3, 'report rows carry no notification');
select throws_ok($$insert into email_outbox (org_id, recipient_id, event_key) values ('27140000-0000-0000-0000-00000000000a','27140000-0000-0000-0000-0000000000a3','x')$$,
  '23514', null, 'an outbox row with no source is refused');

-- AC-SCH-006: figures follow the recipient
create function pg_temp.body_of(p_recipient uuid) returns text language sql as $$
  select body from email_outbox where report_id is not null and recipient_id = p_recipient $$;
select ok(pg_temp.body_of('27140000-0000-0000-0000-0000000000a4') like '%validated revenue 1000.00%'
      and pg_temp.body_of('27140000-0000-0000-0000-0000000000a4') like '%validated revenue 2000.00%',
  'AC-SCH-006 Finance receives the revenue of every project');
select ok(pg_temp.body_of('27140000-0000-0000-0000-0000000000a2') like '%Alpha Site%validated revenue 1000.00%'
      and pg_temp.body_of('27140000-0000-0000-0000-0000000000a2') not like '%2000.00%',
  'AC-SCH-006 a project manager receives revenue for their own project only');
select ok(pg_temp.body_of('27140000-0000-0000-0000-0000000000a2') like '%Bravo Site%',
  'AC-SCH-006 and still sees the other project''s progress without its revenue');
select ok(pg_temp.body_of('27140000-0000-0000-0000-0000000000a3') like '%Alpha Site%'
      and pg_temp.body_of('27140000-0000-0000-0000-0000000000a3') not like '%revenue%'
      and pg_temp.body_of('27140000-0000-0000-0000-0000000000a3') not like '%1000.00%'
      and pg_temp.body_of('27140000-0000-0000-0000-0000000000a3') not like '%2000.00%',
  'AC-SCH-006 an engineer receives progress with no revenue figure anywhere');
select ok((select bool_and(body not like '%OrgB%' and body not like '%9999%') from email_outbox where report_id is not null),
  'AC-SCH-006 no recipient receives a figure from another organisation');
select ok((select bool_and(body like '%Progress summary%' and subject = 'Daily progress') from email_outbox where report_id is not null),
  'the English body and the report name as subject');
select ok((select body from scheduled_report_content('daily_progress', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000a3',
  pg_temp.local_now()::date, pg_temp.local_now()::date, 'id', 'Harian')) like '%Ringkasan kemajuan%', 'the Bahasa Indonesia body renders');
select is((select count(*)::int from scheduled_report_content('daily_progress', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000b1',
  pg_temp.local_now()::date, pg_temp.local_now()::date, 'en', 'X')), 0, 'AC-SCH-006 a person outside the organisation gets no content at all');

-- AC-SCH-007: nothing to report still sends once, saying so
select is((select body from scheduled_report_content('overdue_tasks', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000a3',
  pg_temp.local_now()::date, pg_temp.local_now()::date, 'en', 'Overdue')) like '%No overdue tasks.%', true, 'AC-SCH-007 an empty period says so');
insert into tasks (org_id, project_id, name, status, end_date) values
  ('27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000d1', 'late', 'To Do', pg_temp.local_now()::date - 2),
  ('27140000-0000-0000-0000-00000000000b', '27140000-0000-0000-0000-0000000000d3', 'late b', 'To Do', pg_temp.local_now()::date - 2);
select ok((select body from scheduled_report_content('overdue_tasks', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000a3',
  pg_temp.local_now()::date, pg_temp.local_now()::date, 'en', 'Overdue')) like '%Alpha Site: 1 overdue%'
  and (select body from scheduled_report_content('overdue_tasks', '27140000-0000-0000-0000-00000000000a', '27140000-0000-0000-0000-0000000000a3',
  pg_temp.local_now()::date, pg_temp.local_now()::date, 'en', 'Overdue')) not like '%OrgB%', 'overdue tasks count the organisation''s own only');

-- AC-SCH-003 / 004: off, archived, later send time and the wrong weekday queue nothing; the right weekday does
set local role authenticated;
select pg_temp.act_as('27140000-0000-0000-0000-0000000000a1');
insert into ids select 'off',   save_scheduled_report(null, 'Off',   'overdue_tasks', 'daily', null, '00:00', '{}', '{Finance}', false);
insert into ids select 'later', save_scheduled_report(null, 'Later', 'overdue_tasks', 'daily', null, '23:59:59', '{}', '{Finance}', true);
insert into ids select 'wrongday', save_scheduled_report(null, 'Wrong day', 'overdue_tasks', 'weekly',
  (extract(isodow from pg_temp.local_now())::int % 7) + 1, '00:00', '{}', '{Finance}', true);
insert into ids select 'today', save_scheduled_report(null, 'Weekly today', 'overdue_tasks', 'weekly',
  extract(isodow from pg_temp.local_now())::int, '00:00', '{}', '{Finance}', true);
insert into ids select 'arch', save_scheduled_report(null, 'Archived', 'overdue_tasks', 'daily', null, '00:00', '{}', '{Finance}', true);
select archive_scheduled_report((select v from ids where k = 'arch'));
select pg_temp.act_as('27140000-0000-0000-0000-0000000000a2');
select throws_ok($$select archive_scheduled_report((select v from ids where k = 'off'))$$, '42501', 'admin only', 'AC-SCH-008 a non-Admin cannot archive');
select throws_ok($$select set_scheduled_report_enabled((select v from ids where k = 'off'), true)$$, '42501', 'admin only', 'AC-SCH-008 a non-Admin cannot switch a report on');
reset role;
update scheduled_reports set created_at = now() - interval '2 days';
select is(scheduled_report_tick(), 1, 'AC-SCH-003/004 only the weekly report on its own weekday is queued (off, archived, later and wrong-day are not)');
select is(pg_temp.rows((select v from ids where k = 'today')), 1, 'AC-SCH-004 the weekly report queued for Finance');
select is(pg_temp.rows((select v from ids where k = 'off')) + pg_temp.rows((select v from ids where k = 'later'))
        + pg_temp.rows((select v from ids where k = 'wrongday')) + pg_temp.rows((select v from ids where k = 'arch')), 0, 'AC-SCH-003 no row for the others');

-- AC-SCH-010: a report row still pending after 48 hours is failed, not sent
update email_outbox set created_at = now() - interval '49 hours' where report_id = (select v from ids where k = 'daily') and recipient_id = '27140000-0000-0000-0000-0000000000a3';
select is((select count(*)::int from claim_email_outbox(100) where id in (select id from email_outbox where report_id = (select v from ids where k = 'daily') and recipient_id = '27140000-0000-0000-0000-0000000000a3')), 0,
  'AC-SCH-010 a stale report row is not claimed');
select is((select status || '/' || last_error from email_outbox where report_id = (select v from ids where k = 'daily') and recipient_id = '27140000-0000-0000-0000-0000000000a3'), 'failed/stale', 'AC-SCH-010 and is marked failed');

select * from finish();
rollback;

-- ── Mutation checks (run by the orchestrator; each edit must turn the named assertion red, then be restored) ──────────
-- 1. 1227: delete the `not exists (... email_user_prefs ... opted_out)` line            -> AC-SCH-005 opted-out recipient
-- 2. 1226: set may_see_revenue to `true`                                                -> AC-SCH-006 engineer / PM-own-project
-- 3. 1225: drop the unique primary key on scheduled_report_runs and the outbox unique    -> AC-SCH-002 second tick
--    index email_outbox_report_period_recipient (re-run queues again)
-- 4. 1226: remove `and p.org_id = p_org` from the projects join (and the d.org_id filter) -> AC-SCH-006 other organisation
-- 5. 1227: remove the `created_at > due` guard                                         -> AC-SCH-003 created after send time
-- 6. 1227: remove the 48-hour failing update in claim_email_outbox                      -> AC-SCH-010
