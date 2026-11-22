-- 1731_idle_with_rent.test.sql — idle cost adds up people and rented equipment (docs/specs/idle-with-rent.spec.md).
-- Migrations under test: 1730, 1731 (on 1710 head count, 1720-1722 class labour, 1255 idle switch, 0460 equipment hire rates).
-- Hourly cost of WO-A is 62500 (400000 + 600000 over 16 h). Idle on WO-A: 02 Nov reason A 30 min + reason B 90 min;
-- 03 Nov reason A 60 min; 05 Nov reason A 60 min. Head count: 02 Nov 3 present + an approved line of 2 = 5; 03 Nov 2 present
-- (an absent row and an unapproved line of 7 do not count); 05 Nov nobody. Standby: 2 h at 100000 on 02 Nov (shared 30:90),
-- 1 h on 05 Nov; excluded entries sit around them.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   head-count factor replaced by 1 ................................. AC-IWR-002/003 amounts
--   average head count instead of per day ........................... AC-IWR-003 amount
--   drop e.status = 'Approved' or e.archived_at is null in standby ... AC-IWR-006 equipment total
--   standby not shared by minutes (full day on every reason) ........ AC-IWR-005
--   drop the approved_at filter in idle_headcount_days .............. AC-IWR-013
--   scope default people_and_equipment (1730) ....................... AC-IWR-001
--   remove idle_cost_enabled return ................................. AC-IWR-009
--   add idle amount to work_order_cost_amounts ...................... AC-IWR-008
begin;
create extension if not exists pgtap;
select plan(19);

insert into organizations (id, name, default_currency) values
  ('17310000-0000-0000-0000-00000000000a', 'Idle Rent Org', 'IDR'),
  ('17310000-0000-0000-0000-00000000000b', 'Other Rent Org', 'IDR');
insert into auth.users (id, email) values
  ('17310000-0000-0000-0000-0000000000a1', 'ir-fin@example.com'),
  ('17310000-0000-0000-0000-0000000000a2', 'ir-pm@example.com'),
  ('17310000-0000-0000-0000-0000000000a3', 'ir-one@example.com'),
  ('17310000-0000-0000-0000-0000000000a4', 'ir-two@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17310000-0000-0000-0000-0000000000a1', '17310000-0000-0000-0000-00000000000a', 'Fin', 'ir-fin@example.com', 'Finance', 'active'),
  ('17310000-0000-0000-0000-0000000000a2', '17310000-0000-0000-0000-00000000000a', 'PM', 'ir-pm@example.com', 'Project Manager', 'active'),
  ('17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-00000000000a', 'One', 'ir-one@example.com', 'Engineer', 'active'),
  ('17310000-0000-0000-0000-0000000000a4', '17310000-0000-0000-0000-00000000000a', 'Two', 'ir-two@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-00000000000a', 'IR Site', 'Ongoing Project', 'IDR'),
  ('17310000-0000-0000-0000-0000000000d9', '17310000-0000-0000-0000-00000000000b', 'Other Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('17310000-0000-0000-0000-000000000401', '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-0000000000d1', 'WO-A', 'A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('17310000-0000-0000-0000-000000000402', '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-0000000000d1', 'WO-B', 'B', 'Issued', 10000, 'exclusive', 0, 'IDR');
insert into crews (id, org_id, code, name) values ('17310000-0000-0000-0000-000000000c01', '17310000-0000-0000-0000-00000000000a', 'IR-A', 'Crew A');
insert into people (id, org_id, kind, code, name, profile_id) values
  ('17310000-0000-0000-0000-000000000f01', '17310000-0000-0000-0000-00000000000a', 'own', 'IR-1', 'Worker 1', null),
  ('17310000-0000-0000-0000-000000000f02', '17310000-0000-0000-0000-00000000000a', 'own', 'IR-2', 'Worker 2', null),
  ('17310000-0000-0000-0000-000000000f03', '17310000-0000-0000-0000-00000000000a', 'own', 'IR-3', 'Worker 3', null);
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('17310000-0000-0000-0000-000000000e01', '17310000-0000-0000-0000-00000000000a', 'IR-EQ1', 'Rented one', 'hours'),
  ('17310000-0000-0000-0000-000000000e02', '17310000-0000-0000-0000-00000000000a', 'IR-EQ2', 'Rented two', 'hours'),
  ('17310000-0000-0000-0000-000000000e03', '17310000-0000-0000-0000-00000000000a', 'IR-EQ3', 'Rented three', 'hours'),
  ('17310000-0000-0000-0000-000000000e04', '17310000-0000-0000-0000-00000000000a', 'IR-EQ4', 'Rented four', 'hours'),
  ('17310000-0000-0000-0000-000000000e05', '17310000-0000-0000-0000-00000000000a', 'IR-EQ5', 'Rented five', 'hours');

set local session_replication_role = replica;
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('17310000-0000-0000-0000-000000000701', '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-0000000000a3', '2026-11-02', 'Approved'),
  ('17310000-0000-0000-0000-000000000702', '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-0000000000a4', '2026-11-02', 'Approved');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, work_order_id, entry_date, hours) values
  ('17310000-0000-0000-0000-000000000711', '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000701', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-02', 8),
  ('17310000-0000-0000-0000-000000000721', '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000702', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-03', 8);
insert into dsr_idle_reasons (id, org_id, label) values
  ('17310000-0000-0000-0000-000000000b01', '17310000-0000-0000-0000-00000000000a', 'Reason A'),
  ('17310000-0000-0000-0000-000000000b02', '17310000-0000-0000-0000-00000000000a', 'Reason B');
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at, submitted_at) values
  ('17310000-0000-0000-0000-000000000c01', '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-02', 'validated', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), now()),
  ('17310000-0000-0000-0000-000000000c02', '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-03', 'validated', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), now()),
  ('17310000-0000-0000-0000-000000000c03', '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-05', 'validated', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), now());
insert into dsr_idle_periods (org_id, report_id, position, minutes, reason_id) values
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000c01', 1, 30, '17310000-0000-0000-0000-000000000b01'),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000c01', 2, 90, '17310000-0000-0000-0000-000000000b02'),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000c02', 1, 60, '17310000-0000-0000-0000-000000000b01'),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000c03', 1, 60, '17310000-0000-0000-0000-000000000b01');
-- present people: 02 Nov workers 1-3; 03 Nov workers 1-2 plus an absent row for worker 3 (not counted)
insert into attendance_days (id, org_id, worker_id, work_order_id, project_id, crew_id, work_date, status, hours, source) values
  (gen_random_uuid(), '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000f01', '17310000-0000-0000-0000-000000000401', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000c01', '2026-11-02', 'present', 8, 'roster_tick'),
  (gen_random_uuid(), '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000f02', '17310000-0000-0000-0000-000000000401', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000c01', '2026-11-02', 'present', 8, 'roster_tick'),
  (gen_random_uuid(), '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000f03', '17310000-0000-0000-0000-000000000401', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000c01', '2026-11-02', 'present', 8, 'roster_tick'),
  (gen_random_uuid(), '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000f01', '17310000-0000-0000-0000-000000000401', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000c01', '2026-11-03', 'present', 8, 'roster_tick'),
  (gen_random_uuid(), '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000f02', '17310000-0000-0000-0000-000000000401', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000c01', '2026-11-03', 'present', 8, 'roster_tick'),
  (gen_random_uuid(), '17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000f03', '17310000-0000-0000-0000-000000000401', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000c01', '2026-11-03', 'absent', null, 'roster_tick');
insert into labour_cost_classes (id, org_id, code, name) values ('17310000-0000-0000-0000-000000000d11', '17310000-0000-0000-0000-00000000000a', 'ir-unnamed', 'Unnamed');
-- head-count lines: 02 Nov approved 2 (counts); 03 Nov unapproved 7 (does not)
insert into headcount_days (org_id, work_order_id, crew_id, class_id, work_date, head_count, approved_by, approved_at) values
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000401', '17310000-0000-0000-0000-000000000c01', '17310000-0000-0000-0000-000000000d11', '2026-11-02', 2, '17310000-0000-0000-0000-0000000000a2', now());
insert into headcount_days (org_id, work_order_id, crew_id, class_id, work_date, head_count) values
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000401', '17310000-0000-0000-0000-000000000c01', '17310000-0000-0000-0000-000000000d11', '2026-11-03', 7);
-- hire rates: EQ1 standby 100000/h; EQ3 hourly rate but a day entry; EQ4 no standby rate
insert into equipment_costing_settings (org_id, asset_id, setting_key, version, basis, work_rate, standby_rate, rate_unit, charge_category, effective_from) values
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e01', gen_random_uuid(), 1, 'hire_rate', 1000, 100000, 'hours', 'Equipment', '2026-01-01'),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e02', gen_random_uuid(), 1, 'hire_rate', 1000, 100000, 'hours', 'Equipment', '2026-01-01'),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e03', gen_random_uuid(), 1, 'hire_rate', 1000, 100000, 'hours', 'Equipment', '2026-01-01'),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e04', gen_random_uuid(), 1, 'hire_rate', 1000, null, 'hours', 'Equipment', '2026-01-01'),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e05', gen_random_uuid(), 1, 'hire_rate', 1000, 100000, 'hours', 'Equipment', '2026-01-01');
insert into equipment_usage_entries (org_id, asset_id, project_id, work_order_id, work_date, quantity, unit, kind, status, author_id, approver_id, approved_at, archived_at) values
  -- counted: 02 Nov 2 h and 05 Nov 1 h on WO-A
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e01', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-02', 2, 'hours', 'standby', 'Approved', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), null),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e01', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-05', 1, 'hours', 'standby', 'Approved', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), null),
  -- excluded: draft, archived, no work order, another work order (no idle), a day with no idle, work kind, other unit, no standby rate
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e02', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-02', 5, 'hours', 'standby', 'Draft', '17310000-0000-0000-0000-0000000000a3', null, null, null),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e02', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-03', 5, 'hours', 'standby', 'Approved', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), now()),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e02', '17310000-0000-0000-0000-0000000000d1', null, '2026-11-02', 5, 'hours', 'standby', 'Approved', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), null),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e05', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000402', '2026-11-02', 5, 'hours', 'standby', 'Approved', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), null),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e02', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-04', 5, 'hours', 'standby', 'Approved', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), null),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e02', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-05', 5, 'hours', 'work', 'Approved', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), null),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e03', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-02', 1, 'days', 'standby', 'Approved', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), null),
  ('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-000000000e04', '17310000-0000-0000-0000-0000000000d1', '17310000-0000-0000-0000-000000000401', '2026-11-02', 5, 'hours', 'standby', 'Approved', '17310000-0000-0000-0000-0000000000a3', '17310000-0000-0000-0000-0000000000a1', now(), null);
set local session_replication_role = origin;

-- the head-count helper, read as the database owner (no client role may call it)
select is((select string_agg(work_date || ':' || heads, ',' order by work_date)
             from public.idle_headcount_days('17310000-0000-0000-0000-00000000000a', '17310000-0000-0000-0000-0000000000d1')),
  '2026-11-02:5,2026-11-03:2',
  'AC-IWR-013 head count of a day = present workers + approved unnamed lines (an absent row and an unapproved line add nothing)');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('17310000-0000-0000-0000-0000000000a1');
select public.save_labour_cost_settings(true);
create temp table cls as select code, id from public.labour_cost_classes;
grant select on cls to authenticated;
select public.save_labour_cost_settings(false);
reset role;
insert into public.labour_cost_rates (org_id, subject_kind, role_key, class_id, basis, amount, effective_from) values
  ('17310000-0000-0000-0000-00000000000a', 'role', 'Engineer', (select id from public.labour_cost_classes where code = 'direct' and org_id = '17310000-0000-0000-0000-00000000000a'), 'hourly', 50000, '2026-11-01');
insert into public.labour_cost_rates (org_id, subject_kind, person_id, class_id, basis, amount, effective_from) values
  ('17310000-0000-0000-0000-00000000000a', 'person', '17310000-0000-0000-0000-0000000000a4', (select id from public.labour_cost_classes where code = 'direct' and org_id = '17310000-0000-0000-0000-00000000000a'), 'hourly', 75000, '2026-11-01');
set local role authenticated;
select public.save_labour_cost_settings(true);
select public.save_idle_cost_setting(true);

-- AC-IWR-001 default scope: today's figure, new columns empty
create temp table base_rows as select * from public.work_order_idle_cost('17310000-0000-0000-0000-0000000000d1');
grant select on base_rows to authenticated;
select is((select amount || ':' || coalesce(people_amount, 'n') || ':' || coalesce(equipment_amount, 'n') || ':' || coalesce(headcount_hours, 'n')
             from base_rows where reason_label = 'Reason A'), '156250.00:n:n:n',
  'AC-IWR-001 default scope: reason A 2.5 h x 62500 and no people, equipment or head-count figure');
select is((select amount from base_rows where reason_label = 'Reason B'), '93750.00', 'AC-IWR-001 default scope: reason B 1.5 h x 62500');

create temp table cost_before as
  select md5(coalesce(string_agg(source || coalesce(record_id::text, '') || coalesce(amount, ''), ',' order by source, record_id, amount), '')) as h,
         count(*) as n from public.work_order_cost_amounts('17310000-0000-0000-0000-0000000000d1');
grant select on cost_before to authenticated;

select lives_ok($$select public.save_idle_cost_scope('people_and_equipment')$$, 'Finance sets idle cost to cover people and equipment');
create temp table full_rows as select * from public.work_order_idle_cost('17310000-0000-0000-0000-0000000000d1');
grant select on full_rows to authenticated;

select is((select people_amount from full_rows where reason_label = 'Reason A'), '281250.00',
  'AC-IWR-002/003 reason A people: (30 min x 5 + 60 min x 2) / 60 x 62500, head count taken per day');
select is((select people_amount from full_rows where reason_label = 'Reason B'), '468750.00',
  'AC-IWR-002 reason B people: 90 min x 5 heads / 60 x 62500');
select is((select headcount_hours from full_rows where reason_label = 'Reason A'), '4.50', 'AC-IWR-003 head-count hours of reason A are person-hours, not hours');
select is((select people_amount from full_rows where reason_label = 'Reason A'), '281250.00',
  'AC-IWR-007 a day with nobody present adds no people cost (it does not fall back to one person)');
select is((select equipment_amount from full_rows where reason_label = 'Reason A'), '150000.00',
  'AC-IWR-004/007 reason A equipment: its 30:120 share of 200000 plus the 100000 of the day with nobody present');
select is((select equipment_amount from full_rows where reason_label = 'Reason B'), '150000.00',
  'AC-IWR-005 reason B takes the 90:120 share of the 200000 standby of 02 Nov');
select is((select sum(equipment_amount::numeric) from full_rows), 300000.00,
  'AC-IWR-006 draft, archived, unnamed, other-work-order, no-idle-day, work-kind, other-unit and no-rate entries add nothing');
select is((select amount from full_rows where reason_label = 'Reason A'), '431250.00', 'AC-IWR-004 amount = people + equipment (reason A)');
select is((select amount from full_rows where reason_label = 'Reason B'), '618750.00', 'AC-IWR-004 amount = people + equipment (reason B)');
select is((select hours from full_rows where reason_label = 'Reason A'), '2.50', 'idle hours stay the recorded hours whatever the scope');
select is((select md5(coalesce(string_agg(source || coalesce(record_id::text, '') || coalesce(amount, ''), ',' order by source, record_id, amount), '')) || ':' || count(*)
             from public.work_order_cost_amounts('17310000-0000-0000-0000-0000000000d1')),
  (select h || ':' || n from cost_before),
  'AC-IWR-008 the work order cost reads are identical before and after the scope changed');

select public.save_labour_cost_settings(false);
select is((select count(*)::int from public.work_order_idle_cost('17310000-0000-0000-0000-0000000000d1')), 0,
  'AC-IWR-009 labour cost off: no row whatever the scope');
select public.save_labour_cost_settings(true);

select pg_temp.act_as('17310000-0000-0000-0000-0000000000a2');
select is((select hourly_cost is null and amount = '431250.00' from public.work_order_idle_cost('17310000-0000-0000-0000-0000000000d1') where reason_label = 'Reason A'), true,
  'AC-IWR-010 a Project Manager reads the amounts with no hourly cost');
select pg_temp.act_as('17310000-0000-0000-0000-0000000000a3');
select throws_ok($$select * from public.work_order_idle_cost('17310000-0000-0000-0000-0000000000d1')$$, '42501', null, 'AC-IWR-010 an Engineer cannot read idle cost');
select pg_temp.act_as('17310000-0000-0000-0000-0000000000a1');
select throws_ok($$select * from public.work_order_idle_cost('17310000-0000-0000-0000-0000000000d9')$$, 'P0002', null,
  'AC-IWR-010 another organisation''s project reads as absent');

select * from finish();
rollback;
