-- 1751_medical_release.test.sql — medical release per person and date (docs/specs/medical-release.spec.md).
-- Migrations under test: 1751 (table, RPCs, reads) and 1752 (roster guards). notify_person has its own test (1750).
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   drop trigger zz_mr_attendance_days ............................ 'AC-MR-006 attendance ... refused'
--   make the attendance guard refuse every status ................. 'AC-MR-006 recording them absent is allowed' / 'on leave ... is allowed'
--   remove the scope predicate from medical_release_holds (keep only the date test) ... 'AC-MR-007 an Engineer outside the crew gets no rows' and 'a Foreman ... of another crew gets no rows'
--   add `perform assert_not_light()` to medical_release_holds ... 'AC-MR-007 a Foreman (field account) gets the state word'
--   drop trigger zz_mr_crew_members / zz_mr_crew_loans ............ 'AC-MR-006 a placement ... refused' / 'a loan ... refused'
--   medical_release_authority returns true ......................... 'AC-MR-002 a peer cannot decide' and 'an Admin who is not the manager cannot decide'
--   remove the SoD check from medical_release_decide ............... 'AC-MR-003 the opener cannot decide'
begin;
create extension if not exists pgtap;
select plan(36);
create or replace function pg_temp.today() returns date language sql stable as $$
  select public.equipment_org_today('17510000-0000-0000-0000-00000000010a') $$;

insert into organizations (id, name, default_currency, built_in_roles_enabled) values
  ('17510000-0000-0000-0000-00000000010a', 'MR Org', 'IDR', true),
  ('17510000-0000-0000-0000-00000000010b', 'MR Other', 'IDR', false);
insert into auth.users (id, email) values
  ('17510000-0000-0000-0000-0000000001a1', 'mr-admin@example.com'),
  ('17510000-0000-0000-0000-0000000001a2', 'mr-mgr@example.com'),
  ('17510000-0000-0000-0000-0000000001a3', 'mr-worker@example.com'),
  ('17510000-0000-0000-0000-0000000001a4', 'mr-peer@example.com'),
  ('17510000-0000-0000-0000-0000000001a5', 'mr-foreman@example.com'),
  ('17510000-0000-0000-0000-0000000001a6', 'mr-otherfm@example.com'),
  ('17510000-0000-0000-0000-0000000001b1', 'mr-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17510000-0000-0000-0000-0000000001a1', '17510000-0000-0000-0000-00000000010a', 'MR Admin',  'mr-admin@example.com',  'Admin', 'active'),
  ('17510000-0000-0000-0000-0000000001a2', '17510000-0000-0000-0000-00000000010a', 'MR Mgr',    'mr-mgr@example.com',    'Project Manager', 'active'),
  ('17510000-0000-0000-0000-0000000001a3', '17510000-0000-0000-0000-00000000010a', 'MR Worker', 'mr-worker@example.com', 'Engineer', 'active'),
  ('17510000-0000-0000-0000-0000000001a4', '17510000-0000-0000-0000-00000000010a', 'MR Peer',   'mr-peer@example.com',   'Engineer', 'active'),
  ('17510000-0000-0000-0000-0000000001a5', '17510000-0000-0000-0000-00000000010a', 'MR Foreman', 'mr-foreman@example.com', 'Engineer', 'active'),
  ('17510000-0000-0000-0000-0000000001a6', '17510000-0000-0000-0000-00000000010a', 'MR Other Foreman', 'mr-otherfm@example.com', 'Engineer', 'active'),
  ('17510000-0000-0000-0000-0000000001b1', '17510000-0000-0000-0000-00000000010b', 'MR XOrg',   'mr-xorg@example.com',   'Admin', 'active');
update profiles set manager_id = '17510000-0000-0000-0000-0000000001a2' where id = '17510000-0000-0000-0000-0000000001a3';
-- f01: has a login, manager through the profile. f02: no login, manager on the person record.
insert into people (id, org_id, kind, name, profile_id, manager_id) values
  ('17510000-0000-0000-0000-000000001f01', '17510000-0000-0000-0000-00000000010a', 'own',    'MR Own Worker', '17510000-0000-0000-0000-0000000001a3', null),
  ('17510000-0000-0000-0000-000000001f02', '17510000-0000-0000-0000-00000000010a', 'vendor', 'MR Vendor',     null, '17510000-0000-0000-0000-0000000001a2'),
  ('17510000-0000-0000-0000-000000001f03', '17510000-0000-0000-0000-00000000010a', 'vendor', 'MR Other Vendor', null, null);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('17510000-0000-0000-0000-0000000001d1', '17510000-0000-0000-0000-00000000010a', 'MR Site', 'Ongoing Project', '17510000-0000-0000-0000-0000000001a2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('17510000-0000-0000-0000-000000001401', '17510000-0000-0000-0000-00000000010a', '17510000-0000-0000-0000-0000000001d1', 'MR WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('17510000-0000-0000-0000-000000001c01', '17510000-0000-0000-0000-00000000010a', 'MR-A', 'MR Crew A', '17510000-0000-0000-0000-0000000001a5'),
  ('17510000-0000-0000-0000-000000001c02', '17510000-0000-0000-0000-00000000010a', 'MR-B', 'MR Crew B', '17510000-0000-0000-0000-0000000001a6');
-- both workers are placed in crew A before any release exists; the work order is served by crew A
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('17510000-0000-0000-0000-00000000010a', '17510000-0000-0000-0000-000000001c01', '17510000-0000-0000-0000-000000001f01', pg_temp.today() - 30),
  ('17510000-0000-0000-0000-00000000010a', '17510000-0000-0000-0000-000000001c01', '17510000-0000-0000-0000-000000001f02', pg_temp.today() - 30);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('17510000-0000-0000-0000-00000000010a', '17510000-0000-0000-0000-000000001401', '17510000-0000-0000-0000-000000001c01', pg_temp.today() - 30);
-- the foreman of crew A and of crew B are field (light) accounts
update profiles set built_in_role = 'foreman' where id in ('17510000-0000-0000-0000-0000000001a5', '17510000-0000-0000-0000-0000000001a6');
-- an attendance row recorded before any release
insert into attendance_days (org_id, worker_id, work_order_id, crew_id, work_date, status, hours, source, recorded_by)
  values ('17510000-0000-0000-0000-00000000010a', '17510000-0000-0000-0000-000000001f01', '17510000-0000-0000-0000-000000001401',
          '17510000-0000-0000-0000-000000001c01', pg_temp.today() - 6, 'present', 8, 'manual_correction', '17510000-0000-0000-0000-0000000001a2');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create temp table mr_ids (k text primary key, id uuid);
grant all on mr_ids to authenticated;
create temp table mr_d (k text primary key, d date);
insert into mr_d values ('t', pg_temp.today()), ('m2', pg_temp.today() - 2), ('m1', pg_temp.today() - 1), ('m5', pg_temp.today() - 5),
  ('p4', pg_temp.today() + 4), ('p5', pg_temp.today() + 5), ('p6', pg_temp.today() + 6), ('p7', pg_temp.today() + 7);
grant select on mr_d to authenticated;
create function pg_temp.d(p text) returns date language sql stable as $$ select d from mr_d where k = p $$;
grant execute on function pg_temp.d(text) to authenticated;

set local role authenticated;

-- AC-MR-001 the people team opens a release
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a4');
select throws_ok($$ select medical_release_create('17510000-0000-0000-0000-000000001f01', pg_temp.d('m2'), null) $$,
  '42501', null, 'AC-MR-001 someone outside the people team cannot open a release');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a1');
insert into mr_ids select 'r1', medical_release_create('17510000-0000-0000-0000-000000001f01', pg_temp.d('m2'), 'back after sickness');
insert into mr_ids select 'r2', medical_release_create('17510000-0000-0000-0000-000000001f02', pg_temp.d('p5'), null);
select is((select status from medical_releases where id = (select id from mr_ids where k = 'r1')), 'Pending', 'AC-MR-001 the people team opens a release; it starts Pending');
select throws_ok($$ select medical_release_create('17510000-0000-0000-0000-000000001f01', pg_temp.d('m2'), null) $$,
  '23514', 'MR_EXISTS: this person already has a release for that date', 'AC-MR-001 a second release for the same person and date is refused');
select ok(not has_table_privilege('authenticated', 'public.medical_releases', 'INSERT'), 'AC-MR-001 no direct client write path to the table');

-- AC-MR-006 the block, while the release is Pending (f01 from m2; f02 from p5)
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a2');
select throws_ok($$ select attendance_record('17510000-0000-0000-0000-000000001401', pg_temp.d('m1'), 'roster_tick',
  '[{"worker_id": "17510000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]') $$,
  '23514', 'MR_BLOCKED: this person''s medical release is not approved; their direct manager must approve it before attendance is recorded',
  'AC-MR-006 attendance on a day on or after the release date is refused while it is pending');
select is(attendance_record('17510000-0000-0000-0000-000000001401', pg_temp.d('t'), 'roster_tick',
  '[{"worker_id": "17510000-0000-0000-0000-000000001f01", "status": "absent"}]'), 1,
  'AC-MR-006 recording them absent is allowed: only a row that puts the person to work is refused');
select is(attendance_record('17510000-0000-0000-0000-000000001401', pg_temp.d('m1'), 'roster_tick',
  '[{"worker_id": "17510000-0000-0000-0000-000000001f01", "status": "leave"}]'), 1,
  'AC-MR-006 recording them on leave (no hours) is allowed');
select is(attendance_record('17510000-0000-0000-0000-000000001401', pg_temp.d('m5'), 'roster_tick',
  '[{"worker_id": "17510000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]'), 1,
  'AC-MR-006 a day before the release date is allowed');
select is(attendance_record('17510000-0000-0000-0000-000000001401', pg_temp.d('m1'), 'roster_tick',
  '[{"worker_id": "17510000-0000-0000-0000-000000001f02", "status": "present", "hours": 8}]'), 1,
  'AC-MR-006 another person with a release dated later is not held on an earlier day');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a1');
select throws_ok($$ insert into crew_members (crew_id, worker_id, valid_from) values ('17510000-0000-0000-0000-000000001c02', '17510000-0000-0000-0000-000000001f02', pg_temp.d('p6')) $$,
  '23514', 'MR_BLOCKED: this person''s medical release is not approved; their direct manager must approve it before they are rostered',
  'AC-MR-006 a placement reaching the release date is refused');
select throws_ok($$ insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('17510000-0000-0000-0000-000000001f02', '17510000-0000-0000-0000-000000001c01', '17510000-0000-0000-0000-000000001c02', pg_temp.d('p6'), pg_temp.d('p7')) $$,
  '23514', 'MR_BLOCKED: this person''s medical release is not approved; their direct manager must approve it before they are rostered',
  'AC-MR-006 a loan on or after the release date is refused');
select lives_ok($$ insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('17510000-0000-0000-0000-000000001f02', '17510000-0000-0000-0000-000000001c01', '17510000-0000-0000-0000-000000001c02', pg_temp.d('t'), pg_temp.d('p4')) $$,
  'AC-MR-006 a loan ending before the release date is allowed');
select lives_ok($$ insert into crew_members (crew_id, worker_id, valid_from) values ('17510000-0000-0000-0000-000000001c02', '17510000-0000-0000-0000-000000001f03', pg_temp.d('p6')) $$,
  'AC-MR-006 a person with no release is rostered as before');
select lives_ok($$ update crew_members set valid_to = pg_temp.d('p4') where worker_id = '17510000-0000-0000-0000-000000001f02' and crew_id = '17510000-0000-0000-0000-000000001c01' $$,
  'AC-MR-006 shrinking an existing open placement is not refused');
select throws_ok($$ update crew_members set valid_to = pg_temp.d('p7') where worker_id = '17510000-0000-0000-0000-000000001f02' and crew_id = '17510000-0000-0000-0000-000000001c01' $$,
  '23514', null, 'AC-MR-006 extending a placement into the held days is refused');

-- AC-MR-007 a state word for roster users; the row stays closed
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a4');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a1');
select is((select state from medical_release_holds(pg_temp.d('t')) where person_id = '17510000-0000-0000-0000-000000001f01'), 'pending',
  'AC-MR-007 the people team reads the state word');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a4');
select is((select count(*)::int from medical_release_holds(pg_temp.d('t'))), 0, 'AC-MR-007 an Engineer outside the crew gets no rows');
select is((select count(*)::int from medical_releases), 0, 'AC-MR-007 a user outside the release reads no row');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a6');
select is((select count(*)::int from medical_release_holds(pg_temp.d('t'))), 0, 'AC-MR-007 a Foreman (field account) of another crew gets no rows');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a5');
select is((select state from medical_release_holds(pg_temp.d('t')) where person_id = '17510000-0000-0000-0000-000000001f01'), 'pending',
  'AC-MR-007 a Foreman (field account) gets the state word for a held person in their own crew');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a2');
select is((select state from medical_release_holds(pg_temp.d('t')) where person_id = '17510000-0000-0000-0000-000000001f01'), 'pending',
  'AC-MR-007 the direct manager (a crew manager here) gets the state word');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001b1');
select is((select count(*)::int from medical_release_holds(pg_temp.d('t'))), 0, 'AC-MR-007 another organisation reads nothing');
select is((select count(*)::int from medical_releases_visible()), 0, 'AC-MR-007 another organisation sees no release');

-- AC-MR-002 / 003 who decides
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a4');
select throws_ok($$ select medical_release_decide((select id from mr_ids where k = 'r1'), 'Approved', null) $$, '42501', null, 'AC-MR-002 a peer cannot decide');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a1');
select throws_ok($$ select medical_release_decide((select id from mr_ids where k = 'r2'), 'Approved', null) $$,
  '42501', null, 'AC-MR-003 the opener cannot decide');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a3');
select throws_ok($$ select medical_release_decide((select id from mr_ids where k = 'r1'), 'Approved', null) $$,
  '42501', 'MR_SOD: you cannot decide your own release, or one you entered', 'AC-MR-003 the person cannot decide their own release');
select pg_temp.act_as('17510000-0000-0000-0000-0000000001a2');
select is((select can_decide from medical_releases_visible() where id = (select id from mr_ids where k = 'r1')), true, 'AC-MR-009 the direct manager is told they may decide');
select throws_ok($$ select medical_release_decide((select id from mr_ids where k = 'r1'), 'Deferred', ' ') $$,
  '23514', 'MR_NOTE: give a reason when deferring', 'AC-MR-004 deferring needs a reason');
select is(medical_release_decide((select id from mr_ids where k = 'r1'), 'Deferred', 'not yet fit to return'), 'Deferred', 'AC-MR-004 the manager defers with a reason');
select is(medical_release_decide((select id from mr_ids where k = 'r2'), 'Approved', null), 'Approved', 'AC-MR-002 the manager of a person with no login (person record) approves');
select throws_ok($$ select medical_release_decide((select id from mr_ids where k = 'r2'), 'Deferred', 'x') $$,
  '23514', 'MR_DECIDED: this release is already approved', 'AC-MR-004 an approved release cannot be decided again');
select is(medical_release_decide((select id from mr_ids where k = 'r1'), 'Approved', null), 'Approved', 'AC-MR-004 a deferred release can be approved later');

-- AC-MR-006 after approval nothing is held
select is(attendance_record('17510000-0000-0000-0000-000000001401', pg_temp.d('m1'), 'roster_tick',
  '[{"worker_id": "17510000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]'), 1, 'AC-MR-006 after approval attendance is recorded again');

-- AC-MR-004 / 005 audit and the worker's notice (read as the owner)
reset role;
select is((select count(*)::int from audit_events where action in ('medical_release.create', 'medical_release.deferred', 'medical_release.approved')), 5,
  'AC-MR-004 every create and decision is audited');
select is((select count(*)::int from notifications where owner_id = '17510000-0000-0000-0000-0000000001a3' and metadata->'entity'->>'type' = 'medical_release'), 2,
  'AC-MR-005 the worker with a login is told after each decision; the person with no login is not');
select is((select count(*)::int from notifications where body ilike '%not yet fit%' or title ilike '%not yet fit%'), 0, 'AC-MR-005 the manager''s reason is not in the notice');
select * from finish();
rollback;
