-- crews_roster.test.sql — #2528 Slice 1 (docs/specs/crews-roster-attendance.spec.md).
-- Migration under test: 1035_crews_roster.sql.
-- AC-CRW-001 duplicate crew code refused, archive frees it · AC-CRW-002 one crew per person per day ·
-- AC-CRW-003 one work order per crew per day · AC-CRW-004 the roster for a date shows members and role shortfall ·
-- AC-CRW-014 another organisation, or a role without permission, reads nothing and changes nothing.
begin;
create extension if not exists pgtap;
select plan(37);
select fk_ok('public', 'crew_members', 'worker_id', 'public', 'people', 'id', 'crew membership uses the workforce register');

insert into organizations (id, name, default_currency) values
  ('25280000-0000-0000-0000-00000000000a', 'CRW Org',       'IDR'),
  ('25280000-0000-0000-0000-00000000000b', 'CRW Other Org', 'IDR');
insert into auth.users (id, email) values
  ('25280000-0000-0000-0000-0000000000a1', 'crw-admin@example.com'),
  ('25280000-0000-0000-0000-0000000000a3', 'crw-pm@example.com'),
  ('25280000-0000-0000-0000-0000000000a4', 'crw-eng@example.com'),
  ('25280000-0000-0000-0000-0000000000b1', 'crw-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25280000-0000-0000-0000-0000000000a1', '25280000-0000-0000-0000-00000000000a', 'CRW Admin', 'crw-admin@example.com', 'Admin', 'active'),
  ('25280000-0000-0000-0000-0000000000a3', '25280000-0000-0000-0000-00000000000a', 'CRW PM',    'crw-pm@example.com',    'Project Manager', 'active'),
  ('25280000-0000-0000-0000-0000000000a4', '25280000-0000-0000-0000-00000000000a', 'CRW Eng',   'crw-eng@example.com',   'Engineer', 'active'),
  ('25280000-0000-0000-0000-0000000000b1', '25280000-0000-0000-0000-00000000000b', 'CRW XOrg',  'crw-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25280000-0000-0000-0000-0000000000d1', '25280000-0000-0000-0000-00000000000a', 'CRW Site', 'Ongoing Project', '25280000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25280000-0000-0000-0000-000000000401', '25280000-0000-0000-0000-00000000000a', '25280000-0000-0000-0000-0000000000d1', 'CRW WO one', 'Issued', 1000, 'exclusive', 0),
  ('25280000-0000-0000-0000-000000000402', '25280000-0000-0000-0000-00000000000a', '25280000-0000-0000-0000-0000000000d1', 'CRW WO two', 'Issued', 1000, 'exclusive', 0);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('25280000-0000-0000-0000-0000000000a3');

-- AC-CRW-001
insert into crews (id, code, name, field_controller_id) values
  ('25280000-0000-0000-0000-000000000c01', 'CR-1', 'Crew one', '25280000-0000-0000-0000-0000000000a4'),
  ('25280000-0000-0000-0000-000000000c02', 'CR-2', 'Crew two', null);
select is((select org_id from crews where id = '25280000-0000-0000-0000-000000000c01'), '25280000-0000-0000-0000-00000000000a'::uuid,
  'AC-CRW-001 a crew is stamped with the creator''s organisation');
select throws_ok($$ insert into crews (code, name) values (' cr-1 ', 'Duplicate') $$, '23505', null,
  'AC-CRW-001 a duplicate live crew code is refused (case and spaces ignored)');
insert into crews (id, code, name) values ('25280000-0000-0000-0000-000000000c09', 'CR-9', 'Crew to archive');
update crews set archived_at = now() where id = '25280000-0000-0000-0000-000000000c09';
select lives_ok($$ insert into crews (code, name) values ('CR-9', 'Code reused') $$,
  'AC-CRW-001 an archived crew frees its code');
select throws_ok($$ insert into crews (code, name, kind) values ('CR-V', 'Vendor crew', 'vendor') $$, '23514', null,
  'AC-CRW-001 a vendor crew names its vendor company');
insert into crew_standard_roles (id, crew_id, name, headcount, sort_order) values
  ('25280000-0000-0000-0000-000000000e01', '25280000-0000-0000-0000-000000000c01', 'Foreman', 1, 0),
  ('25280000-0000-0000-0000-000000000e02', '25280000-0000-0000-0000-000000000c01', 'Welder',  3, 1);
select throws_ok($$ insert into crew_standard_roles (crew_id, name, headcount) values ('25280000-0000-0000-0000-000000000c01', 'welder', 2) $$,
  '23505', null, 'AC-CRW-001 a crew lists each standard role once');

select lives_ok($$ select public.create_crew_with_roles(
  '{"code":"ATOMIC-OK","name":"Atomic crew","kind":"own"}'::jsonb,
  '[{"name":"Foreman","headcount":1},{"name":"Welder","headcount":3}]'::jsonb) $$,
  'AC-CRW-001 crew and standard roles are created together');
select is((select jsonb_agg(jsonb_build_object('name', r.name, 'headcount', r.headcount) order by r.sort_order)
  from crew_standard_roles r join crews c on c.id = r.crew_id where c.code = 'ATOMIC-OK'),
  '[{"name":"Foreman","headcount":1},{"name":"Welder","headcount":3}]'::jsonb,
  'AC-CRW-001 created roles retain their names, headcounts and order');

-- A bad role rolls back the crew as well, so retry remains possible.
select throws_ok($$ select public.create_crew_with_roles(
  '{"code":"ATOMIC-FAIL","name":"Atomic","kind":"own"}'::jsonb,
  '[{"name":"Invalid","headcount":0}]'::jsonb) $$,
  '23514', null, 'AC-CRW-001 a refused role rejects the crew creation');
select is((select count(*)::int from crews where code = 'ATOMIC-FAIL'), 0,
  'AC-CRW-001 refused roles leave no partial crew');

select lives_ok($$ select public.place_new_crew_worker(
  '{"kind":"vendor","name":"Placed person"}'::jsonb,
  '{"crew_id":"25280000-0000-0000-0000-000000000c02","valid_from":"2026-11-01"}'::jsonb) $$,
  'AC-CRW-002 a new person and placement are created together');
select is((select count(*)::int from people p join crew_members m on m.worker_id = p.id
  where p.name = 'Placed person' and m.crew_id = '25280000-0000-0000-0000-000000000c02'), 1,
  'AC-CRW-002 the new workforce person has the requested crew placement');

select throws_ok($$ select public.place_new_crew_worker(
  '{"kind":"vendor","name":"Atomic placement person"}'::jsonb,
  '{"crew_id":"25280000-0000-0000-0000-000000000c01","valid_from":"2026-11-10","valid_to":"2026-11-01"}'::jsonb) $$,
  '23514', null, 'AC-CRW-002 an invalid placement is rejected');
select is((select count(*)::int from people where name = 'Atomic placement person'), 0,
  'AC-CRW-002 a rejected placement leaves no person behind');

-- AC-CRW-002
insert into people (id, kind, name, profile_id) values
  ('25280000-0000-0000-0000-000000000f01', 'own',    'Worker One', '25280000-0000-0000-0000-0000000000a4'),
  ('25280000-0000-0000-0000-000000000f02', 'vendor', 'Worker Two', null),
  ('25280000-0000-0000-0000-000000000f03', 'vendor', 'Worker Three', null);
select throws_ok($$ insert into people (kind, name, profile_id) values ('vendor', 'Login vendor', '25280000-0000-0000-0000-0000000000a3') $$,
  '23514', null, 'AC-CRW-002 a vendor worker is not given a login');
insert into crew_members (crew_id, worker_id, standard_role_id, valid_from, valid_to) values
  ('25280000-0000-0000-0000-000000000c01', '25280000-0000-0000-0000-000000000f01', '25280000-0000-0000-0000-000000000e01', '2026-11-01', '2026-11-15'),
  ('25280000-0000-0000-0000-000000000c01', '25280000-0000-0000-0000-000000000f02', '25280000-0000-0000-0000-000000000e02', '2026-11-01', null);
-- A PM cannot hard-delete roles, and even an Admin cannot delete a role used by a placement.
insert into crew_standard_roles (id, crew_id, name, headcount) values
  ('25280000-0000-0000-0000-000000000e03', '25280000-0000-0000-0000-000000000c01', 'Spare', 1);
select is_empty($$ delete from crew_standard_roles where id = '25280000-0000-0000-0000-000000000e03' returning id $$,
  'AC-CRW-014 Project Manager cannot hard-delete a standard role');
select pg_temp.act_as('25280000-0000-0000-0000-0000000000a1');
delete from crew_standard_roles where id = '25280000-0000-0000-0000-000000000e03';
select throws_ok($$ delete from crew_standard_roles where id = '25280000-0000-0000-0000-000000000e01' $$,
  '23503', null, 'AC-CRW-014 even Admin cannot delete a role used by a placement');
select pg_temp.act_as('25280000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into crew_members (crew_id, worker_id, valid_from, valid_to)
                    values ('25280000-0000-0000-0000-000000000c02', '25280000-0000-0000-0000-000000000f01', '2026-11-10', '2026-11-20') $$,
  '23P01', null, 'AC-CRW-002 a person in crew A from 1 to 15 cannot be placed in crew B on the 10th');
select lives_ok($$ insert into crew_members (crew_id, worker_id, valid_from)
                   values ('25280000-0000-0000-0000-000000000c02', '25280000-0000-0000-0000-000000000f01', '2026-11-16') $$,
  'AC-CRW-002 placed in crew B from the 16th it is accepted');
select throws_ok($$ insert into crew_members (crew_id, worker_id, standard_role_id, valid_from)
                    values ('25280000-0000-0000-0000-000000000c02', '25280000-0000-0000-0000-000000000f03', '25280000-0000-0000-0000-000000000e01', '2026-11-01') $$,
  '23514', 'CRW_REF: the role is not one of this crew''s standard roles', 'AC-CRW-002 a placement names a role of its own crew');
-- FR-CRW-005: a correction bumps the version and is audited.
update crew_members set valid_to = '2026-11-14' where worker_id = '25280000-0000-0000-0000-000000000f01' and valid_from = '2026-11-01';
select is((select version from crew_members where worker_id = '25280000-0000-0000-0000-000000000f01' and valid_from = '2026-11-01'), 2,
  'AC-CRW-002 a placement correction bumps its version');
reset role;
select is((select count(*)::int from audit_events where action = 'crew_members.correct' and org_id = '25280000-0000-0000-0000-00000000000a'), 1,
  'AC-CRW-002 a placement correction is audited');
set local role authenticated;
select pg_temp.act_as('25280000-0000-0000-0000-0000000000a3');

-- AC-CRW-003
insert into work_order_crews (work_order_id, crew_id, valid_from, valid_to) values
  ('25280000-0000-0000-0000-000000000401', '25280000-0000-0000-0000-000000000c01', '2026-11-01', '2026-11-10');
select throws_ok($$ insert into work_order_crews (work_order_id, crew_id, valid_from, valid_to)
                    values ('25280000-0000-0000-0000-000000000402', '25280000-0000-0000-0000-000000000c01', '2026-11-05', '2026-11-05') $$,
  '23P01', null, 'AC-CRW-003 a crew rostered on W from 1 to 10 cannot also serve W2 on the 5th');
select lives_ok($$ insert into work_order_crews (work_order_id, crew_id, valid_from)
                   values ('25280000-0000-0000-0000-000000000402', '25280000-0000-0000-0000-000000000c01', '2026-11-11') $$,
  'AC-CRW-003 from the 11th it may serve W2');
-- FR-CRW-002: a crew with open members or roster cannot be archived.
select throws_ok($$ update crews set archived_at = now() where id = '25280000-0000-0000-0000-000000000c01' $$,
  '23514', 'CRW_ARCHIVE_IN_USE: end this crew''s current and future members and roster placements first',
  'AC-CRW-001 a crew still in use cannot be archived');

-- AC-CRW-004
select is((select count(*)::int from work_order_roster('25280000-0000-0000-0000-000000000401', '2026-11-05')), 1,
  'AC-CRW-004 the roster of W on the 5th lists its one crew');
select is((select jsonb_array_length(members) from work_order_roster('25280000-0000-0000-0000-000000000401', '2026-11-05')), 2,
  'AC-CRW-004 the roster lists the crew''s two members that day');
select is((select roles from work_order_roster('25280000-0000-0000-0000-000000000401', '2026-11-05')),
  '[{"name": "Foreman", "placed": 1, "headcount": 1, "shortfall": 0, "standard_role_id": "25280000-0000-0000-0000-000000000e01"},
    {"name": "Welder", "placed": 1, "headcount": 3, "shortfall": 2, "standard_role_id": "25280000-0000-0000-0000-000000000e02"}]'::jsonb,
  'AC-CRW-004 each standard role shows headcount against placed');
select is((select shortfall from work_order_roster('25280000-0000-0000-0000-000000000401', '2026-11-05')), 2,
  'AC-CRW-004 the crew is flagged two short');
select is((select count(*)::int from work_order_roster('25280000-0000-0000-0000-000000000401', '2026-11-12')), 0,
  'AC-CRW-004 after the roster ends the crew no longer shows on W');

-- AC-CRW-014: an Engineer reads but cannot manage.
select pg_temp.act_as('25280000-0000-0000-0000-0000000000a4');
select is((select jsonb_array_length(members) from work_order_roster('25280000-0000-0000-0000-000000000401', '2026-11-05')), 2,
  'AC-CRW-004 an Engineer sees roster members through the basic directory');
select is((select bool_and(not (member ? 'has_login') and not (member ? 'kind'))
  from work_order_roster('25280000-0000-0000-0000-000000000401', '2026-11-05') r,
       jsonb_array_elements(r.members) as m(member)), true,
  'AC-CRW-014 the member roster does not expose private workforce fields');
select is((select count(*)::int from crews where org_id = '25280000-0000-0000-0000-00000000000a'), 5,
  'AC-CRW-014 an Engineer of the organisation reads the crew master');
select throws_ok($$ insert into crews (code, name) values ('CR-E', 'Engineer crew') $$, '42501', null,
  'AC-CRW-014 an Engineer cannot create a crew');
select is_empty($$ update work_order_crews set valid_to = '2026-11-02' returning id $$,
  'AC-CRW-014 an Engineer cannot change the roster');

-- AC-CRW-014: another organisation reads nothing and cannot point at our rows.
select pg_temp.act_as('25280000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from crews) + (select count(*)::int from crew_members) + (select count(*)::int from work_order_crews)
          + (select count(*)::int from work_order_roster('25280000-0000-0000-0000-000000000401', '2026-11-05')), 0,
  'AC-CRW-014 another organisation reads no crews, members or roster');
select throws_ok($$ insert into work_order_crews (work_order_id, crew_id, valid_from)
                    values ('25280000-0000-0000-0000-000000000401', '25280000-0000-0000-0000-000000000c02', '2026-12-01') $$,
  '23514', 'CRW_REF: the crew is not a live crew of this organisation',
  'AC-CRW-014 another organisation cannot roster our crew on our work order');

select * from finish();
rollback;
