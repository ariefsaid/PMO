-- 1823_effective_hours.test.sql — issue-closing-measure. Migration under test: 1823.
-- AC-ICM-007 worked minus stopped per day  · 008 eligibility, no-times, clamp  · 009 org scope and range cap
-- Mutation check (orchestrator): in 1823 remove `d.status = 'validated'` -> the draft/submitted/returned exclusion assertion goes red;
--   remove `greatest(..., 0)` -> the clamp assertion goes red.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency) values
  ('18230000-0000-0000-0000-00000000000a', 'EFF Org A', 'IDR'),
  ('18230000-0000-0000-0000-00000000000b', 'EFF Org B', 'IDR');
insert into auth.users (id, email) values
  ('18230000-0000-0000-0000-0000000000a1', 'eff-admin@example.com'),
  ('18230000-0000-0000-0000-0000000000a2', 'eff-eng@example.com'),
  ('18230000-0000-0000-0000-0000000000b1', 'eff-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18230000-0000-0000-0000-0000000000a1', '18230000-0000-0000-0000-00000000000a', 'Eff Admin', 'eff-admin@example.com', 'Admin', 'active'),
  ('18230000-0000-0000-0000-0000000000a2', '18230000-0000-0000-0000-00000000000a', 'Eff Eng', 'eff-eng@example.com', 'Engineer', 'active'),
  ('18230000-0000-0000-0000-0000000000b1', '18230000-0000-0000-0000-00000000000b', 'Eff Admin B', 'eff-admin-b@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('18230000-0000-0000-0000-0000000000d1', '18230000-0000-0000-0000-00000000000a', 'Eff Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('18230000-0000-0000-0000-000000000401', '18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-0000000000d1', 'WO-E', 'E', 'Issued', 10000, 'exclusive', 0, 'IDR');
insert into dsr_idle_reasons (id, org_id, label) values ('18230000-0000-0000-0000-000000000b01', '18230000-0000-0000-0000-00000000000a', 'Reason');

set local session_replication_role = replica;
-- 2 Nov: 08:00-16:30 (510 min), idle 90 + 30. 3 Nov: no times, idle 45. 4 Nov: 08:00-09:00 (60), idle 120 (clamp).
-- 5 Nov draft, 6 Nov submitted, 7 Nov returned, 8 Nov superseded, 9 Nov archived: all with times, all excluded.
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at, superseded_at, archived_at, submitted_at, start_time, end_time) values
  ('18230000-0000-0000-0000-000000000c01', '18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-0000000000d1', '18230000-0000-0000-0000-000000000401', '2026-11-02', 'validated', '18230000-0000-0000-0000-0000000000a2', '18230000-0000-0000-0000-0000000000a1', now(), null, null, now(), '08:00', '16:30'),
  ('18230000-0000-0000-0000-000000000c02', '18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-0000000000d1', '18230000-0000-0000-0000-000000000401', '2026-11-03', 'validated', '18230000-0000-0000-0000-0000000000a2', '18230000-0000-0000-0000-0000000000a1', now(), null, null, now(), null, null),
  ('18230000-0000-0000-0000-000000000c03', '18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-0000000000d1', '18230000-0000-0000-0000-000000000401', '2026-11-04', 'validated', '18230000-0000-0000-0000-0000000000a2', '18230000-0000-0000-0000-0000000000a1', now(), null, null, now(), '08:00', '09:00'),
  ('18230000-0000-0000-0000-000000000c04', '18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-0000000000d1', '18230000-0000-0000-0000-000000000401', '2026-11-05', 'draft', '18230000-0000-0000-0000-0000000000a2', null, null, null, null, null, '08:00', '16:00'),
  ('18230000-0000-0000-0000-000000000c05', '18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-0000000000d1', '18230000-0000-0000-0000-000000000401', '2026-11-06', 'submitted', '18230000-0000-0000-0000-0000000000a2', null, null, null, null, now(), '08:00', '16:00'),
  ('18230000-0000-0000-0000-000000000c06', '18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-0000000000d1', '18230000-0000-0000-0000-000000000401', '2026-11-07', 'returned', '18230000-0000-0000-0000-0000000000a2', null, null, null, null, now(), '08:00', '16:00'),
  ('18230000-0000-0000-0000-000000000c07', '18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-0000000000d1', '18230000-0000-0000-0000-000000000401', '2026-11-08', 'validated', '18230000-0000-0000-0000-0000000000a2', '18230000-0000-0000-0000-0000000000a1', now(), now(), null, now(), '08:00', '16:00'),
  ('18230000-0000-0000-0000-000000000c08', '18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-0000000000d1', '18230000-0000-0000-0000-000000000401', '2026-11-09', 'validated', '18230000-0000-0000-0000-0000000000a2', '18230000-0000-0000-0000-0000000000a1', now(), null, now(), now(), '08:00', '16:00');
insert into dsr_idle_periods (org_id, report_id, position, minutes, reason_id) values
  ('18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-000000000c01', 1, 90, '18230000-0000-0000-0000-000000000b01'),
  ('18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-000000000c01', 2, 30, '18230000-0000-0000-0000-000000000b01'),
  ('18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-000000000c02', 1, 45, '18230000-0000-0000-0000-000000000b01'),
  ('18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-000000000c03', 1, 120, '18230000-0000-0000-0000-000000000b01'),
  ('18230000-0000-0000-0000-00000000000a', '18230000-0000-0000-0000-000000000c04', 1, 10, '18230000-0000-0000-0000-000000000b01');
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('18230000-0000-0000-0000-0000000000a1');

select results_eq($$ select worked_minutes, stopped_minutes, effective_minutes, has_times from get_work_order_effective_hours('18230000-0000-0000-0000-000000000401', '2026-11-02', '2026-11-02') $$,
  $$ values (510, 120, 390, true) $$,
  'AC-ICM-007 a 08:00-16:30 day with 90 + 30 stopped minutes is worked 510, stopped 120, effective 390');
select is((select count(*)::int from get_work_order_effective_hours('18230000-0000-0000-0000-000000000401', '2026-11-01', '2026-11-30')), 3,
  'AC-ICM-008 draft, submitted, returned, superseded and archived reports add no day');
select results_eq($$ select worked_minutes, stopped_minutes, effective_minutes, has_times from get_work_order_effective_hours('18230000-0000-0000-0000-000000000401', '2026-11-03', '2026-11-03') $$,
  $$ values (null::integer, 45, null::integer, false) $$,
  'AC-ICM-008 a report with no times has no worked or effective figure (null, not 0), its stopped time still shows');
select is((select effective_minutes from get_work_order_effective_hours('18230000-0000-0000-0000-000000000401', '2026-11-04', '2026-11-04')), 0,
  'AC-ICM-008 stopped time above the site day gives 0 effective, never negative');
select is((select count(*)::int from get_work_order_effective_hours('18230000-0000-0000-0000-000000000401', '2026-11-04', '2026-11-30') where work_date < '2026-11-04'), 0,
  'AC-ICM-007 the range bounds the days returned');
select throws_ok($$ select * from get_work_order_effective_hours('18230000-0000-0000-0000-000000000401', '2026-01-01', '2027-06-01') $$,
  '22023', 'EFFH_RANGE_TOO_LONG: choose a range of at most 366 days', 'AC-ICM-009 a range over 366 days is refused');
select throws_ok($$ select * from get_work_order_effective_hours('18230000-0000-0000-0000-000000000401', '2026-11-05', '2026-11-01') $$,
  '22023', 'EFFH_RANGE: choose a work order and a valid date range', 'AC-ICM-009 an inverted range is refused');

select pg_temp.act_as('18230000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from get_work_order_effective_hours('18230000-0000-0000-0000-000000000401', '2026-11-01', '2026-11-30')), 0,
  'AC-ICM-009 another organisation reads nothing of this work order');
reset role;
select ok(not (select p.prosecdef from pg_proc p where p.proname = 'get_work_order_effective_hours'),
  'AC-ICM-009 the read is security invoker, so row security decides what a caller sees');
select * from finish();
rollback;
