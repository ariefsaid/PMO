-- 1765_people_import_update_roles.test.sql — people-import-update: proof of the EXISTING rules the people import relies on (no migration).
-- Under test: people_update (1035) and the column grants: Admin and Project Manager (an HR Manager sits at that level) may change a person's
-- name, job title and manager; Finance, Executive and Engineer (an HR Officer sits at that level) change nothing.
-- MUTATION NOTES: add 'Finance' to the people_update role list -> 'PIU-ROLE Finance changes nothing' goes red; drop manager_id from the update grant -> the Admin assertion goes red.
-- 1930 the manager link: only an Admin or a holder of the people-documents right sets or changes it; only an Admin names themselves.
-- MUTATION NOTES (1930): drop the right test (mut:right) -> 'PIU-MGR a Project Manager without the right cannot change' goes red;
--   drop the self test (mut:self) -> 'PIU-MGR the people team cannot name themselves' goes red;
--   drop the Admin pass (mut:admin) -> the file stops red at its first Admin manager write ('PIU-ROLE Admin may update name, job title and manager').
begin;
create extension if not exists pgtap;
select plan(17);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values ('17650000-0000-0000-0000-00000000000a', 'PIU Org', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('17650000-0000-0000-0000-0000000000a1', 'piu-admin@example.com'), ('17650000-0000-0000-0000-0000000000a2', 'piu-pm@example.com'),
  ('17650000-0000-0000-0000-0000000000a3', 'piu-fin@example.com'), ('17650000-0000-0000-0000-0000000000a4', 'piu-eng@example.com'),
  ('17650000-0000-0000-0000-0000000000a5', 'piu-exe@example.com'), ('17650000-0000-0000-0000-0000000000a6', 'piu-hr@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17650000-0000-0000-0000-0000000000a1', '17650000-0000-0000-0000-00000000000a', 'PIU Admin', 'piu-admin@example.com', 'Admin', 'active'),
  ('17650000-0000-0000-0000-0000000000a2', '17650000-0000-0000-0000-00000000000a', 'PIU PM', 'piu-pm@example.com', 'Project Manager', 'active'),
  ('17650000-0000-0000-0000-0000000000a3', '17650000-0000-0000-0000-00000000000a', 'PIU Finance', 'piu-fin@example.com', 'Finance', 'active'),
  ('17650000-0000-0000-0000-0000000000a4', '17650000-0000-0000-0000-00000000000a', 'PIU Engineer', 'piu-eng@example.com', 'Engineer', 'active'),
  ('17650000-0000-0000-0000-0000000000a5', '17650000-0000-0000-0000-00000000000a', 'PIU Executive', 'piu-exe@example.com', 'Executive', 'active');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('17650000-0000-0000-0000-0000000000a6', '17650000-0000-0000-0000-00000000000a', 'PIU HR', 'piu-hr@example.com', 'Project Manager', 'active', 'hr_manager');
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

-- ── 1930 the manager link ─────────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.set_manager_as(p_uid uuid, p_manager uuid) returns integer language plpgsql as $$
declare n integer;
begin
  perform pg_temp.act_as(p_uid);
  update public.people set manager_id = p_manager where code = 'PIU-1';
  get diagnostics n = row_count;
  return n;
end $$;
set local role authenticated;
select throws_ok($$select pg_temp.set_manager_as('17650000-0000-0000-0000-0000000000a2', '17650000-0000-0000-0000-0000000000a4')$$,
  '42501', null, 'PIU-MGR a Project Manager without the right cannot change the manager');
select throws_ok($$select pg_temp.set_manager_as('17650000-0000-0000-0000-0000000000a2', null)$$,
  '42501', null, 'PIU-MGR a Project Manager without the right cannot clear the manager either');
select lives_ok($$select pg_temp.act_as('17650000-0000-0000-0000-0000000000a2');
                  update public.people set name = 'PIU Ana F', job_title = 'Rigger' where code = 'PIU-1'$$,
  'PIU-MGR a Project Manager still edits a person when the manager stays as it is');
select throws_ok($$select pg_temp.act_as('17650000-0000-0000-0000-0000000000a2');
                   insert into public.people (code, name, manager_id) values ('PIU-2', 'PIU Budi', '17650000-0000-0000-0000-0000000000a2')$$,
  '42501', null, 'PIU-MGR a Project Manager cannot add a person with themselves as manager');
select lives_ok($$select pg_temp.act_as('17650000-0000-0000-0000-0000000000a2');
                  insert into public.people (code, name) values ('PIU-3', 'PIU Citra')$$,
  'PIU-MGR a Project Manager still adds a person with no manager');
select is(pg_temp.set_manager_as('17650000-0000-0000-0000-0000000000a6', '17650000-0000-0000-0000-0000000000a4'), 1,
  'PIU-MGR the people team (HR Manager) may set another person as manager');
select throws_ok($$select pg_temp.set_manager_as('17650000-0000-0000-0000-0000000000a6', '17650000-0000-0000-0000-0000000000a6')$$,
  '42501', null, 'PIU-MGR the people team cannot name themselves the manager');
select is(pg_temp.set_manager_as('17650000-0000-0000-0000-0000000000a1', '17650000-0000-0000-0000-0000000000a1'), 1,
  'PIU-MGR an Admin may name themselves the manager');
reset role;
select is((select manager_id from public.people where code = 'PIU-1'), '17650000-0000-0000-0000-0000000000a1'::uuid,
  'PIU-MGR the stored manager is the last permitted write');
select is((select count(*)::int from public.people where code in ('PIU-2', 'PIU-3')), 1, 'PIU-MGR only the permitted add was written');
select * from finish();
rollback;
