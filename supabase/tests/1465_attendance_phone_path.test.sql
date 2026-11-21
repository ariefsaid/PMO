-- 1465_attendance_phone_path.test.sql — clock-in on a work order that has a check-in area goes through the phone check-in.
-- Migration under test: 1465_attendance_phone_path.sql (attendance_record + phone_check_in + phone_check_in_decide).
-- A work order with an area is the verified path: the attendance record with source `phone_check_in` is accepted only when
-- phone_check_in (the worker's own check-in) or phone_check_in_decide (the supervisor's approval) produced it, and the
-- worker's own check-in records today only. Work orders without an area keep the direct path, today or inside the
-- organisation's back-date window (the clock-in section's no-area work orders).
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   drop the marker check in attendance_record (PCI_PATH) ..... 'a self check-in on a work order with an area is accepted only through the phone check-in'
--   drop the marker check in attendance_record (PCI_PATH) ..... 'a back-dated self check-in on a work order with an area is refused'
--   drop the set_config line in phone_check_in ................ 'the phone check-in inside the area records'
--   drop the set_config line in phone_check_in_decide ......... 'the supervisor approves the request'
--   drop the self-today check in attendance_record (PCI_TODAY) 'a back-dated self check-in is refused even inside the check-in path transaction'
begin;
create extension if not exists pgtap;
select plan(13);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('14650000-0000-0000-0000-00000000000a', 'PCP Org', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('14650000-0000-0000-0000-0000000000a1', 'pcp-admin@example.com'),
  ('14650000-0000-0000-0000-0000000000a4', 'pcp-controller@example.com'),
  ('14650000-0000-0000-0000-0000000000a6', 'pcp-field@example.com'),
  ('14650000-0000-0000-0000-0000000000a7', 'pcp-other@example.com'),
  ('14650000-0000-0000-0000-0000000000a8', 'pcp-offarea@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('14650000-0000-0000-0000-0000000000a1', '14650000-0000-0000-0000-00000000000a', 'PCP Admin',      'pcp-admin@example.com',      'Admin',    'active', null),
  ('14650000-0000-0000-0000-0000000000a4', '14650000-0000-0000-0000-00000000000a', 'PCP Controller', 'pcp-controller@example.com', 'Engineer', 'active', null),
  ('14650000-0000-0000-0000-0000000000a6', '14650000-0000-0000-0000-00000000000a', 'PCP Field',      'pcp-field@example.com',      'Engineer', 'active', 'field_user'),
  ('14650000-0000-0000-0000-0000000000a7', '14650000-0000-0000-0000-00000000000a', 'PCP Other',      'pcp-other@example.com',      'Engineer', 'active', null),
  ('14650000-0000-0000-0000-0000000000a8', '14650000-0000-0000-0000-00000000000a', 'PCP Off area',   'pcp-offarea@example.com',    'Engineer', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('14650000-0000-0000-0000-0000000000d1', '14650000-0000-0000-0000-00000000000a', 'PCP Site', 'Ongoing Project', '14650000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, area_lat, area_lng, area_radius_m) values
  ('14650000-0000-0000-0000-000000000401', '14650000-0000-0000-0000-00000000000a', '14650000-0000-0000-0000-0000000000d1', 'PCP WO area',    'Issued', 1000, 'exclusive', 0, 0, 0, 100),
  ('14650000-0000-0000-0000-000000000402', '14650000-0000-0000-0000-00000000000a', '14650000-0000-0000-0000-0000000000d1', 'PCP WO no area', 'Issued', 1000, 'exclusive', 0, null, null, null);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('14650000-0000-0000-0000-000000000c01', '14650000-0000-0000-0000-00000000000a', 'PCP-1', 'PCP crew one', '14650000-0000-0000-0000-0000000000a4'),
  ('14650000-0000-0000-0000-000000000c02', '14650000-0000-0000-0000-00000000000a', 'PCP-2', 'PCP crew two', '14650000-0000-0000-0000-0000000000a4');
insert into people (id, org_id, kind, name, profile_id) values
  ('14650000-0000-0000-0000-000000000f01', '14650000-0000-0000-0000-00000000000a', 'own', 'PCP Field person', '14650000-0000-0000-0000-0000000000a6'),
  ('14650000-0000-0000-0000-000000000f02', '14650000-0000-0000-0000-00000000000a', 'own', 'PCP Other person', '14650000-0000-0000-0000-0000000000a7'),
  ('14650000-0000-0000-0000-000000000f03', '14650000-0000-0000-0000-00000000000a', 'own', 'PCP Off area person', '14650000-0000-0000-0000-0000000000a8');
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('14650000-0000-0000-0000-00000000000a', '14650000-0000-0000-0000-000000000c01', '14650000-0000-0000-0000-000000000f01', current_date - 30),
  ('14650000-0000-0000-0000-00000000000a', '14650000-0000-0000-0000-000000000c01', '14650000-0000-0000-0000-000000000f03', current_date - 30),
  ('14650000-0000-0000-0000-00000000000a', '14650000-0000-0000-0000-000000000c02', '14650000-0000-0000-0000-000000000f02', current_date - 30);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('14650000-0000-0000-0000-00000000000a', '14650000-0000-0000-0000-000000000401', '14650000-0000-0000-0000-000000000c01', current_date - 5),
  ('14650000-0000-0000-0000-00000000000a', '14650000-0000-0000-0000-000000000402', '14650000-0000-0000-0000-000000000c02', current_date - 5);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- The path marker only phone_check_in / phone_check_in_decide set (1465). Tests clear it so every direct
-- call starts from a plain call, and set it by hand only where the case needs the path's own transaction.
create or replace function pg_temp.clear_checkin_marker() returns void language sql as $$
  select set_config('pmo.phone_check_in', '', true)
$$;

set local role authenticated;

-- A. a work order with an area: the record comes from the check-in path or it does not come at all
select pg_temp.act_as('14650000-0000-0000-0000-0000000000a6');
select pg_temp.clear_checkin_marker();
select throws_ok($$ select public.attendance_record('14650000-0000-0000-0000-000000000401', current_date, 'phone_check_in',
  '[{"worker_id":"14650000-0000-0000-0000-000000000f01","status":"present","hours":8}]'::jsonb) $$, '42501', null,
  'a self check-in on a work order with an area is accepted only through the phone check-in');
select pg_temp.clear_checkin_marker();
select throws_ok($$ select public.attendance_record('14650000-0000-0000-0000-000000000401', current_date - 1, 'phone_check_in',
  '[{"worker_id":"14650000-0000-0000-0000-000000000f01","status":"present","hours":8}]'::jsonb) $$, '42501', null,
  'a back-dated self check-in on a work order with an area is refused');

-- B. a work order without an area keeps the direct path (the clock-in section's no-area work orders)
select pg_temp.act_as('14650000-0000-0000-0000-0000000000a7');
select pg_temp.clear_checkin_marker();
select lives_ok($$ select public.attendance_record('14650000-0000-0000-0000-000000000402', current_date, 'phone_check_in',
  '[{"worker_id":"14650000-0000-0000-0000-000000000f02","status":"present","hours":8}]'::jsonb) $$,
  'a self check-in on a work order without an area records through attendance_record');
reset role;
select is((select count(*)::int from attendance_days where work_order_id = '14650000-0000-0000-0000-000000000402'
            and worker_id = '14650000-0000-0000-0000-000000000f02' and work_date = current_date), 1,
  'and wrote one attendance day for today');
set local role authenticated;
select pg_temp.act_as('14650000-0000-0000-0000-0000000000a7');
select pg_temp.clear_checkin_marker();
select lives_ok($$ select public.attendance_record('14650000-0000-0000-0000-000000000402', current_date - 2, 'phone_check_in',
  '[{"worker_id":"14650000-0000-0000-0000-000000000f02","status":"present","hours":6}]'::jsonb) $$,
  'a work order without an area keeps the organisation''s back-date window');
reset role;
select is((select count(*)::int from attendance_days where work_order_id = '14650000-0000-0000-0000-000000000402'
            and worker_id = '14650000-0000-0000-0000-000000000f02'), 2, 'and the back-dated day wrote its own record');
set local role authenticated;

-- C. even the check-in path's own transaction cannot back-date the worker's own record
select pg_temp.act_as('14650000-0000-0000-0000-0000000000a6');
select pg_temp.clear_checkin_marker();
select set_config('pmo.phone_check_in', '1465-path', true);
select throws_ok($$ select public.attendance_record('14650000-0000-0000-0000-000000000401', current_date - 1, 'phone_check_in',
  '[{"worker_id":"14650000-0000-0000-0000-000000000f01","status":"present","hours":8}]'::jsonb) $$, '42501', null,
  'a back-dated self check-in is refused even inside the check-in path transaction');

-- D. the worker's own check-in inside the area records
select pg_temp.clear_checkin_marker();
select pg_temp.act_as('14650000-0000-0000-0000-0000000000a6');
select is(public.phone_check_in('14650000-0000-0000-0000-000000000401', '14650000-0000-0000-0000-000000000c01', 0.0001, 0, 10)->>'status',
  'recorded', 'the phone check-in inside the area records');
reset role;
select is((select count(*)::int from attendance_days where work_order_id = '14650000-0000-0000-0000-000000000401'
            and worker_id = '14650000-0000-0000-0000-000000000f01' and work_date = current_date), 1,
  'and wrote one attendance day for today');
select is((select count(*)::int from phone_check_ins where work_order_id = '14650000-0000-0000-0000-000000000401'
            and status = 'recorded' and worker_id = '14650000-0000-0000-0000-000000000f01'), 1,
  'and one recorded check-in with the position');
set local role authenticated;

-- E. the supervisor's approval records the worker's off-area check-in
select pg_temp.clear_checkin_marker();
select pg_temp.act_as('14650000-0000-0000-0000-0000000000a8');
select is(public.phone_check_in('14650000-0000-0000-0000-000000000401', '14650000-0000-0000-0000-000000000c01', 0.5, 0.5, 10)->>'status',
  'pending', 'an outside check-in becomes a request');
select pg_temp.act_as('14650000-0000-0000-0000-0000000000a4');
select is(public.phone_check_in_decide(
           (select id from phone_check_ins
             where worker_id = '14650000-0000-0000-0000-000000000f03' and status = 'pending'), true)->>'status',
  'approved', 'the supervisor approves the request');
reset role;
select is((select count(*)::int from attendance_days where work_order_id = '14650000-0000-0000-0000-000000000401'
            and worker_id = '14650000-0000-0000-0000-000000000f03' and work_date = current_date), 1,
  'and the approved decision wrote the attendance day');

select * from finish();
rollback;
