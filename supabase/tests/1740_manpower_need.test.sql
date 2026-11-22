-- 1740_manpower_need.test.sql — manpower need (docs/specs/manpower-request.spec.md). Migrations 1740, 1741.
-- AC-MPN-001..007. Mutation markers (`mut:`) in 1740/1741 name the rules the spec's mutation check breaks.
begin;
create extension if not exists pgtap;
select plan(44);

insert into organizations (id, name, default_currency) values
  ('17400000-0000-0000-0000-00000000000a', 'MPN Org',       'IDR'),
  ('17400000-0000-0000-0000-00000000000b', 'MPN Other Org', 'IDR');
insert into auth.users (id, email) values
  ('17400000-0000-0000-0000-0000000000a1', 'mpn-admin@example.com'),
  ('17400000-0000-0000-0000-0000000000a2', 'mpn-pm@example.com'),
  ('17400000-0000-0000-0000-0000000000a3', 'mpn-exec@example.com'),
  ('17400000-0000-0000-0000-0000000000a4', 'mpn-eng@example.com'),
  ('17400000-0000-0000-0000-0000000000a5', 'mpn-hr@example.com'),
  ('17400000-0000-0000-0000-0000000000a6', 'mpn-fin@example.com'),
  ('17400000-0000-0000-0000-0000000000a7', 'mpn-susp@example.com'),
  ('17400000-0000-0000-0000-0000000000b1', 'mpn-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17400000-0000-0000-0000-0000000000a1', '17400000-0000-0000-0000-00000000000a', 'MPN Admin', 'mpn-admin@example.com', 'Admin', 'active'),
  ('17400000-0000-0000-0000-0000000000a2', '17400000-0000-0000-0000-00000000000a', 'MPN PM',    'mpn-pm@example.com',    'Project Manager', 'active'),
  ('17400000-0000-0000-0000-0000000000a3', '17400000-0000-0000-0000-00000000000a', 'MPN Exec',  'mpn-exec@example.com',  'Executive', 'active'),
  ('17400000-0000-0000-0000-0000000000a4', '17400000-0000-0000-0000-00000000000a', 'MPN Eng',   'mpn-eng@example.com',   'Engineer', 'active'),
  ('17400000-0000-0000-0000-0000000000a5', '17400000-0000-0000-0000-00000000000a', 'MPN HR',    'mpn-hr@example.com',    'Engineer', 'active'),
  ('17400000-0000-0000-0000-0000000000a6', '17400000-0000-0000-0000-00000000000a', 'MPN Fin',   'mpn-fin@example.com',   'Finance', 'active'),
  ('17400000-0000-0000-0000-0000000000a7', '17400000-0000-0000-0000-00000000000a', 'MPN Susp',  'mpn-susp@example.com',  'Project Manager', 'disabled'),
  ('17400000-0000-0000-0000-0000000000b1', '17400000-0000-0000-0000-00000000000b', 'MPN XOrg',  'mpn-xorg@example.com',  'Admin', 'active');
-- An Engineer at the base level whose built-in role is HR (carries the HR capability).
update organizations set built_in_roles_enabled = true where id = '17400000-0000-0000-0000-00000000000a';
update profiles set built_in_role = 'hr_officer' where id = '17400000-0000-0000-0000-0000000000a5';
insert into projects (id, org_id, name, status, project_manager_id) values
  ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-00000000000a', 'MPN Site',  'Ongoing Project', '17400000-0000-0000-0000-0000000000a2'),
  ('17400000-0000-0000-0000-0000000000d2', '17400000-0000-0000-0000-00000000000a', 'MPN Other', 'Ongoing Project', '17400000-0000-0000-0000-0000000000a2');
insert into projects (id, org_id, name, status, archived_at) values
  ('17400000-0000-0000-0000-0000000000d3', '17400000-0000-0000-0000-00000000000a', 'MPN Archived', 'Ongoing Project', now());
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('17400000-0000-0000-0000-000000000401', '17400000-0000-0000-0000-00000000000a', '17400000-0000-0000-0000-0000000000d1', 'MPN WO site',  'Issued', 1000, 'exclusive', 0),
  ('17400000-0000-0000-0000-000000000402', '17400000-0000-0000-0000-00000000000a', '17400000-0000-0000-0000-0000000000d2', 'MPN WO other', 'Issued', 1000, 'exclusive', 0);
insert into cost_disciplines (id, org_id, code, name, archived_at) values
  ('17400000-0000-0000-0000-000000000e01', '17400000-0000-0000-0000-00000000000a', 'WLD', 'Welder', null),
  ('17400000-0000-0000-0000-000000000e03', '17400000-0000-0000-0000-00000000000a', 'OLD', 'Retired position', now()),
  ('17400000-0000-0000-0000-000000000e0f', '17400000-0000-0000-0000-00000000000b', 'FOR', 'Foreign position', null);
insert into crews (id, org_id, code, name) values
  ('17400000-0000-0000-0000-000000000c01', '17400000-0000-0000-0000-00000000000a', 'MPN-C1', 'MPN crew'),
  ('17400000-0000-0000-0000-000000000c0f', '17400000-0000-0000-0000-00000000000b', 'MPN-CF', 'Foreign crew');
insert into people (id, org_id, name) values
  ('17400000-0000-0000-0000-000000000f01', '17400000-0000-0000-0000-00000000000a', 'Worker One'),
  ('17400000-0000-0000-0000-000000000f02', '17400000-0000-0000-0000-00000000000a', 'Worker Two'),
  ('17400000-0000-0000-0000-000000000f03', '17400000-0000-0000-0000-00000000000a', 'Worker Three'),
  ('17400000-0000-0000-0000-000000000f04', '17400000-0000-0000-0000-00000000000a', 'Worker Four'),
  ('17400000-0000-0000-0000-000000000f05', '17400000-0000-0000-0000-00000000000b', 'Foreign Worker');
insert into people (id, org_id, name, archived_at) values
  ('17400000-0000-0000-0000-000000000f06', '17400000-0000-0000-0000-00000000000a', 'Archived Worker', now());
-- One required checklist item (the existing cleared-for-site checklist, 1235/1236).
insert into clearance_items (id, org_id, name, is_required) values
  ('17400000-0000-0000-0000-000000000b01', '17400000-0000-0000-0000-00000000000a', 'MPN item', true);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

set local role authenticated;
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a2');   -- Project Manager

-- AC-MPN-001
insert into manpower_needs (id, project_id, discipline_id, headcount, needed_by, work_order_id, crew_id, note) values
  ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e01', 3,
   current_date + 14, '17400000-0000-0000-0000-000000000401', '17400000-0000-0000-0000-000000000c01', 'shutdown');
insert into manpower_needs (id, project_id, discipline_id, headcount, needed_by) values
  ('17400000-0000-0000-0000-000000000a02', '17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e01', 2, current_date + 30);
select is((select status from manpower_needs where id = '17400000-0000-0000-0000-000000000a01'), 'open', 'AC-MPN-001 a new need is open');
select is((select org_id from manpower_needs where id = '17400000-0000-0000-0000-000000000a01'), '17400000-0000-0000-0000-00000000000a'::uuid, 'AC-MPN-001 org is stamped, never sent');
select is((select created_by from manpower_needs where id = '17400000-0000-0000-0000-000000000a01'), '17400000-0000-0000-0000-0000000000a2'::uuid, 'AC-MPN-001 the creator is recorded');

-- AC-MPN-002
select throws_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by) values ('17400000-0000-0000-0000-0000000000d3', '17400000-0000-0000-0000-000000000e01', 1, current_date) $$, '23514', 'MPN_PROJECT: pick a live project of your organisation', 'AC-MPN-002 an archived project is refused');
select throws_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by) values ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e03', 1, current_date) $$, '23514', 'MPN_POSITION: pick a position from your organisation''s list', 'AC-MPN-002 an archived position is refused');
select throws_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by) values ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e0f', 1, current_date) $$, '23514', 'MPN_POSITION: pick a position from your organisation''s list', 'AC-MPN-002 a foreign position is refused');
select throws_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by, work_order_id) values ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e01', 1, current_date, '17400000-0000-0000-0000-000000000402') $$, '23514', 'MPN_WORK_ORDER: the work order must belong to the same project', 'AC-MPN-002 a work order of another project is refused');
select throws_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by, crew_id) values ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e01', 1, current_date, '17400000-0000-0000-0000-000000000c0f') $$, '23514', 'MPN_CREW: pick a live crew of your organisation', 'AC-MPN-002 a foreign crew is refused');
select throws_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by) values ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e01', 501, current_date) $$, '23514', null, 'AC-MPN-002 a head count over 500 is refused');

-- AC-MPN-003 linking
insert into manpower_need_people (need_id, person_id) values
  ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-000000000f01'),
  ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-000000000f02');
select throws_ok($$ insert into manpower_need_people (need_id, person_id) values ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-000000000f01') $$, '23505', 'MPN_DUPLICATE: this person is already linked to this need', 'AC-MPN-003 the same person twice is refused');
select throws_ok($$ insert into manpower_need_people (need_id, person_id) values ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-000000000f06') $$, '23514', 'MPN_PERSON: pick a person from the register who is not archived', 'AC-MPN-003 an archived person is refused');
select throws_ok($$ insert into manpower_need_people (need_id, person_id) values ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-000000000f05') $$, '23514', 'MPN_PERSON: pick a person from the register who is not archived', 'AC-MPN-003 a foreign person is refused');
insert into manpower_need_people (need_id, person_id) values ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-000000000f03');
select throws_ok($$ insert into manpower_need_people (need_id, person_id) values ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-000000000f04') $$, '23514', 'MPN_FULL: this need already has all the people it asked for', 'AC-MPN-003 a fourth person on a need of three is refused');

-- AC-MPN-004 progress reuses the checklist: nobody cleared yet -> 3 linked, all in progress, none open
select is((select (filled, in_progress, open_count) from manpower_need_progress() where need_id = '17400000-0000-0000-0000-000000000a01')::text, '(0,3,0)', 'AC-MPN-004 linked people who are not cleared are in progress, not filled');
-- AC-MPN-011 the writer is pointed at the need that still has places to fill (a01 is full of links, a02 is empty)
select is((select count(*)::int from public.my_manpower_to_fill()), 1, 'AC-MPN-011 a writer sees the one open need with places to fill');
select is((select open_count from public.my_manpower_to_fill()), 2, 'AC-MPN-011 the pointer carries the open places');
reset role;
insert into person_clearances (org_id, person_id, item_id, done_on) values
  ('17400000-0000-0000-0000-00000000000a', '17400000-0000-0000-0000-000000000f01', '17400000-0000-0000-0000-000000000b01', current_date - 1);
set local role authenticated;
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a2');
select is((select (asked, filled, in_progress, open_count) from manpower_need_progress() where need_id = '17400000-0000-0000-0000-000000000a01')::text, '(3,1,2,0)', 'AC-MPN-004 one cleared person: asked 3, filled 1, in progress 2');
-- AC-MPN-004 the people team sees the counts although it cannot read the clearances (counts only)
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a5');
select is((select (filled, in_progress) from manpower_need_progress() where need_id = '17400000-0000-0000-0000-000000000a01')::text, '(1,2)', 'AC-MPN-004 an HR officer sees filled 1, in progress 2 for the need they fill');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a7');
select is((select count(*)::int from manpower_need_progress()), 0, 'AC-MPN-004 a disabled member of the organisation gets no progress row');
reset role;
update person_clearances set expires_on = current_date - 1, done_on = current_date - 5 where person_id = '17400000-0000-0000-0000-000000000f01';
set local role authenticated;
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a2');
select is((select filled from manpower_need_progress() where need_id = '17400000-0000-0000-0000-000000000a01'), 0, 'AC-MPN-004 an expired clearance is no longer filled');

-- AC-MPN-007 unlink frees a place and the person can come back
delete from manpower_need_people where need_id = '17400000-0000-0000-0000-000000000a01' and person_id = '17400000-0000-0000-0000-000000000f03';
select is((select (linked, open_count) from manpower_need_progress() where need_id = '17400000-0000-0000-0000-000000000a01')::text, '(2,1)', 'AC-MPN-007 unlinking raises open by one');
select lives_ok($$ insert into manpower_need_people (need_id, person_id) values ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-000000000f03') $$, 'AC-MPN-007 the person can be linked again');

-- AC-MPN-005 head count, status
select throws_ok($$ update manpower_needs set headcount = 2 where id = '17400000-0000-0000-0000-000000000a01' $$, '23514', 'MPN_HEADCOUNT: the head count cannot be lower than the people already linked', 'AC-MPN-005 the head count cannot drop below the linked people');
select lives_ok($$ update manpower_needs set headcount = 4 where id = '17400000-0000-0000-0000-000000000a01' $$, 'AC-MPN-005 the head count can rise');
update manpower_needs set status = 'met' where id = '17400000-0000-0000-0000-000000000a01';
select throws_ok($$ insert into manpower_need_people (need_id, person_id) values ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-000000000f04') $$, '23514', 'MPN_CLOSED: people can be linked only while the need is open', 'AC-MPN-003 a met need takes no more people');
select lives_ok($$ update manpower_needs set status = 'open' where id = '17400000-0000-0000-0000-000000000a01' $$, 'AC-MPN-005 a need can be reopened');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from public.my_manpower_to_fill()), 0, 'AC-MPN-011 an Engineer without an HR role is not pointed at needs to fill');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.my_manpower_to_fill()), 2, 'AC-MPN-011 an HR officer is pointed at both open needs');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a2');
select throws_ok($$ delete from manpower_needs where id = '17400000-0000-0000-0000-000000000a01' $$, '42501', null, 'AC-MPN-005 a need is never deleted');

-- AC-MPN-006 who writes
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by) values ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e01', 1, current_date) $$, 'AC-MPN-006 an Admin writes');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a3');
select lives_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by) values ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e01', 1, current_date) $$, 'AC-MPN-006 an Executive writes (crew authority)');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a5');
select lives_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by) values ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e01', 1, current_date) $$, 'AC-MPN-006 an HR officer writes through the HR capability');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a4');
select throws_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by) values ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e01', 1, current_date) $$, '42501', null, 'AC-MPN-001 an Engineer without an HR role cannot create');
select is((select count(*)::int from manpower_needs), 5, 'AC-MPN-001 an Engineer reads the needs');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a6');
select throws_ok($$ insert into manpower_need_people (need_id, person_id) values ('17400000-0000-0000-0000-000000000a01', '17400000-0000-0000-0000-000000000f04') $$, '42501', null, 'AC-MPN-001 Finance cannot link people');
select is((select count(*)::int from manpower_needs), 5, 'AC-MPN-001 Finance reads the needs');
select is((select count(*)::int from public.my_manpower_to_fill()), 0, 'AC-MPN-011 Finance is not pointed at needs to fill');

-- AC-MPN-011 a need that is met or cancelled leaves the list; AC-MPN-010 its creator hears it once, never from their own action
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a2');
update manpower_needs set status = 'met' where id = '17400000-0000-0000-0000-000000000a01';
select is((select count(*)::int from notifications where owner_id = '17400000-0000-0000-0000-0000000000a2' and title = 'Manpower need met'), 0, 'AC-MPN-010 the creator is not told about their own action');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.my_manpower_to_fill()), 1, 'AC-MPN-011 a met need leaves the list');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a1');
update manpower_needs set status = 'cancelled' where id = '17400000-0000-0000-0000-000000000a02';
update manpower_needs set note = 'edited' where id = '17400000-0000-0000-0000-000000000a02';
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.my_manpower_to_fill()), 0, 'AC-MPN-011 a cancelled need leaves the list');
select pg_temp.act_as('17400000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from notifications where owner_id = '17400000-0000-0000-0000-0000000000a2' and title = 'Manpower need cancelled'), 1, 'AC-MPN-010 the creator is told once when another person cancels (a later edit adds no notice)');

-- another organisation sees and writes nothing
select pg_temp.act_as('17400000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from manpower_needs), 0, 'AC-MPN-001 another organisation reads no needs');
select is((select count(*)::int from manpower_need_progress()), 0, 'AC-MPN-004 another organisation gets no progress rows');
select throws_ok($$ insert into manpower_needs (project_id, discipline_id, headcount, needed_by) values ('17400000-0000-0000-0000-0000000000d1', '17400000-0000-0000-0000-000000000e01', 1, current_date) $$, '23514', null, 'AC-MPN-002 another organisation cannot raise a need on our project');

select * from finish();
rollback;
