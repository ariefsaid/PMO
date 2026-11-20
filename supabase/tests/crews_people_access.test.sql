-- Workforce register access for crews: basic reads for active members, Admin/PM writes, tenant isolation.
begin;
create extension if not exists pgtap;
select plan(16);
insert into organizations (id, name, default_currency) values
 ('25280000-0000-0000-0000-00000000030a', 'People A', 'IDR'),
 ('25280000-0000-0000-0000-00000000030b', 'People B', 'IDR');
insert into auth.users (id, email) values
 ('25280000-0000-0000-0000-0000000003a1', 'people-a1@example.invalid'),
 ('25280000-0000-0000-0000-0000000003a2', 'people-a2@example.invalid'),
 ('25280000-0000-0000-0000-0000000003a3', 'people-a3@example.invalid'),
 ('25280000-0000-0000-0000-0000000003a4', 'people-a4@example.invalid'),
 ('25280000-0000-0000-0000-0000000003b1', 'people-b1@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('25280000-0000-0000-0000-0000000003a1','25280000-0000-0000-0000-00000000030a','Admin','people-a1@example.invalid','Admin','active'),
 ('25280000-0000-0000-0000-0000000003a2','25280000-0000-0000-0000-00000000030a','PM','people-a2@example.invalid','Project Manager','active'),
 ('25280000-0000-0000-0000-0000000003a3','25280000-0000-0000-0000-00000000030a','Engineer','people-a3@example.invalid','Engineer','active'),
 ('25280000-0000-0000-0000-0000000003a4','25280000-0000-0000-0000-00000000030a','Disabled','people-a4@example.invalid','Engineer','disabled'),
 ('25280000-0000-0000-0000-0000000003b1','25280000-0000-0000-0000-00000000030b','Other','people-b1@example.invalid','Admin','active');
insert into people (org_id, code, name, job_title, id_reference, profile_id, manager_id) values
 ('25280000-0000-0000-0000-00000000030a', 'A-person', 'Person A', 'Welder', 'private-id', '25280000-0000-0000-0000-0000000003a2', '25280000-0000-0000-0000-0000000003a1'),
 ('25280000-0000-0000-0000-00000000030b', 'B-person', 'Person B', 'Operator', null, null, null);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25280000-0000-0000-0000-0000000003a3","role":"authenticated"}', true);
select is((select count(*)::int from people_directory where code = 'A-person'), 1, 'Engineer reads same-org basic person');
select is((select job_title from people_directory where code = 'A-person'), 'Welder', 'Engineer reads basic job title');
select is((select count(*)::int from people_directory where code = 'B-person'), 0, 'Engineer cannot read another org');
select is((select (count(id_reference) + count(profile_id) + count(manager_id))::int from people where code = 'A-person'), 0, 'Engineer cannot read unrelated private person details');
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a
  where a.attrelid = 'public.people_directory'::regclass and a.attnum > 0 and not a.attisdropped),
  array['archived_at','code','id','job_title','name']::text[], 'Directory exposes only basic fields');
select throws_ok($$insert into people (code, name) values ('bad', 'Bad')$$, '42501', null, 'Engineer cannot create people');
select is_empty($$update people set name = 'Bad' where code = 'A-person' returning id$$, 'Engineer cannot edit people');
select set_config('request.jwt.claims', '{"sub":"25280000-0000-0000-0000-0000000003a2","role":"authenticated"}', true);
select is((select id_reference from people where code = 'A-person'), 'private-id', 'Project Manager retains private person access');
select lives_ok($$insert into people (code, name) values ('pm-person', 'PM Person')$$, 'Project Manager creates person');
select lives_ok($$update people set name = 'Updated' where code = 'A-person'$$, 'Project Manager may edit person');
select is((select name from people where code = 'A-person'), 'Updated', 'Project Manager edit persists');
select set_config('request.jwt.claims', '{"sub":"25280000-0000-0000-0000-0000000003b1","role":"authenticated"}', true);
select is((select count(*)::int from people_directory where code = 'A-person'), 0, 'Other-org Admin cannot read person');
select is_empty($$update people set name = 'Bad' where code = 'A-person' returning id$$, 'Other-org Admin cannot edit person');
select set_config('request.jwt.claims', '{"sub":"25280000-0000-0000-0000-0000000003a1","role":"authenticated"}', true);
select lives_ok($$insert into people (code, name) values ('admin-person', 'Admin Person')$$, 'Admin creates person');
select set_config('request.jwt.claims', '{"sub":"25280000-0000-0000-0000-0000000003a4","role":"authenticated"}', true);
select is((select count(*)::int from people_directory), 0, 'Inactive member cannot read the directory');
reset role;
select is(has_table_privilege('anon', 'public.people_directory', 'select'), false, 'Anonymous cannot read the directory');
select * from finish();
rollback;
