-- 2670_attendance_manager_may_record.test.sql — #2882 (OD-R1125-1): the manager on a person's record may mark them; nobody else may.
-- Migration under test: 2670_attendance_manager_may_record.sql.
-- Dates are relative to the organisation's today because the back-date window is.
begin;
create extension if not exists pgtap;
select plan(5);
-- #2617: "today" is the organisation's local date (the function under test uses it), so the fixtures use it too.
create or replace function pg_temp.today() returns date language sql stable as $$
  select public.equipment_org_today('25280000-0000-0000-0000-00000000010a')
$$;

insert into organizations (id, name, default_currency) values
  ('25280000-0000-0000-0000-00000000010a', 'ATT Org',       'IDR'),
  ('25280000-0000-0000-0000-00000000010b', 'ATT Other Org', 'IDR');
insert into auth.users (id, email) values
  ('25280000-0000-0000-0000-0000000001a3', 'att-pm@example.com'),
  ('25280000-0000-0000-0000-0000000001a4', 'att-fc@example.com'),
  ('25280000-0000-0000-0000-0000000001a5', 'att-worker@example.com'),
  ('25280000-0000-0000-0000-0000000001a6', 'att-eng@example.com'),
  ('25280000-0000-0000-0000-0000000001b1', 'att-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25280000-0000-0000-0000-0000000001a3', '25280000-0000-0000-0000-00000000010a', 'ATT PM',     'att-pm@example.com',     'Project Manager', 'active'),
  ('25280000-0000-0000-0000-0000000001a4', '25280000-0000-0000-0000-00000000010a', 'ATT FC',     'att-fc@example.com',     'Engineer', 'active'),
  ('25280000-0000-0000-0000-0000000001a5', '25280000-0000-0000-0000-00000000010a', 'ATT Worker', 'att-worker@example.com', 'Engineer', 'active'),
  ('25280000-0000-0000-0000-0000000001a6', '25280000-0000-0000-0000-00000000010a', 'ATT Eng',    'att-eng@example.com',    'Engineer', 'active'),
  ('25280000-0000-0000-0000-0000000001b1', '25280000-0000-0000-0000-00000000010b', 'ATT XOrg',   'att-xorg@example.com',   'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25280000-0000-0000-0000-0000000001d1', '25280000-0000-0000-0000-00000000010a', 'ATT Site', 'Ongoing Project', '25280000-0000-0000-0000-0000000001a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25280000-0000-0000-0000-000000001401', '25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-0000000001d1', 'ATT WO one', 'Issued', 1000, 'exclusive', 0),
  ('25280000-0000-0000-0000-000000001402', '25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-0000000001d1', 'ATT WO two', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('25280000-0000-0000-0000-000000001c01', '25280000-0000-0000-0000-00000000010a', 'AT-A', 'Crew A', '25280000-0000-0000-0000-0000000001a4'),
  ('25280000-0000-0000-0000-000000001c02', '25280000-0000-0000-0000-00000000010a', 'AT-B', 'Crew B', '25280000-0000-0000-0000-0000000001a4');
insert into people (id, org_id, kind, name, profile_id) values
  ('25280000-0000-0000-0000-000000001f01', '25280000-0000-0000-0000-00000000010a', 'own',    'Own Worker',  '25280000-0000-0000-0000-0000000001a5'),
  ('25280000-0000-0000-0000-000000001f02', '25280000-0000-0000-0000-00000000010a', 'vendor', 'Vendor Two',   null),
  ('25280000-0000-0000-0000-000000001f03', '25280000-0000-0000-0000-00000000010a', 'vendor', 'Vendor Three', null),
  ('25280000-0000-0000-0000-000000001f09', '25280000-0000-0000-0000-00000000010a', 'vendor', 'Not rostered', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001c01', '25280000-0000-0000-0000-000000001f01', pg_temp.today() - 30),
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001c01', '25280000-0000-0000-0000-000000001f02', pg_temp.today() - 30),
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001c01', '25280000-0000-0000-0000-000000001f03', pg_temp.today() - 30);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001401', '25280000-0000-0000-0000-000000001c01', pg_temp.today() - 30),
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001402', '25280000-0000-0000-0000-000000001c02', pg_temp.today() - 30);
update people set manager_id = '25280000-0000-0000-0000-0000000001a6' where id = '25280000-0000-0000-0000-000000001f01';
insert into crew_worker_rotation_off (org_id, worker_id, off_from, off_to) values
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001f03', pg_temp.today() - 2, pg_temp.today() - 1);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create temp table att_args (k text primary key, d date);
insert into att_args values ('today', pg_temp.today()), ('d1', pg_temp.today() - 1), ('d2', pg_temp.today() - 2), ('d3', pg_temp.today() - 3),
  ('d4', pg_temp.today() - 4), ('future', pg_temp.today() + 1), ('too_old', pg_temp.today() - 8), ('earliest', pg_temp.today() - 7);
grant select on att_args to authenticated;
create or replace function pg_temp.d(p text) returns date language sql stable as $$ select d from att_args where k = p $$;

set local role authenticated;

-- AC-CRW-005 (server half): the field controller ticks the crew present at 8 with one override to 6.
select pg_temp.act_as('25280000-0000-0000-0000-0000000001a6');
select is(attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d1'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "absent"}]'), 1,
  'AC-ATT-DEFAULT-1 the manager on a person''s record marks that person absent');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d1'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f02", "status": "absent"}]') $$,
  '42501', 'not authorized', 'AC-ATT-DEFAULT-2 the same user cannot mark someone they do not manage');
select pg_temp.act_as('25280000-0000-0000-0000-0000000001a5');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d1'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]') $$,
  '42501', 'not authorized', 'AC-ATT-DEFAULT-3 the person cannot record their own day through the roster tick (clock-in is their path)');
select pg_temp.act_as('25280000-0000-0000-0000-0000000001a4');
select is(attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d1'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f02", "status": "present", "hours": 8}]'), 1,
  'AC-ATT-DEFAULT-4 the crew''s field controller keeps the right');
select pg_temp.act_as('25280000-0000-0000-0000-0000000001b1');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d1'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "absent"}]') $$,
  'P0002', 'work order not found', 'AC-ATT-DEFAULT-5 another organisation cannot mark');

select * from finish();
rollback;
