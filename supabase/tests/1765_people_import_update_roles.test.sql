-- 1765_people_import_update_roles.test.sql — people-import-update: proof of the EXISTING rules the people import relies on (no migration).
-- Under test: people_update (1035) and the column grants: Admin and Project Manager (an HR Manager sits at that level) may change a person's
-- name, job title and manager; Finance, Executive and Engineer (an HR Officer sits at that level) change nothing.
-- MUTATION NOTES: add 'Finance' to the people_update role list -> 'PIU-ROLE Finance changes nothing' goes red; drop manager_id from the update grant -> the Admin assertion goes red.
begin;
create extension if not exists pgtap;
select plan(7);

insert into organizations (id, name, default_currency, default_timezone) values ('17650000-0000-0000-0000-00000000000a', 'PIU Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('17650000-0000-0000-0000-0000000000a1', 'piu-admin@example.com'), ('17650000-0000-0000-0000-0000000000a2', 'piu-pm@example.com'),
  ('17650000-0000-0000-0000-0000000000a3', 'piu-fin@example.com'), ('17650000-0000-0000-0000-0000000000a4', 'piu-eng@example.com'),
  ('17650000-0000-0000-0000-0000000000a5', 'piu-exe@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17650000-0000-0000-0000-0000000000a1', '17650000-0000-0000-0000-00000000000a', 'PIU Admin', 'piu-admin@example.com', 'Admin', 'active'),
  ('17650000-0000-0000-0000-0000000000a2', '17650000-0000-0000-0000-00000000000a', 'PIU PM', 'piu-pm@example.com', 'Project Manager', 'active'),
  ('17650000-0000-0000-0000-0000000000a3', '17650000-0000-0000-0000-00000000000a', 'PIU Finance', 'piu-fin@example.com', 'Finance', 'active'),
  ('17650000-0000-0000-0000-0000000000a4', '17650000-0000-0000-0000-00000000000a', 'PIU Engineer', 'piu-eng@example.com', 'Engineer', 'active'),
  ('17650000-0000-0000-0000-0000000000a5', '17650000-0000-0000-0000-00000000000a', 'PIU Executive', 'piu-exe@example.com', 'Executive', 'active');
insert into people (id, org_id, code, name) values ('17650000-0000-0000-0000-0000000000e1', '17650000-0000-0000-0000-00000000000a', 'PIU-1', 'PIU Ana');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- one import-style update: how many rows it reached
create or replace function pg_temp.update_as(p_uid uuid, p_name text) returns integer language plpgsql as $$
declare n integer;
begin
  perform pg_temp.act_as(p_uid);
  update public.people set name = p_name, job_title = 'Foreman', manager_id = '17650000-0000-0000-0000-0000000000a2' where code = 'PIU-1';
  get diagnostics n = row_count;
  return n;
end $$;

set local role authenticated;
select is(pg_temp.update_as('17650000-0000-0000-0000-0000000000a1', 'PIU Ana A'), 1, 'PIU-ROLE Admin may update name, job title and manager');
select is(pg_temp.update_as('17650000-0000-0000-0000-0000000000a2', 'PIU Ana B'), 1, 'PIU-ROLE Project Manager may update name, job title and manager');
select is(pg_temp.update_as('17650000-0000-0000-0000-0000000000a3', 'PIU Ana C'), 0, 'PIU-ROLE Finance changes nothing');
select is(pg_temp.update_as('17650000-0000-0000-0000-0000000000a4', 'PIU Ana D'), 0, 'PIU-ROLE Engineer changes nothing');
select is(pg_temp.update_as('17650000-0000-0000-0000-0000000000a5', 'PIU Ana E'), 0, 'PIU-ROLE Executive changes nothing');
reset role;
select is((select name from public.people where code = 'PIU-1'), 'PIU Ana B', 'PIU-ROLE the stored name is the last permitted write');
select is((select manager_id from public.people where code = 'PIU-1'), '17650000-0000-0000-0000-0000000000a2'::uuid, 'PIU-ROLE the manager link was written');
select * from finish();
rollback;
