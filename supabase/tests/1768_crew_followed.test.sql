-- 1768_crew_followed.test.sql — docs/specs/crew-followed.spec.md. Migrations under test: 1768, 1769.
-- AC-FOL-001 follow recorded · AC-FOL-002 roster agrees · AC-FOL-003 who may record · AC-FOL-004 invalid follows ·
-- AC-FOL-005 loan wins · AC-FOL-006 phone, submitted week · AC-FOL-007 no follow, no change (existing files untouched).
begin;
create extension if not exists pgtap;
select plan(52);

insert into organizations (id, name, default_currency) values
  ('28680000-0000-0000-0000-00000000000a', 'FOL Org',       'IDR'),
  ('28680000-0000-0000-0000-00000000000b', 'FOL Other Org', 'IDR');
create temp table fol_today as select public.equipment_org_today('28680000-0000-0000-0000-00000000000a') as d;
grant select on fol_today to authenticated;
create or replace function pg_temp.today() returns date language sql stable as $$ select d from fol_today $$;
create or replace function pg_temp.d(p int) returns date language sql stable as $$ select pg_temp.today() + p $$;
insert into auth.users (id, email) values
  ('28680000-0000-0000-0000-0000000000a1', 'fol-admin@example.com'),
  ('28680000-0000-0000-0000-0000000000a2', 'fol-exec@example.com'),
  ('28680000-0000-0000-0000-0000000000a3', 'fol-pm@example.com'),
  ('28680000-0000-0000-0000-0000000000a4', 'fol-fca@example.com'),
  ('28680000-0000-0000-0000-0000000000a5', 'fol-fcb@example.com'),
  ('28680000-0000-0000-0000-0000000000a6', 'fol-eng@example.com'),
  ('28680000-0000-0000-0000-0000000000b1', 'fol-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('28680000-0000-0000-0000-0000000000a1', '28680000-0000-0000-0000-00000000000a', 'FOL Admin', 'fol-admin@example.com', 'Admin', 'active'),
  ('28680000-0000-0000-0000-0000000000a2', '28680000-0000-0000-0000-00000000000a', 'FOL Exec',  'fol-exec@example.com',  'Executive', 'active'),
  ('28680000-0000-0000-0000-0000000000a3', '28680000-0000-0000-0000-00000000000a', 'FOL PM',    'fol-pm@example.com',    'Project Manager', 'active'),
  ('28680000-0000-0000-0000-0000000000a4', '28680000-0000-0000-0000-00000000000a', 'FOL FC A',  'fol-fca@example.com',   'Engineer', 'active'),
  ('28680000-0000-0000-0000-0000000000a5', '28680000-0000-0000-0000-00000000000a', 'FOL FC B',  'fol-fcb@example.com',   'Engineer', 'active'),
  ('28680000-0000-0000-0000-0000000000a6', '28680000-0000-0000-0000-00000000000a', 'FOL Eng',   'fol-eng@example.com',   'Engineer', 'active'),
  ('28680000-0000-0000-0000-0000000000b1', '28680000-0000-0000-0000-00000000000b', 'FOL XOrg',  'fol-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('28680000-0000-0000-0000-0000000000d1', '28680000-0000-0000-0000-00000000000a', 'FOL Site', 'Ongoing Project', '28680000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('28680000-0000-0000-0000-000000000401', '28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-0000000000d1', 'FOL WO A', 'Issued', 1000, 'exclusive', 0),
  ('28680000-0000-0000-0000-000000000402', '28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-0000000000d1', 'FOL WO B', 'Issued', 1000, 'exclusive', 0),
  ('28680000-0000-0000-0000-000000000403', '28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-0000000000d1', 'FOL WO C', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('28680000-0000-0000-0000-000000000c01', '28680000-0000-0000-0000-00000000000a', 'FL-A', 'Home crew',     '28680000-0000-0000-0000-0000000000a4'),
  ('28680000-0000-0000-0000-000000000c02', '28680000-0000-0000-0000-00000000000a', 'FL-B', 'Receiving crew', '28680000-0000-0000-0000-0000000000a5'),
  ('28680000-0000-0000-0000-000000000c03', '28680000-0000-0000-0000-00000000000a', 'FL-C', 'Loan crew',      null),
  ('28680000-0000-0000-0000-000000000c04', '28680000-0000-0000-0000-00000000000a', 'FL-D', 'Archived crew',  null),
  ('28680000-0000-0000-0000-000000000c05', '28680000-0000-0000-0000-00000000000a', 'FL-E', 'Unrostered crew', null),
  ('28680000-0000-0000-0000-0000000000c0', '28680000-0000-0000-0000-00000000000b', 'FL-X', 'Foreign crew',   null);
insert into people (id, org_id, kind, name, profile_id) values
  ('28680000-0000-0000-0000-000000000f01', '28680000-0000-0000-0000-00000000000a', 'vendor', 'Follower One',   null),
  ('28680000-0000-0000-0000-000000000f02', '28680000-0000-0000-0000-00000000000a', 'vendor', 'Follower Two',   null),
  ('28680000-0000-0000-0000-000000000f03', '28680000-0000-0000-0000-00000000000a', 'vendor', 'Follower Three', null),
  ('28680000-0000-0000-0000-000000000f04', '28680000-0000-0000-0000-00000000000a', 'vendor', 'Follower Four',  null),
  ('28680000-0000-0000-0000-000000000f05', '28680000-0000-0000-0000-00000000000a', 'vendor', 'Follower Five',  null),
  ('28680000-0000-0000-0000-000000000f06', '28680000-0000-0000-0000-00000000000a', 'vendor', 'Unplaced',       null),
  ('28680000-0000-0000-0000-000000000f07', '28680000-0000-0000-0000-00000000000a', 'vendor', 'Loaned',         null),
  ('28680000-0000-0000-0000-000000000f08', '28680000-0000-0000-0000-00000000000a', 'vendor', 'Stays',          null);
insert into crew_members (org_id, crew_id, worker_id, valid_from)
  select '28680000-0000-0000-0000-00000000000a'::uuid, '28680000-0000-0000-0000-000000000c01'::uuid, ('28680000-0000-0000-0000-000000000f0' || n)::uuid, pg_temp.today() - 40
    from generate_series(1, 5) n union all
  select '28680000-0000-0000-0000-00000000000a'::uuid, '28680000-0000-0000-0000-000000000c01'::uuid, ('28680000-0000-0000-0000-000000000f0' || n)::uuid, pg_temp.today() - 40
    from generate_series(7, 8) n;
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-000000000401', '28680000-0000-0000-0000-000000000c01', pg_temp.today() - 40),
  ('28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-000000000402', '28680000-0000-0000-0000-000000000c02', pg_temp.today() - 40),
  ('28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-000000000403', '28680000-0000-0000-0000-000000000c03', pg_temp.today() - 40);
-- The archived crew's roster placement is ended first (the base's archive guard refuses a crew still rostered).
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from, valid_to) values
  ('28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-000000000402', '28680000-0000-0000-0000-000000000c04', pg_temp.today() - 40, pg_temp.today() - 20);
update crews set archived_at = now() where id = '28680000-0000-0000-0000-000000000c04';
insert into crew_loans (org_id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-000000000f07', '28680000-0000-0000-0000-000000000c01', '28680000-0000-0000-0000-000000000c03', pg_temp.d(-7), pg_temp.d(-7));

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.rec(p_wo text, p_day int, p_source text, p_worker text, p_follow text, p_hours int) returns integer language sql as $$
  select attendance_record(('28680000-0000-0000-0000-000000000' || p_wo)::uuid, pg_temp.d(p_day), p_source,
    jsonb_build_array(jsonb_build_object('worker_id', '28680000-0000-0000-0000-000000000' || p_worker, 'status', 'present', 'hours', p_hours)
      || case when p_follow is null then '{}'::jsonb else jsonb_build_object('followed_crew_id', '28680000-0000-0000-0000-000000000' || p_follow) end))
$$;
grant execute on function pg_temp.rec(text, int, text, text, text, int), pg_temp.act_as(uuid), pg_temp.d(int), pg_temp.today() to authenticated;

set local role authenticated;
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a5');
-- AC-FOL-001: the receiving crew's controller records the follow.
select throws_ok($$ select pg_temp.rec('402', -4, 'roster_tick', 'f01', null, 8) $$, '23514',
  'ATT_NOT_ROSTERED: this person is not in a crew rostered on this work order that day',
  'AC-FOL-001 without a followed crew the un-loaned worker is still refused');
select is(pg_temp.rec('402', -4, 'roster_tick', 'f01', 'c02', 8), 1, 'AC-FOL-001 the receiving crew''s controller records the follow');
select is((select crew_id || ':' || followed_crew_id from attendance_days where worker_id = '28680000-0000-0000-0000-000000000f01' and work_date = pg_temp.d(-4))::text,
  '28680000-0000-0000-0000-000000000c02:28680000-0000-0000-0000-000000000c02', 'AC-FOL-001 the day record carries the followed crew as its crew');
select is((select count(*)::int from crew_members where worker_id = '28680000-0000-0000-0000-000000000f01' and crew_id <> '28680000-0000-0000-0000-000000000c01'), 0,
  'AC-FOL-001 the home placement is untouched');
-- AC-FOL-002: roster and effective crew agree.
select is(worker_effective_crew('28680000-0000-0000-0000-000000000f01', pg_temp.d(-4)), '28680000-0000-0000-0000-000000000c02'::uuid, 'AC-FOL-002 that day the effective crew is the followed crew');
select is(worker_effective_crew('28680000-0000-0000-0000-000000000f01', pg_temp.d(-5)), '28680000-0000-0000-0000-000000000c01'::uuid, 'AC-FOL-002 another day it is the placement');
select is((select m::text from work_order_roster('28680000-0000-0000-0000-000000000402', pg_temp.d(-4)) r, jsonb_array_elements(r.members) m
            where r.crew_id = '28680000-0000-0000-0000-000000000c02' and m->>'worker_id' = '28680000-0000-0000-0000-000000000f01'),
  '{"followed": true, "worker_id": "28680000-0000-0000-0000-000000000f01", "display_name": "Follower One", "off_rotation": false, "from_crew_name": "Home crew", "standard_role_id": null}',
  'AC-FOL-002 the receiving roster lists the worker as followed, from the home crew, with no standard role');
select is((select count(*)::int from work_order_roster('28680000-0000-0000-0000-000000000401', pg_temp.d(-4)) r, jsonb_array_elements(r.members) m
            where m->>'worker_id' = '28680000-0000-0000-0000-000000000f01'), 0, 'AC-FOL-002 the home roster no longer lists the worker that day');
select is((select count(*)::int from work_order_roster('28680000-0000-0000-0000-000000000401', pg_temp.d(-5)) r, jsonb_array_elements(r.members) m
            where m->>'worker_id' = '28680000-0000-0000-0000-000000000f01'), 1, 'AC-FOL-002 the home roster lists the worker on other days');
select is((select count(*)::int from work_order_roster('28680000-0000-0000-0000-000000000402', pg_temp.d(-5)) r, jsonb_array_elements(r.members) m
            where m->>'worker_id' = '28680000-0000-0000-0000-000000000f01'), 0, 'AC-FOL-002 the receiving roster does not list the worker on other days');
select is(pg_temp.rec('402', -4, 'roster_tick', 'f01', null, 6), 1, 'AC-FOL-002 a later tick on the receiving work order is accepted without naming the follow');
select is(pg_temp.rec('402', -4, 'roster_tick', 'f01', 'c02', 5), 1, 'AC-FOL-002 naming the same follow again is accepted');
select is((select hours from attendance_days where worker_id = '28680000-0000-0000-0000-000000000f01' and work_date = pg_temp.d(-4)), 5.00::numeric, 'AC-FOL-002 the latest hours stand on the one record');
-- the home crew's foreman cannot see the row but the rosters still agree
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from work_order_roster('28680000-0000-0000-0000-000000000401', pg_temp.d(-4)) r, jsonb_array_elements(r.members) m
            where m->>'worker_id' = '28680000-0000-0000-0000-000000000f01'), 0, 'AC-FOL-002 the home foreman''s own roster read drops the worker too');
-- AC-FOL-003: who may record a followed day.
select throws_ok($$ select pg_temp.rec('402', -3, 'roster_tick', 'f02', 'c02', 8) $$, '42501', 'not authorized', 'AC-FOL-003 the home crew''s foreman cannot record a follow into another crew');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a6');
select throws_ok($$ select pg_temp.rec('402', -3, 'roster_tick', 'f02', 'c02', 8) $$, '42501', 'not authorized', 'AC-FOL-003 an Engineer who is nobody''s foreman is refused');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000b1');
select throws_ok($$ select pg_temp.rec('402', -3, 'roster_tick', 'f02', 'c02', 8) $$, 'P0002', 'work order not found', 'AC-FOL-003 another organisation sees nothing');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a1');
select is(pg_temp.rec('402', -3, 'roster_tick', 'f02', 'c02', 8), 1, 'AC-FOL-003 an Admin records a follow');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a2');
select is(pg_temp.rec('402', -3, 'roster_tick', 'f03', 'c02', 8), 1, 'AC-FOL-003 an Executive records a follow');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a3');
select is(pg_temp.rec('402', -3, 'manual_correction', 'f04', 'c02', 8), 1, 'AC-FOL-003 a Project Manager records a follow (manual correction)');
-- AC-FOL-004: invalid follows.
select throws_ok($$ select pg_temp.rec('402', -2, 'roster_tick', 'f05', 'c05', 8) $$, '23514', 'ATT_FOLLOW_CREW: that crew is not rostered on this work order that day', 'AC-FOL-004 a crew not rostered on this work order is refused');
select throws_ok($$ select pg_temp.rec('401', -2, 'roster_tick', 'f05', 'c01', 8) $$, '23514', 'ATT_FOLLOW_CREW: this person is already in that crew that day', 'AC-FOL-004 following one''s own crew is refused');
select throws_ok($$ select pg_temp.rec('402', -2, 'roster_tick', 'f05', 'c04', 8) $$, '23514', 'ATT_FOLLOW_CREW: that crew is not rostered on this work order that day', 'AC-FOL-004 an archived crew is refused');
select throws_ok($$ select pg_temp.rec('402', -2, 'roster_tick', 'f05', '0c0', 8) $$, '23514', 'ATT_FOLLOW_CREW: that crew is not rostered on this work order that day', 'AC-FOL-004 a crew of another organisation is refused');
select throws_ok($$ select pg_temp.rec('402', -2, 'roster_tick', 'f06', 'c02', 8) $$, '23514', 'ATT_FOLLOW_UNPLACED: this person is not placed in any crew that day', 'AC-FOL-004 a person with no placement is refused');
select throws_ok($$ select pg_temp.rec('403', -3, 'roster_tick', 'f02', 'c03', 8) $$, '23514', 'ATT_FOLLOW_CREW: this person already followed another crew that day', 'AC-FOL-004 a second, different follow the same day is refused');
-- AC-FOL-005: a planned loan wins.
select throws_ok($$ select pg_temp.rec('402', -7, 'roster_tick', 'f07', 'c02', 8) $$, '23514', 'ATT_FOLLOW_LOAN: this person is on loan to another crew that day; change the loan instead', 'AC-FOL-005 a follow into a different crew than the loan is refused');
select is(pg_temp.rec('403', -7, 'roster_tick', 'f07', 'c03', 8), 1, 'AC-FOL-005 naming the loan''s host crew is accepted');
select is((select followed_crew_id from attendance_days where worker_id = '28680000-0000-0000-0000-000000000f07' and work_date = pg_temp.d(-7)), null::uuid, 'AC-FOL-005 that record is an ordinary loan day, not a follow');
-- AC-FOL-006: phone check-in, submitted week, the 24-hour ceiling.
select throws_ok($$ select pg_temp.rec('402', -2, 'phone_check_in', 'f05', 'c02', 8) $$, '23514', 'ATT_FOLLOW_SOURCE: a phone check-in names a followed crew only when a supervisor approves it', 'AC-FOL-006 a phone check-in cannot name a followed crew outside a supervisor''s approval');
reset role;
update attendance_days set submitted_at = now() where worker_id = '28680000-0000-0000-0000-000000000f04' and work_date = pg_temp.d(-3);
set local role authenticated;
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a5');
select throws_ok($$ select pg_temp.rec('402', -3, 'roster_tick', 'f04', 'c02', 7) $$, '55000', null, 'AC-FOL-006 a submitted week still goes through the correction path');

-- AC-FOL-011 / 012: phone clock-in picks a crew rostered on the work order; approval records the picked crew.
reset role;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, area_lat, area_lng, area_radius_m) values
  ('28680000-0000-0000-0000-000000000404', '28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-0000000000d1', 'FOL WO Area', 'Issued', 1000, 'exclusive', 0, 0, 0, 500),
  ('28680000-0000-0000-0000-000000000405', '28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-0000000000d1', 'FOL WO NoArea', 'Issued', 1000, 'exclusive', 0, null, null, null);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-000000000404', '28680000-0000-0000-0000-000000000c02', pg_temp.today() - 40),
  ('28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-000000000405', '28680000-0000-0000-0000-000000000c02', pg_temp.today() - 40);
insert into people (id, org_id, kind, name, profile_id) values
  ('28680000-0000-0000-0000-000000000f09', '28680000-0000-0000-0000-00000000000a', 'employee', 'Phone Follower', '28680000-0000-0000-0000-0000000000a6');
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('28680000-0000-0000-0000-00000000000a', '28680000-0000-0000-0000-000000000c01', '28680000-0000-0000-0000-000000000f09', pg_temp.today() - 40);
set local role authenticated;
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a6');
select throws_ok($$ select phone_check_in('28680000-0000-0000-0000-000000000404', '28680000-0000-0000-0000-000000000c05', 0.0001, 0, 10) $$, '23514', 'PCI_CREW: you are not in that crew today',
  'AC-FOL-011 a crew that is not on this work order is refused');
select throws_ok($$ select phone_check_in('28680000-0000-0000-0000-000000000405', '28680000-0000-0000-0000-000000000c02', null, null, null) $$, '23514', null,
  'AC-FOL-011 with no check-in area a pick outside the person''s crew is refused with a way forward');
select is(phone_check_in('28680000-0000-0000-0000-000000000404', '28680000-0000-0000-0000-000000000c02', 0.0001, 0, 10)->>'outcome', 'not_rostered',
  'AC-FOL-011 inside the area, picking a rostered crew they are not in, becomes the supervisor request (not recorded)');
select is((select count(*)::int from attendance_days where worker_id = '28680000-0000-0000-0000-000000000f09'), 0, 'AC-FOL-011 nothing is recorded before approval');
select is((select crew_id from phone_check_ins where worker_id = '28680000-0000-0000-0000-000000000f09'), '28680000-0000-0000-0000-000000000c02'::uuid, 'AC-FOL-011 the request keeps the picked crew');
select throws_ok($$ select attendance_record('28680000-0000-0000-0000-000000000404', pg_temp.today(), 'phone_check_in',
  '[{"worker_id": "28680000-0000-0000-0000-000000000f09", "status": "present", "hours": 8, "followed_crew_id": "28680000-0000-0000-0000-000000000c02"}]'::jsonb) $$,
  '23514', 'ATT_FOLLOW_SOURCE: a phone check-in names a followed crew only when a supervisor approves it', 'AC-FOL-011 a person cannot record their own follow directly');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a4');
select throws_ok($$ select phone_check_in_decide((select id from phone_check_ins where worker_id = '28680000-0000-0000-0000-000000000f09'), true) $$, '42501', 'not authorized',
  'AC-FOL-012 the home crew''s foreman cannot approve a follow into another crew');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a5');
select is(phone_check_in_decide((select id from phone_check_ins where worker_id = '28680000-0000-0000-0000-000000000f09'), true)->>'status', 'approved',
  'AC-FOL-012 the picked crew''s foreman approves the request');
select is((select crew_id || ':' || followed_crew_id from attendance_days where worker_id = '28680000-0000-0000-0000-000000000f09' and work_date = pg_temp.today())::text,
  '28680000-0000-0000-0000-000000000c02:28680000-0000-0000-0000-000000000c02', 'AC-FOL-012 on approval the day record carries the picked crew as followed');
-- AC-FOL-013: a follow does not stand beside a day already recorded elsewhere, unless a crew manager records it.
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a4');
select is(pg_temp.rec('401', -1, 'roster_tick', 'f05', null, 8), 1, 'AC-FOL-013 the home crew''s foreman records the day present');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a5');
select throws_ok($$ select pg_temp.rec('402', -1, 'roster_tick', 'f05', 'c02', 8) $$, '23514',
  'ATT_FOLLOW_RECORDED: this person is already recorded present on another work order that day',
  'AC-FOL-013 the receiving foreman''s follow beside a day already recorded present elsewhere is refused');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a3');
select is(pg_temp.rec('402', -1, 'manual_correction', 'f05', 'c02', 8), 1, 'AC-FOL-013 a crew manager records the follow');
-- AC-FOL-014: a crew manager undoes a follow, after which the home crew can record again.
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a5');
select is(attendance_record('28680000-0000-0000-0000-000000000402', pg_temp.d(-6), 'roster_tick',
  '[{"worker_id": "28680000-0000-0000-0000-000000000f08", "status": "absent", "followed_crew_id": "28680000-0000-0000-0000-000000000c02"}]'), 1,
  'AC-FOL-014 a follow recorded absent');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a4');
select throws_ok($$ select pg_temp.rec('401', -6, 'roster_tick', 'f08', null, 8) $$, '23514',
  'ATT_NOT_ROSTERED: this person is not in a crew rostered on this work order that day', 'AC-FOL-014 the home crew cannot record that day while the follow stands');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a5');
select throws_ok($$ select attendance_clear_follow('28680000-0000-0000-0000-000000000f08', pg_temp.d(-6)) $$, '42501', 'not authorized',
  'AC-FOL-014 a foreman who is not a crew manager cannot undo a follow');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a3');
select is(attendance_clear_follow('28680000-0000-0000-0000-000000000f08', pg_temp.d(-6)), 1, 'AC-FOL-014 a crew manager undoes the follow');
select throws_ok($$ select attendance_clear_follow('28680000-0000-0000-0000-000000000f08', pg_temp.d(-6)) $$, '23514',
  'ATT_FOLLOW_NONE: no follow is recorded for this person that day', 'AC-FOL-014 undoing a day with no follow is refused');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a4');
select is(pg_temp.rec('401', -6, 'roster_tick', 'f08', null, 8), 1, 'AC-FOL-014 after the undo the home crew records the day');
select pg_temp.act_as('28680000-0000-0000-0000-0000000000a3');
select throws_ok($$ select attendance_clear_follow('28680000-0000-0000-0000-000000000f04', pg_temp.d(-3)) $$, '55000', null,
  'AC-FOL-014 a follow whose week is submitted cannot be undone');
-- AC-FOL-015: the helper that reads followed rows is not callable by a client.
select ok(not has_function_privilege('authenticated', 'public.worker_followed_crew(uuid, date)', 'execute'),
  'AC-FOL-015 an authenticated caller cannot execute worker_followed_crew');
-- AC-FOL-007: no follow recorded for another worker, so the placement still decides.
select is(worker_effective_crew('28680000-0000-0000-0000-000000000f08', pg_temp.d(-3)), '28680000-0000-0000-0000-000000000c01'::uuid, 'AC-FOL-007 a worker with no follow keeps the placement');

select * from finish();
rollback;
