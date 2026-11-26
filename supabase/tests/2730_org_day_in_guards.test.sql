-- 2730_org_day_in_guards.test.sql — #2914. Migration under test: 2730_org_day_in_crew_and_tpi_guards.sql.
-- The clock cannot be faked, so the organisation's timezone is chosen from NOW: UTC+14 when that is already
-- the next UTC day, else UTC-12 (then the previous one). Either way the organisation's day is NOT the UTC day,
-- and each case below is wrong under `current_date` on whichever side it lands.
begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27300000-0000-0000-0000-00000000000a', 'DAY Org', 'IDR',
   case when (now() at time zone 'Pacific/Kiritimati')::date <> (now() at time zone 'UTC')::date then 'Pacific/Kiritimati' else 'Etc/GMT+12' end);
create temp table day_t as select public.native_org_today('27300000-0000-0000-0000-00000000000a') as d;
grant select on day_t to authenticated;
select isnt((select d from day_t), (now() at time zone 'UTC')::date, 'fixture: the organisation day differs from the UTC day');

insert into auth.users (id, email) values
  ('27300000-0000-0000-0000-0000000000a1', 'day-admin@example.com'), ('27300000-0000-0000-0000-0000000000a3', 'day-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27300000-0000-0000-0000-0000000000a1', '27300000-0000-0000-0000-00000000000a', 'DAY Admin', 'day-admin@example.com', 'Admin', 'active'),
  ('27300000-0000-0000-0000-0000000000a3', '27300000-0000-0000-0000-00000000000a', 'DAY PM', 'day-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('27300000-0000-0000-0000-0000000000d1', '27300000-0000-0000-0000-00000000000a', 'DAY Site', 'Ongoing Project', '27300000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27300000-0000-0000-0000-000000000401', '27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-0000000000d1', 'DAY WO', 'Issued', 1000, 'exclusive', 0);
insert into work_order_sections (id, org_id, project_id, work_order_id, code, name) values
  ('27300000-0000-0000-0000-000000000b01', '27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-0000000000d1', '27300000-0000-0000-0000-000000000401', 'D1', 'Day section');
insert into crews (id, org_id, code, name) values
  ('27300000-0000-0000-0000-000000000c01', '27300000-0000-0000-0000-00000000000a', 'DY-A', 'Ends today'),
  ('27300000-0000-0000-0000-000000000c02', '27300000-0000-0000-0000-00000000000a', 'DY-B', 'Ended yesterday');
insert into people (id, org_id, kind, name, profile_id) values
  ('27300000-0000-0000-0000-000000000f01', '27300000-0000-0000-0000-00000000000a', 'vendor', 'Day Worker A', null),
  ('27300000-0000-0000-0000-000000000f02', '27300000-0000-0000-0000-00000000000a', 'vendor', 'Day Worker B', null);
-- A crew whose last member ends the organisation's TODAY is in use; one that ended yesterday is not.
insert into crew_members (org_id, crew_id, worker_id, valid_from, valid_to) values
  ('27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000c01', '27300000-0000-0000-0000-000000000f01', (select d from day_t) - 30, (select d from day_t)),
  ('27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000c02', '27300000-0000-0000-0000-000000000f02', (select d from day_t) - 30, (select d from day_t) - 1);
insert into work_order_crews (org_id, work_order_id, crew_id, section_id, valid_from, valid_to) values
  ('27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000401', '27300000-0000-0000-0000-000000000c01', '27300000-0000-0000-0000-000000000b01', (select d from day_t) - 30, (select d from day_t)),
  ('27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000401', '27300000-0000-0000-0000-000000000c02', '27300000-0000-0000-0000-000000000b01', (select d from day_t) - 30, (select d from day_t) - 1);

-- crews today in the section roll-up (invoker read, as the Admin): the placement that ended yesterday is not counted
select set_config('request.jwt.claims', json_build_object('sub', '27300000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select crews_today from work_order_section_rollup('27300000-0000-0000-0000-000000000401') where section_id = '27300000-0000-0000-0000-000000000b01'),
  1, 'the section counts the crew placed through the organisation''s today, not the one that ended the organisation''s yesterday');
reset role;

select throws_ok($$ update crews set archived_at = now() where id = '27300000-0000-0000-0000-000000000c01' $$,
  '23514', 'CRW_ARCHIVE_IN_USE: end this crew''s current and future members and roster placements first',
  'a crew whose placements end on the organisation''s today cannot be archived');
select lives_ok($$ update crews set archived_at = now() where id = '27300000-0000-0000-0000-000000000c02' $$,
  'a crew whose members and placements ended on the organisation''s yesterday can be archived');

-- overdue sweep: planned yesterday (org) is overdue, planned today is not
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, estimate, estimate_currency, required_for, status, result, created_by, procurement_id, reported_at, reported_by) values
  ('27300000-0000-0000-0000-000000000a01', '27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000401', '27300000-0000-0000-0000-0000000000d1', 'Yesterday', (select d from day_t) - 1, null, null, '{}', 'requested', 'pending', '27300000-0000-0000-0000-0000000000a3', null, null, null),
  ('27300000-0000-0000-0000-000000000a02', '27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000401', '27300000-0000-0000-0000-0000000000d1', 'Today', (select d from day_t), null, null, '{}', 'requested', 'pending', '27300000-0000-0000-0000-0000000000a3', null, null, null);
select set_config('request.jwt.claims', '', true);
select run_tpi_overdue_sweep();
select is((select overdue_notified_at is not null from third_party_inspections where id = '27300000-0000-0000-0000-000000000a01'), true,
  'planned the organisation''s yesterday: overdue, notified');
select is((select overdue_notified_at is not null from third_party_inspections where id = '27300000-0000-0000-0000-000000000a02'), false,
  'planned the organisation''s today: not yet overdue');
select * from finish();
rollback;
