-- 2705_phone_clock_in.test.sql — #2705 (docs/specs/phone-clock-in.spec.md).
-- Migrations under test: 1210 area + setting, 1211 phone_check_ins, 1212 geo_distance_m / phone_check_in / attendance_record, 1213 decide.
-- 1214 my_home has_area · AC-PCI-001 area columns · 002 haversine · 003 no area · 004 inside records · 005 outside is pending, the database decides ·
-- 006 not rostered · 007 bad crew / position · 008 light account calls but cannot decide · 009 decide guards · 010 approve / reject ·
-- 011 position privacy · 012 supervisor-role setting.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   make v_outcome always 'inside' in phone_check_in ............ 'AC-PCI-005 outside the area is pending, not recorded'
--   drop the `not v_rostered` branch ............................ 'AC-PCI-006 inside the area but not rostered is pending'
--   add assert_not_light() to phone_check_in .................... 'AC-PCI-008 a light account checks in inside the area'
--   drop the requester guard (PCI_SELF) in phone_check_in_decide  'AC-PCI-009 the requester cannot decide their own check-in'
--   make phone_check_in_may_decide return true .................. 'AC-PCI-009 an engineer who is not the controller cannot decide'
--   ignore the supervisor role in phone_check_in_may_decide ..... 'AC-PCI-009 with a role configured, a non-holder cannot decide'
--   drop `status <> 'pending'` check in decide .................. 'AC-PCI-009 a second decision is refused'
--   drop the reason check on reject ............................. 'AC-PCI-010 rejecting needs a reason'
--   add a SELECT policy using (true) on phone_check_ins ......... 'AC-PCI-011 a peer reads none of another person''s positions'
--   drop work_orders_area_all_or_none ........................... 'AC-PCI-001 a partial area is refused'
--   skip the rounding in phone_check_in ......................... 'AC-PCI-004 stored latitude is rounded to 5 decimals'
begin;
create extension if not exists pgtap;
select plan(69);

insert into organizations (id, name, default_currency, built_in_roles_enabled) values
  ('27050000-0000-0000-0000-00000000000a', 'PCI Org',       'IDR', true),
  ('27050000-0000-0000-0000-00000000000b', 'PCI Other Org', 'IDR', true);
insert into auth.users (id, email) values
  ('27050000-0000-0000-0000-0000000000a1', 'pci-admin@example.com'),
  ('27050000-0000-0000-0000-0000000000a3', 'pci-pm@example.com'),
  ('27050000-0000-0000-0000-0000000000a4', 'pci-eng@example.com'),
  ('27050000-0000-0000-0000-0000000000a5', 'pci-foreman@example.com'),
  ('27050000-0000-0000-0000-0000000000a6', 'pci-field@example.com'),
  ('27050000-0000-0000-0000-0000000000a7', 'pci-other@example.com'),
  ('27050000-0000-0000-0000-0000000000a8', 'pci-holder@example.com'),
  ('27050000-0000-0000-0000-0000000000a9', 'pci-controller@example.com'),
  ('27050000-0000-0000-0000-0000000000b1', 'pci-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27050000-0000-0000-0000-0000000000a1', '27050000-0000-0000-0000-00000000000a', 'PCI Admin',      'pci-admin@example.com',      'Admin', 'active', null),
  ('27050000-0000-0000-0000-0000000000a3', '27050000-0000-0000-0000-00000000000a', 'PCI PM',         'pci-pm@example.com',         'Project Manager', 'active', null),
  ('27050000-0000-0000-0000-0000000000a4', '27050000-0000-0000-0000-00000000000a', 'PCI Eng',        'pci-eng@example.com',        'Engineer', 'active', null),
  ('27050000-0000-0000-0000-0000000000a5', '27050000-0000-0000-0000-00000000000a', 'PCI Foreman',    'pci-foreman@example.com',    'Engineer', 'active', 'foreman'),
  ('27050000-0000-0000-0000-0000000000a6', '27050000-0000-0000-0000-00000000000a', 'PCI Field',      'pci-field@example.com',      'Engineer', 'active', 'field_user'),
  ('27050000-0000-0000-0000-0000000000a7', '27050000-0000-0000-0000-00000000000a', 'PCI Other',      'pci-other@example.com',      'Engineer', 'active', null),
  ('27050000-0000-0000-0000-0000000000a8', '27050000-0000-0000-0000-00000000000a', 'PCI Holder',     'pci-holder@example.com',     'Engineer', 'active', 'construction_manager'),
  ('27050000-0000-0000-0000-0000000000a9', '27050000-0000-0000-0000-00000000000a', 'PCI Controller', 'pci-controller@example.com', 'Engineer', 'active', null),
  ('27050000-0000-0000-0000-0000000000b1', '27050000-0000-0000-0000-00000000000b', 'PCI XOrg',       'pci-xorg@example.com',       'Admin', 'active', null);

insert into projects (id, org_id, name, status, project_manager_id) values
  ('27050000-0000-0000-0000-0000000000d1', '27050000-0000-0000-0000-00000000000a', 'PCI Site', 'Ongoing Project', '27050000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, area_lat, area_lng, area_radius_m) values
  ('27050000-0000-0000-0000-000000000401', '27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-0000000000d1', 'PCI WO area',     'Issued', 1000, 'exclusive', 0, 0, 0, 100),
  ('27050000-0000-0000-0000-000000000402', '27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-0000000000d1', 'PCI WO no area',  'Issued', 1000, 'exclusive', 0, null, null, null),
  ('27050000-0000-0000-0000-000000000403', '27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-0000000000d1', 'PCI WO off roster', 'Issued', 1000, 'exclusive', 0, 0, 0, 100),
  ('27050000-0000-0000-0000-000000000404', '27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-0000000000d1', 'PCI WO area two', 'Issued', 1000, 'exclusive', 0, 0, 0, 100);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('27050000-0000-0000-0000-000000000c01', '27050000-0000-0000-0000-00000000000a', 'PCI-1', 'PCI crew one', '27050000-0000-0000-0000-0000000000a5'),
  ('27050000-0000-0000-0000-000000000c02', '27050000-0000-0000-0000-00000000000a', 'PCI-2', 'PCI crew two', '27050000-0000-0000-0000-0000000000a9'),
  ('27050000-0000-0000-0000-000000000c03', '27050000-0000-0000-0000-00000000000a', 'PCI-3', 'PCI crew three', null),
  ('27050000-0000-0000-0000-000000000c04', '27050000-0000-0000-0000-00000000000a', 'PCI-4', 'PCI crew four', null);
insert into people (id, org_id, kind, name, profile_id) values
  ('27050000-0000-0000-0000-000000000f01', '27050000-0000-0000-0000-00000000000a', 'own', 'PCI Field person', '27050000-0000-0000-0000-0000000000a6'),
  ('27050000-0000-0000-0000-000000000f04', '27050000-0000-0000-0000-00000000000a', 'own', 'PCI Eng person',   '27050000-0000-0000-0000-0000000000a4'),
  ('27050000-0000-0000-0000-000000000f05', '27050000-0000-0000-0000-00000000000a', 'own', 'PCI Foreman person', '27050000-0000-0000-0000-0000000000a5'),
  ('27050000-0000-0000-0000-000000000f07', '27050000-0000-0000-0000-00000000000a', 'own', 'PCI Other person', '27050000-0000-0000-0000-0000000000a7');
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-000000000c01', '27050000-0000-0000-0000-000000000f01', current_date - 30),
  ('27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-000000000c02', '27050000-0000-0000-0000-000000000f04', current_date - 30),
  ('27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-000000000c03', '27050000-0000-0000-0000-000000000f07', current_date - 30),
  ('27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-000000000c04', '27050000-0000-0000-0000-000000000f05', current_date - 30);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-000000000401', '27050000-0000-0000-0000-000000000c01', current_date - 5),
  ('27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-000000000401', '27050000-0000-0000-0000-000000000c02', current_date - 5),
  ('27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-000000000402', '27050000-0000-0000-0000-000000000c03', current_date - 5),
  ('27050000-0000-0000-0000-00000000000a', '27050000-0000-0000-0000-000000000404', '27050000-0000-0000-0000-000000000c04', current_date - 5);

-- AC-PCI-001 area columns: all set or all NULL, in range
select lives_ok($$ update work_orders set area_lat = 1, area_lng = 2, area_radius_m = 50 where id = '27050000-0000-0000-0000-000000000402' $$, 'AC-PCI-001 a full area is accepted');
select throws_ok($$ update work_orders set area_lat = null where id = '27050000-0000-0000-0000-000000000402' $$, '23514', null, 'AC-PCI-001 a partial area is refused');
select throws_ok($$ update work_orders set area_lat = 91 where id = '27050000-0000-0000-0000-000000000402' $$, '23514', null, 'AC-PCI-001 a latitude out of range is refused');
select throws_ok($$ update work_orders set area_radius_m = 0 where id = '27050000-0000-0000-0000-000000000402' $$, '23514', null, 'AC-PCI-001 a zero radius is refused');
select lives_ok($$ update work_orders set area_lat = null, area_lng = null, area_radius_m = null where id = '27050000-0000-0000-0000-000000000402' $$, 'AC-PCI-001 clearing the area is accepted');

-- AC-PCI-002 haversine
select is(round(public.geo_distance_m(0, 0, 0, 1)::numeric, 0), 111195::numeric, 'AC-PCI-002 one degree of longitude on the equator is 111195 m');
select is(public.geo_distance_m(10, 20, 10, 20), 0::double precision, 'AC-PCI-002 the same point is 0 m');
select is(round(public.geo_distance_m(0, 0, 0.0009, 0)::numeric, 1), round(public.geo_distance_m(0.0009, 0, 0, 0)::numeric, 1), 'AC-PCI-002 the distance is symmetric');
select ok(public.geo_distance_m(0, 0, 0.000899, 0) <= 100 and public.geo_distance_m(0, 0, 0.0009005, 0) > 100, 'AC-PCI-002 99.97 m is inside a 100 m radius and 100.13 m is outside');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
set local role authenticated;

-- AC-PCI-008 / 003: the light Field user (member of crew one)
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a6');
select is(public.actor_is_light(), true, 'AC-PCI-008 the field user is a light account');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a7');
select is(public.phone_check_in('27050000-0000-0000-0000-000000000402', null, null, null, null)->>'outcome', 'no_area',
  'AC-PCI-003 no area: attendance is recorded and no position is asked');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a6');
select is(public.phone_check_in('27050000-0000-0000-0000-000000000401', null, null, null, null)->>'status', 'needs_position',
  'AC-PCI-003 an area but no position yet: the RPC asks for one and writes nothing');
-- AC-PCI-007 bad input
select throws_ok($$ select public.phone_check_in('27050000-0000-0000-0000-000000000401', '27050000-0000-0000-0000-000000000c03', 0, 0, 10) $$, '23514', null,
  'AC-PCI-007 a crew that is not rostered on this work order is refused (crew-followed: a crew rostered here may be picked, as a request to follow)');
select throws_ok($$ select public.phone_check_in('27050000-0000-0000-0000-000000000401', null, 91, 0, 10) $$, '22023', null, 'AC-PCI-007 a latitude out of range is refused');
select throws_ok($$ select public.phone_check_in('27050000-0000-0000-0000-000000000401', null, 0, 0, 0) $$, '22023', null, 'AC-PCI-007 an accuracy of zero is refused');
select throws_ok($$ select public.phone_check_in('27050000-0000-0000-0000-000000000401', null, 0, null, 10) $$, '22023', null, 'AC-PCI-007 half a position is refused');
-- AC-PCI-005 outside (the database decides from the position alone)
select is(public.phone_check_in('27050000-0000-0000-0000-000000000401', '27050000-0000-0000-0000-000000000c01', 0.002, 0, 10)->>'status', 'pending',
  'AC-PCI-005 outside the area is pending, not recorded');
select is((public.phone_check_in('27050000-0000-0000-0000-000000000401', '27050000-0000-0000-0000-000000000c01', 0.002, 0, 10)->>'outcome'), 'outside',
  'AC-PCI-005 a second outside tap returns the same pending request');
-- AC-PCI-006 not rostered, inside the area
select is(public.phone_check_in('27050000-0000-0000-0000-000000000403', null, 0.0001, 0, 10)->>'outcome', 'not_rostered',
  'AC-PCI-006 inside the area but not rostered is pending');
-- no position (permission refused): pending, no coordinates
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a5');
select is(public.phone_check_in('27050000-0000-0000-0000-000000000404', null, null, null, null, 8, true)->>'outcome', 'no_position',
  'AC-PCI-005 no position at all is a pending request');
reset role;
select is((select count(*)::int from attendance_days where work_order_id = '27050000-0000-0000-0000-000000000401'), 0, 'AC-PCI-005 an outside check-in created no attendance');
select is((select count(*)::int from attendance_days where work_order_id = '27050000-0000-0000-0000-000000000403'), 0, 'AC-PCI-006 an off-roster check-in created no attendance');
select is((select count(*)::int from phone_check_ins where work_order_id = '27050000-0000-0000-0000-000000000401' and status = 'pending'), 1,
  'AC-PCI-005 two outside taps leave one pending request');
select is((select count(*)::int from phone_check_ins where work_order_id = '27050000-0000-0000-0000-000000000402'), 0, 'AC-PCI-003 no area: no position row exists');
select is((select lat from phone_check_ins where work_order_id = '27050000-0000-0000-0000-000000000404'), null::double precision, 'AC-PCI-005 a no-position request stores no coordinates');
select is((select count(*)::int from attendance_days where work_order_id = '27050000-0000-0000-0000-000000000402' and source = 'phone_check_in'), 1,
  'AC-PCI-003 the no-area clock-in went through attendance_record');

set local role authenticated;
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a6');
-- AC-PCI-004 / 008 inside, rostered, by a light account
select is(public.phone_check_in('27050000-0000-0000-0000-000000000401', '27050000-0000-0000-0000-000000000c01', 0.000500049, 0.000001234, 12)->>'status', 'recorded',
  'AC-PCI-008 a light account checks in inside the area');
reset role;
select is((select count(*)::int from attendance_days where work_order_id = '27050000-0000-0000-0000-000000000401' and source = 'phone_check_in'), 1,
  'AC-PCI-004 attendance exists with source phone_check_in');
select is((select lat from phone_check_ins where status = 'recorded' and work_order_id = '27050000-0000-0000-0000-000000000401'), 0.0005::double precision,
  'AC-PCI-004 stored latitude is rounded to 5 decimals');
select is((select accuracy_m from phone_check_ins where status = 'recorded' and work_order_id = '27050000-0000-0000-0000-000000000401'), 12::double precision,
  'AC-PCI-004 accuracy is stored');
select isnt((select attendance_day_id from phone_check_ins where status = 'recorded' and work_order_id = '27050000-0000-0000-0000-000000000401'), null, 'AC-PCI-004 the position row links the attendance');
select is((select distance_m from phone_check_ins where status = 'recorded' and work_order_id = '27050000-0000-0000-0000-000000000401'), 55.6::numeric,
  'AC-PCI-004 the distance is computed from the unrounded input');

-- a second person, a full Engineer in crew two, outside the area: pending for crew two's controller
set local role authenticated;
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a4');
select is(public.phone_check_in('27050000-0000-0000-0000-000000000401', '27050000-0000-0000-0000-000000000c02', 0.002, 0, 10)->>'status', 'pending',
  'AC-PCI-005 an engineer outside the area is pending for their crew');
reset role;
create temp table pci_ids as
  select q.id, q.work_order_id, q.requester_id, q.outcome from phone_check_ins q where q.status = 'pending';
grant select on pci_ids to authenticated;

-- AC-PCI-011 position privacy (setting NULL)
set local role authenticated;
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from phone_check_ins), 3, 'AC-PCI-011 a person reads their own check-ins');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from phone_check_ins), 1, 'AC-PCI-011 a peer reads none of another person''s positions');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a9');
select is((select count(*)::int from phone_check_ins), 1, 'AC-PCI-011 a crew controller reads only their own crew''s check-ins');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from phone_check_ins), 3, 'AC-PCI-011 a crew controller reads their crew''s check-ins that name it, plus their own');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from phone_check_ins), 5, 'AC-PCI-011 Admin reads every check-in of the organisation');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a7');
select is((select count(*)::int from phone_check_ins), 0, 'AC-PCI-011 an engineer with no part in it reads none');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from phone_check_ins), 0, 'AC-PCI-011 another organisation reads none');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a1');
select throws_ok($$ insert into phone_check_ins (work_order_id, worker_id, requester_id, work_date, hours, outcome, status)
  values ('27050000-0000-0000-0000-000000000401', '27050000-0000-0000-0000-000000000f01', '27050000-0000-0000-0000-0000000000a1', current_date, 8, 'inside', 'recorded') $$,
  '42501', null, 'AC-PCI-011 no client insert, not even Admin');
select throws_ok($$ update phone_check_ins set status = 'approved' $$, '42501', null, 'AC-PCI-011 no client update');
select throws_ok($$ delete from phone_check_ins $$, '42501', null, 'AC-PCI-011 no client delete');

-- AC-PCI-009 decide guards, setting NULL: crew controller or crew managers
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a6');
select throws_ok($$ select public.phone_check_in_decide((select id from pci_ids where outcome = 'outside' and requester_id = '27050000-0000-0000-0000-0000000000a6'), true) $$,
  '42501', null, 'AC-PCI-008 a light account cannot decide');
select throws_ok($$ select * from public.phone_check_in_requests() $$, '42501', null, 'AC-PCI-008 a light account cannot list decisions');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.phone_check_in_decide((select id from pci_ids where requester_id = '27050000-0000-0000-0000-0000000000a4'), true) $$,
  '42501', null, 'AC-PCI-009 the requester cannot decide their own check-in');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a7');
select throws_ok($$ select public.phone_check_in_decide((select id from pci_ids where requester_id = '27050000-0000-0000-0000-0000000000a4'), true) $$,
  '42501', null, 'AC-PCI-009 an engineer who is not the controller cannot decide');
select is((select count(*)::int from public.phone_check_in_requests()), 0, 'AC-PCI-009 a non-decider lists no requests');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.phone_check_in_decide((select id from pci_ids where requester_id = '27050000-0000-0000-0000-0000000000a4'), true) $$,
  'P0002', null, 'AC-PCI-009 another organisation sees no such request');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a9');
select is((select count(*)::int from public.phone_check_in_requests()), 1, 'AC-PCI-012 the crew controller lists their crew''s request');
-- AC-PCI-010 approve creates attendance
select is(public.phone_check_in_decide((select id from pci_ids where requester_id = '27050000-0000-0000-0000-0000000000a4'), true)->>'status', 'approved',
  'AC-PCI-010 the crew controller approves');
select throws_ok($$ select public.phone_check_in_decide((select id from pci_ids where requester_id = '27050000-0000-0000-0000-0000000000a4'), true) $$,
  '55000', null, 'AC-PCI-009 a second decision is refused');
reset role;
select is((select count(*)::int from attendance_days where worker_id = '27050000-0000-0000-0000-000000000f04' and source = 'phone_check_in'), 1,
  'AC-PCI-010 approving recorded attendance with source phone_check_in');
select is((select status || ':' || (attendance_day_id is not null)::text from phone_check_ins where requester_id = '27050000-0000-0000-0000-0000000000a4'),
  'approved:true', 'AC-PCI-010 the request is approved and linked to the attendance');

-- AC-PCI-012 the setting
set local role authenticated;
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a7');
select throws_ok($$ select public.set_phone_check_in_supervisor_role('construction_manager') $$, '42501', null, 'AC-PCI-012 a non-Admin cannot set the role');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.set_phone_check_in_supervisor_role('no_such_role') $$, '22023', null, 'AC-PCI-012 an unknown role key is refused');
select is(public.set_phone_check_in_supervisor_role('construction_manager'), 'construction_manager', 'AC-PCI-012 an Admin sets the role');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000b1');
select is(public.get_phone_check_in_supervisor_role(), null::text, 'AC-PCI-012 another organisation''s setting is unaffected');

-- with a role configured only its holders decide: not the controller, not a Project Manager
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a9');
select throws_ok($$ select public.phone_check_in_decide((select id from pci_ids where outcome = 'not_rostered'), true) $$, '42501', null,
  'AC-PCI-009 with a role configured, a non-holder cannot decide');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.phone_check_in_decide((select id from pci_ids where outcome = 'not_rostered'), true) $$, '42501', null,
  'AC-PCI-009 with a role configured, a Project Manager who does not hold it cannot decide');
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a8');
select throws_ok($$ select public.phone_check_in_decide((select id from pci_ids where outcome = 'not_rostered'), false) $$, '22023', null,
  'AC-PCI-010 rejecting needs a reason');
select is(public.phone_check_in_decide((select id from pci_ids where outcome = 'not_rostered'), false, 'not on this job')->>'status', 'rejected',
  'AC-PCI-010 the role holder rejects with a reason');
select is(public.phone_check_in_decide((select id from pci_ids where outcome = 'no_position'), true)->>'status', 'approved',
  'AC-PCI-010 the role holder approves a no-position request');
reset role;
select is((select decision_reason from phone_check_ins where work_order_id = '27050000-0000-0000-0000-000000000403'), 'not on this job', 'AC-PCI-010 the reason is stored');
select is((select count(*)::int from attendance_days where work_order_id = '27050000-0000-0000-0000-000000000403'), 0, 'AC-PCI-010 a rejection records no attendance');
select is((select count(*)::int from attendance_days where work_order_id = '27050000-0000-0000-0000-000000000404'), 1, 'AC-PCI-010 an approval records attendance');
select is((select phone_check_in_supervisor_role from organizations where id = '27050000-0000-0000-0000-00000000000a'), 'construction_manager', 'AC-PCI-012 the setting persisted');

-- 1214 my_home carries only a has_area flag, never the coordinates
set local role authenticated;
select pg_temp.act_as('27050000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from jsonb_array_elements(public.my_home()->'work_orders') e where (e->>'has_area')::boolean), 1,
  'AC-PCI-003 my_home flags the rostered work order that has an area');
select ok(public.my_home()::text !~* '(area_lat|area_lng|area_radius|latitude|longitude)', 'AC-PCI-011 my_home never carries the coordinates');
reset role;

select * from finish();
rollback;
