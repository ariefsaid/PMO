-- attendance_days.test.sql — #2528 Slice 2 (docs/specs/crews-roster-attendance.spec.md).
-- Migration under test: 0989_attendance_days.sql.
-- AC-CRW-005 (server half) one tick writes one record per person with the crew default and overrides ·
-- AC-CRW-006 off rotation needs a reason to be present · AC-CRW-007 at most 24 hours a day across work orders ·
-- AC-CRW-008 phone and roster on one day keep one record, flagged when they disagree · AC-CRW-013 back-date window ·
-- AC-CRW-014 only a crew's recorder writes, another organisation sees nothing.
-- Dates are relative to today because the back-date window is.
begin;
create extension if not exists pgtap;
select plan(26);

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
insert into crew_workers (id, org_id, kind, display_name, profile_id) values
  ('25280000-0000-0000-0000-000000001f01', '25280000-0000-0000-0000-00000000010a', 'own',    'Own Worker',  '25280000-0000-0000-0000-0000000001a5'),
  ('25280000-0000-0000-0000-000000001f02', '25280000-0000-0000-0000-00000000010a', 'vendor', 'Vendor Two',   null),
  ('25280000-0000-0000-0000-000000001f03', '25280000-0000-0000-0000-00000000010a', 'vendor', 'Vendor Three', null),
  ('25280000-0000-0000-0000-000000001f09', '25280000-0000-0000-0000-00000000010a', 'vendor', 'Not rostered', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001c01', '25280000-0000-0000-0000-000000001f01', current_date - 30),
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001c01', '25280000-0000-0000-0000-000000001f02', current_date - 30),
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001c01', '25280000-0000-0000-0000-000000001f03', current_date - 30);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001401', '25280000-0000-0000-0000-000000001c01', current_date - 30),
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001402', '25280000-0000-0000-0000-000000001c02', current_date - 30);
insert into crew_worker_rotation_off (org_id, worker_id, off_from, off_to) values
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001f03', current_date - 2, current_date - 1);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create temp table att_args (k text primary key, d date);
insert into att_args values ('today', current_date), ('d1', current_date - 1), ('d2', current_date - 2), ('d3', current_date - 3),
  ('d4', current_date - 4), ('future', current_date + 1), ('too_old', current_date - 8), ('earliest', current_date - 7);
grant select on att_args to authenticated;
create or replace function pg_temp.d(p text) returns date language sql stable as $$ select d from att_args where k = p $$;

set local role authenticated;

-- AC-CRW-005 (server half): the field controller ticks the crew present at 8 with one override to 6.
select pg_temp.act_as('25280000-0000-0000-0000-0000000001a4');
select is(attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d4'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "present", "hours": 8},
    {"worker_id": "25280000-0000-0000-0000-000000001f02", "status": "present", "hours": 6},
    {"worker_id": "25280000-0000-0000-0000-000000001f03", "status": "absent"}]'::jsonb), 3,
  'AC-CRW-005 one tick writes a record per person');
select is((select jsonb_agg(jsonb_build_object('w', right(worker_id::text, 4), 's', status, 'h', hours) order by worker_id)
             from attendance_days where work_date = pg_temp.d('d4')),
  '[{"h": 8.00, "s": "present", "w": "1f01"}, {"h": 6.00, "s": "present", "w": "1f02"}, {"h": null, "s": "absent", "w": "1f03"}]'::jsonb,
  'AC-CRW-005 each record carries its own status and hours');
select is((select project_id from attendance_days where work_date = pg_temp.d('d4') limit 1), '25280000-0000-0000-0000-0000000001d1'::uuid,
  'AC-CRW-005 the record carries the work order''s project');
select is((select count(*)::int from attendance_days where work_date = pg_temp.d('d4') and source = 'roster_tick'
             and recorded_by_ids = array['25280000-0000-0000-0000-0000000001a4'::uuid]), 3,
  'AC-CRW-005 the records name the tick as their source and the controller as recorder');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d4'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f09", "status": "present", "hours": 8}]') $$,
  '23514', 'ATT_NOT_ROSTERED: this person is not in a crew rostered on this work order that day',
  'AC-CRW-005 a person outside the rostered crews is refused (OD-CRW-3)');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d4'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f02", "status": "present", "hours": 25}]') $$,
  '23514', null, 'AC-CRW-005 hours above 24 are refused');

-- AC-CRW-006
select is((select m->>'off_rotation' from work_order_roster('25280000-0000-0000-0000-000000001401', pg_temp.d('d1')) r,
                  jsonb_array_elements(r.members) m where m->>'worker_id' = '25280000-0000-0000-0000-000000001f03'), 'true',
  'AC-CRW-006 the roster read names a person off rotation that day, so the tick screen defaults them');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d1'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f03", "status": "present", "hours": 8}]') $$,
  '23514', 'ATT_OFF_ROTATION: this person is off rotation that day; give a reason to mark them present',
  'AC-CRW-006 a person off rotation marked present without a reason is refused');
select is(attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d1'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f03", "status": "present", "hours": 8, "reason": "Called in for the pour"}]'), 1,
  'AC-CRW-006 with a reason they can be marked present');
select is(attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d1'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f02", "status": "present", "hours": 8}]'), 1,
  'AC-CRW-006 a person on rotation needs no reason');

-- AC-CRW-007: 8 hours on W1, then the person's placement is corrected into crew B (which serves W2) that same day.
select is(attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('today'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f02", "status": "present", "hours": 8}]'), 1,
  'AC-CRW-007 8 hours on work order one are recorded');
reset role;
update crew_members set valid_to = current_date - 1 where worker_id = '25280000-0000-0000-0000-000000001f02';
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('25280000-0000-0000-0000-00000000010a', '25280000-0000-0000-0000-000000001c02', '25280000-0000-0000-0000-000000001f02', current_date);
set local role authenticated;
select pg_temp.act_as('25280000-0000-0000-0000-0000000001a4');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001402', pg_temp.d('today'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f02", "status": "present", "hours": 17}]') $$,
  '23514', 'ATT_DAY_CEILING: this person already has 8.00 hours on ATT WO one that day; a day holds at most 24',
  'AC-CRW-007 17 more hours on work order two the same day are refused, naming the other work order');
select is(attendance_record('25280000-0000-0000-0000-000000001402', pg_temp.d('today'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f02", "status": "present", "hours": 16}]'), 1,
  'AC-CRW-007 16 more hours fit the day');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001402', pg_temp.d('today'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f02", "status": "present", "hours": 16, "overtime_hours": 1}]') $$,
  '23514', null, 'AC-CRW-007 overtime counts toward the 24 hours');

-- AC-CRW-008: roster says 8, the person's own phone check-in says 5.
select is(attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d2'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]'), 1,
  'AC-CRW-008 the roster tick records 8 hours');
select pg_temp.act_as('25280000-0000-0000-0000-0000000001a5');
select is(attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d2'), 'phone_check_in',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "present", "hours": 5}]'), 1,
  'AC-CRW-008 the person''s phone check-in records 5 hours');
select is((select jsonb_build_object('n', count(*), 'review', bool_and(needs_review), 'tick', max(tick_hours),
                                     'phone', max(phone_hours), 'hours', max(hours))
             from attendance_days where worker_id = '25280000-0000-0000-0000-000000001f01' and work_date = pg_temp.d('d2')),
  '{"n": 1, "review": true, "tick": 8.00, "phone": 5.00, "hours": 8.00}'::jsonb,
  'AC-CRW-008 one record, needs review, showing both sources; neither silently wins');
select is(attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d3'), 'phone_check_in',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "present", "hours": 7.5}]'), 1,
  'AC-CRW-008 a phone check-in alone records');
select pg_temp.act_as('25280000-0000-0000-0000-0000000001a4');
select is(attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d3'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]'), 1, 'AC-CRW-008 a tick within tolerance');
select is((select needs_review from attendance_days where worker_id = '25280000-0000-0000-0000-000000001f01' and work_date = pg_temp.d('d3')),
  false, 'AC-CRW-008 hours within the one-hour tolerance are not flagged');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d3'), 'phone_check_in',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f02", "status": "present", "hours": 8}]') $$,
  '42501', 'not authorized', 'AC-CRW-008 a phone check-in is only the person''s own');

-- AC-CRW-013
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('future'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]') $$,
  '23514', 'ATT_DATE_FUTURE: attendance cannot be recorded for a future date', 'AC-CRW-013 a future date is refused');
select throws_ok(format($$ select attendance_record('25280000-0000-0000-0000-000000001401', %L, 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]') $$, current_date - 8),
  '23514', 'ATT_DATE_WINDOW: the earliest date open for attendance is ' || to_char(current_date - 7, 'YYYY-MM-DD'),
  'AC-CRW-013 a date beyond the back-date limit is refused, naming the earliest allowed date');

-- AC-CRW-014: an Engineer who controls no crew cannot record and reads only their own records.
select pg_temp.act_as('25280000-0000-0000-0000-0000000001a6');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d1'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]') $$,
  '42501', 'not authorized', 'AC-CRW-014 a user who is not the crew''s recorder cannot record');
select is((select count(*)::int from attendance_days), 0, 'AC-CRW-014 an unrelated Engineer reads no attendance');
select pg_temp.act_as('25280000-0000-0000-0000-0000000001b1');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000001401', pg_temp.d('d1'), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]') $$,
  'P0002', 'work order not found', 'AC-CRW-014 another organisation cannot record on our work order');

select * from finish();
rollback;
