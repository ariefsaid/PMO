-- leave_requests.test.sql — #2708 (docs/specs/leave-requests.spec.md). Migrations under test: 1240, 1241, 1242.
-- AC-LV-001 types · AC-LV-002 request · AC-LV-003 overlap · AC-LV-004 entered on behalf · AC-LV-005 line manager approves ·
-- AC-LV-006 nobody decides their own or an entered request, Admin included · AC-LV-007 approver-role setting ·
-- AC-LV-008 rejection note, one decision · AC-LV-009 other organisation · AC-LV-010 roster marker ·
-- AC-LV-011 attendance is not blocked · settings write path (Admin only) and the OFF state.
begin;
create extension if not exists pgtap;
select plan(45);
create or replace function pg_temp.today() returns date language sql stable as $$
  select public.equipment_org_today('27080000-0000-0000-0000-00000000010a') $$;

insert into organizations (id, name, default_currency) values
  ('27080000-0000-0000-0000-00000000010a', 'LV Org', 'IDR'),
  ('27080000-0000-0000-0000-00000000010b', 'LV Other', 'IDR');
insert into auth.users (id, email) values
  ('27080000-0000-0000-0000-0000000001a1', 'lv-admin@example.com'),
  ('27080000-0000-0000-0000-0000000001a2', 'lv-pm@example.com'),
  ('27080000-0000-0000-0000-0000000001a3', 'lv-worker@example.com'),
  ('27080000-0000-0000-0000-0000000001a4', 'lv-eng@example.com'),
  ('27080000-0000-0000-0000-0000000001a5', 'lv-fin@example.com'),
  ('27080000-0000-0000-0000-0000000001b1', 'lv-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27080000-0000-0000-0000-0000000001a1', '27080000-0000-0000-0000-00000000010a', 'LV Admin',  'lv-admin@example.com',  'Admin', 'active'),
  ('27080000-0000-0000-0000-0000000001a2', '27080000-0000-0000-0000-00000000010a', 'LV PM',     'lv-pm@example.com',     'Project Manager', 'active'),
  ('27080000-0000-0000-0000-0000000001a3', '27080000-0000-0000-0000-00000000010a', 'LV Worker', 'lv-worker@example.com', 'Engineer', 'active'),
  ('27080000-0000-0000-0000-0000000001a4', '27080000-0000-0000-0000-00000000010a', 'LV Eng',    'lv-eng@example.com',    'Engineer', 'active'),
  ('27080000-0000-0000-0000-0000000001a5', '27080000-0000-0000-0000-00000000010a', 'LV Fin',    'lv-fin@example.com',    'Finance', 'active'),
  ('27080000-0000-0000-0000-0000000001b1', '27080000-0000-0000-0000-00000000010b', 'LV XOrg',   'lv-xorg@example.com',   'Admin', 'active');
update profiles set manager_id = '27080000-0000-0000-0000-0000000001a2' where id = '27080000-0000-0000-0000-0000000001a3';
insert into people (id, org_id, kind, name, profile_id) values
  ('27080000-0000-0000-0000-000000001f01', '27080000-0000-0000-0000-00000000010a', 'own',    'LV Own Worker', '27080000-0000-0000-0000-0000000001a3'),
  ('27080000-0000-0000-0000-000000001f02', '27080000-0000-0000-0000-00000000010a', 'vendor', 'LV Vendor',     null),
  ('27080000-0000-0000-0000-000000001f03', '27080000-0000-0000-0000-00000000010a', 'own',    'LV Admin Person', '27080000-0000-0000-0000-0000000001a1');
-- roster fixtures for AC-LV-011
insert into projects (id, org_id, name, status, project_manager_id) values
  ('27080000-0000-0000-0000-0000000001d1', '27080000-0000-0000-0000-00000000010a', 'LV Site', 'Ongoing Project', '27080000-0000-0000-0000-0000000001a2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27080000-0000-0000-0000-000000001401', '27080000-0000-0000-0000-00000000010a', '27080000-0000-0000-0000-0000000001d1', 'LV WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('27080000-0000-0000-0000-000000001c01', '27080000-0000-0000-0000-00000000010a', 'LV-A', 'LV Crew', '27080000-0000-0000-0000-0000000001a2');
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('27080000-0000-0000-0000-00000000010a', '27080000-0000-0000-0000-000000001c01', '27080000-0000-0000-0000-000000001f01', pg_temp.today() - 30);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('27080000-0000-0000-0000-00000000010a', '27080000-0000-0000-0000-000000001401', '27080000-0000-0000-0000-000000001c01', pg_temp.today() - 30);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create temp table lv_ids (k text primary key, id uuid);
grant all on lv_ids to authenticated;
create temp table lv_d (k text primary key, d date);
insert into lv_d values ('t', pg_temp.today()), ('y', pg_temp.today() - 1), ('p10', pg_temp.today() + 10), ('p11', pg_temp.today() + 11),
  ('p12', pg_temp.today() + 12), ('p13', pg_temp.today() + 13), ('p14', pg_temp.today() + 14), ('p20', pg_temp.today() + 20),
  ('p21', pg_temp.today() + 21), ('p30', pg_temp.today() + 30), ('p40', pg_temp.today() + 40);
grant select on lv_d to authenticated;
create function pg_temp.d(p text) returns date language sql stable as $$ select d from lv_d where k = p $$;
grant execute on function pg_temp.d(text) to authenticated;

set local role authenticated;

-- settings: off by default, Admin-only write path
select is((select leave_enabled()), false, 'OFF by default: an organisation that never switched it on has it off');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a2');
select throws_ok($$ select set_leave_settings(true, null) $$, '42501', null, 'settings: a non-Admin cannot switch leave on');
select ok(not has_column_privilege('authenticated', 'public.organizations', 'leave_requests_enabled', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.organizations', 'leave_approver_role', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.leave_requests', 'INSERT'),
  'settings: no direct client write path to the settings columns or the requests table');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a1');
select throws_ok($$ select leave_request_submit('27080000-0000-0000-0000-000000001f01', gen_random_uuid(), pg_temp.d('p10'), pg_temp.d('p11'), null) $$,
  '42501', 'LV_DISABLED: leave requests are not switched on for this organisation', 'OFF: a request is refused while the feature is off');
select throws_ok($$ select set_leave_settings(true, 'Nonsense') $$, '22023', null, 'settings: an unknown approver role is refused');
select lives_ok($$ select set_leave_settings(true, null) $$, 'settings: an Admin switches it on');
select is((select leave_enabled()), true, 'settings: on for the Admin''s organisation');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001b1');
select is((select leave_enabled()), false, 'AC-LV-009 settings are per organisation: the other organisation is still off');

-- AC-LV-001
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a1');
insert into leave_types (name) values ('Type A');
select is((select count(*)::int from leave_types where name = 'Type A'), 1, 'AC-LV-001 an Admin adds a type; it is listed');
select throws_ok($$ insert into leave_types (name) values ('type a') $$, '23505', null, 'AC-LV-001 a duplicate live name is refused');
insert into leave_types (name) values ('Type B');
update leave_types set archived_at = now() where name = 'Type B';
select lives_ok($$ insert into leave_types (name) values ('Type B') $$, 'AC-LV-001 an archived name can be reused');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a2');
select throws_ok($$ insert into leave_types (name) values ('Type C') $$, '42501', null, 'AC-LV-001 a non-Admin cannot add a type');
reset role;
insert into lv_ids select 'ta', id from leave_types where name = 'Type A';
set local role authenticated;

-- AC-LV-002 / 003 / 004
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a3');
insert into lv_ids select 'w1', leave_request_submit('27080000-0000-0000-0000-000000001f01', (select id from lv_ids where k = 'ta'), pg_temp.d('p10'), pg_temp.d('p12'), 'cough');
select is((select status from leave_requests where id = (select id from lv_ids where k = 'w1')), 'Pending', 'AC-LV-002 a person requests leave for themselves; it starts Pending');
select throws_ok($$ select leave_request_submit('27080000-0000-0000-0000-000000001f01', (select id from lv_ids where k = 'ta'), pg_temp.d('p12'), pg_temp.d('p10'), null) $$,
  '23514', 'LV_RANGE: the last day is before the first day', 'AC-LV-002 a last day before the first is refused');
select throws_ok($$ select leave_request_submit('27080000-0000-0000-0000-000000001f01', (select id from lv_ids where k = 'ta'), pg_temp.d('p12'), pg_temp.d('p14'), null) $$,
  '23514', 'LV_OVERLAP: this person already has a pending or approved request on some of these days', 'AC-LV-003 an overlapping live request is refused');
select throws_ok($$ select leave_request_submit('27080000-0000-0000-0000-000000001f02', (select id from lv_ids where k = 'ta'), pg_temp.d('p20'), pg_temp.d('p21'), null) $$,
  '42501', null, 'AC-LV-004 a person cannot enter a request for someone else');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a2');
insert into lv_ids select 'v1', leave_request_submit('27080000-0000-0000-0000-000000001f02', (select id from lv_ids where k = 'ta'), pg_temp.d('p20'), pg_temp.d('p21'), null);
select is((select entered_by from leave_requests where id = (select id from lv_ids where k = 'v1')), '27080000-0000-0000-0000-0000000001a2'::uuid,
  'AC-LV-004 an office user enters it for a person without a login; the enterer is recorded');

-- AC-LV-006 the guard, for every role
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a3');
select throws_ok($$ select leave_request_decide((select id from lv_ids where k = 'w1'), 'Approved', null) $$,
  '42501', 'LV_SOD: you cannot decide your own request, or one you entered', 'AC-LV-006 the person cannot approve their own request');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a2');
select throws_ok($$ select leave_request_decide((select id from lv_ids where k = 'v1'), 'Approved', null) $$,
  '42501', 'LV_SOD: you cannot decide your own request, or one you entered', 'AC-LV-006 whoever entered a request cannot approve it');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a1');
insert into lv_ids select 'a1', leave_request_submit('27080000-0000-0000-0000-000000001f03', (select id from lv_ids where k = 'ta'), pg_temp.d('p30'), pg_temp.d('p30'), null);
select throws_ok($$ select leave_request_decide((select id from lv_ids where k = 'a1'), 'Approved', null) $$,
  '42501', 'LV_SOD: you cannot decide your own request, or one you entered', 'AC-LV-006 an Admin cannot approve their own request');

-- AC-LV-007 authority
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a4');
select throws_ok($$ select leave_request_decide((select id from lv_ids where k = 'w1'), 'Approved', null) $$,
  '42501', 'LV_FORBIDDEN: you cannot decide this request', 'AC-LV-007 an unrelated user cannot decide');
select is((select count(*)::int from leave_requests_visible()), 0, 'AC-LV-013 an unrelated user sees no requests');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a3');
select is((select count(*)::int from leave_requests_visible()), 1, 'AC-LV-013 the person sees only their own request');
select is((select can_decide from leave_requests_visible() limit 1), false, 'AC-LV-013 the person is not offered Approve on their own request');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a1');
-- empty setting, no line manager: Admin decides the vendor request (entered by the PM)
select is(leave_request_decide((select id from lv_ids where k = 'v1'), 'Approved', null), 'Approved',
  'AC-LV-007 with the setting empty, an Admin decides a request that has no line manager');
select throws_ok($$ select leave_request_decide((select id from lv_ids where k = 'v1'), 'Approved', null) $$,
  '23514', 'LV_DECIDED: this request is already approved', 'AC-LV-008 a decided request cannot be decided again');
-- AC-LV-005 the line manager
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a2');
select throws_ok($$ select leave_request_decide((select id from lv_ids where k = 'w1'), 'Rejected', ' ') $$,
  '23514', 'LV_NOTE: give a reason when rejecting', 'AC-LV-008 a rejection needs a note');
select is(leave_request_decide((select id from lv_ids where k = 'w1'), 'Approved', null), 'Approved', 'AC-LV-005 the line manager approves');
reset role;
select is((select decided_by from leave_requests where id = (select id from lv_ids where k = 'w1')), '27080000-0000-0000-0000-0000000001a2'::uuid,
  'AC-LV-005 the decider is recorded');
set local role authenticated;

-- AC-LV-007 the approver-role setting
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a1');
select lives_ok($$ select set_leave_settings(true, 'Finance') $$, 'AC-LV-007 an Admin sets the approver role');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a2');
insert into lv_ids select 'v2', leave_request_submit('27080000-0000-0000-0000-000000001f02', (select id from lv_ids where k = 'ta'), pg_temp.d('p40'), pg_temp.d('p40'), null);
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a1');
select throws_ok($$ select leave_request_decide((select id from lv_ids where k = 'v2'), 'Approved', null) $$,
  '42501', 'LV_FORBIDDEN: you cannot decide this request', 'AC-LV-007 with a role set, an Admin who is neither that role nor the line manager cannot decide');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a5');
select is(leave_request_decide((select id from lv_ids where k = 'v2'), 'Rejected', 'not this week'), 'Rejected', 'AC-LV-007 a user with the configured role decides');

-- AC-LV-009 other organisation
select pg_temp.act_as('27080000-0000-0000-0000-0000000001b1');
select throws_ok($$ select leave_request_decide((select id from lv_ids where k = 'w1'), 'Approved', null) $$,
  'P0002', null, 'AC-LV-009 another organisation cannot decide');
select is((select count(*)::int from leave_requests), 0, 'AC-LV-009 another organisation reads no requests');
select is((select count(*)::int from leave_on_date(pg_temp.d('p10'))), 0, 'AC-LV-009 another organisation sees no marker');

-- AC-LV-010 roster marker
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a4');
select is((select count(*)::int from leave_on_date(pg_temp.d('p11'))), 1, 'AC-LV-010 an approved day returns the person');
select is((select count(*)::int from leave_on_date(pg_temp.d('p13'))), 0, 'AC-LV-010 a day outside the range returns nobody');
select is((select count(*)::int from leave_on_date(pg_temp.d('p30'))), 0, 'AC-LV-010 a pending request is not a marker');
select is((select count(*)::int from leave_on_date(pg_temp.d('p40'))), 0, 'AC-LV-010 a rejected request is not a marker');

-- AC-LV-011 attendance is not blocked: approve leave for yesterday, then tick the person present for it
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a1');
select lives_ok($$ select set_leave_settings(true, null) $$, 'setting back to empty');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a3');
insert into lv_ids select 'y1', leave_request_submit('27080000-0000-0000-0000-000000001f01', (select id from lv_ids where k = 'ta'), pg_temp.d('y'), pg_temp.d('y'), null);
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a2');
select leave_request_decide((select id from lv_ids where k = 'y1'), 'Approved', null);
select is(attendance_record('27080000-0000-0000-0000-000000001401', pg_temp.d('y'), 'roster_tick',
  '[{"worker_id": "27080000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]'), 1,
  'AC-LV-011 approved leave does not block the attendance tick');

-- the form's person picker: a person sees themselves, an office user sees everyone
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a3');
select is((select count(*)::int from leave_requestable_people()), 1, 'picker: a person may enter a request only for themselves');
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a2');
select is((select count(*)::int from leave_requestable_people()), 3, 'picker: an office user may enter one for every person');

-- OFF state: switching off hides the marker and refuses new requests
select pg_temp.act_as('27080000-0000-0000-0000-0000000001a1');
select lives_ok($$ select set_leave_settings(false, null) $$, 'OFF: an Admin switches it off');
select is((select count(*)::int from leave_on_date(pg_temp.d('y'))), 0, 'OFF: no marker while off');
select * from finish();
rollback;
