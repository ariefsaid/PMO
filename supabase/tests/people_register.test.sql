-- people_register.test.sql — 1008 (#2542 follow-up). Owns AC-PPL-001..004: code generation, uniqueness, write roles, second-org isolation.
begin;
create extension if not exists pgtap;
select plan(25);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25420000-0000-0000-0000-00000000000a', 'PPL Org',   'IDR', 'UTC'),
  ('25420000-0000-0000-0000-00000000000b', 'PPL Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('25420000-0000-0000-0000-0000000000a1', 'ppl-admin@example.com'),
  ('25420000-0000-0000-0000-0000000000a2', 'ppl-pm@example.com'),
  ('25420000-0000-0000-0000-0000000000a3', 'ppl-finance@example.com'),
  ('25420000-0000-0000-0000-0000000000a4', 'ppl-eng@example.com'),
  ('25420000-0000-0000-0000-0000000000b1', 'ppl-xadmin@example.com'),
  ('25420000-0000-0000-0000-0000000000b2', 'ppl-xuser@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25420000-0000-0000-0000-0000000000a1', '25420000-0000-0000-0000-00000000000a', 'PPL Admin',   'ppl-admin@example.com',   'Admin', 'active'),
  ('25420000-0000-0000-0000-0000000000a2', '25420000-0000-0000-0000-00000000000a', 'PPL PM',      'ppl-pm@example.com',      'Project Manager', 'active'),
  ('25420000-0000-0000-0000-0000000000a3', '25420000-0000-0000-0000-00000000000a', 'PPL Finance', 'ppl-finance@example.com', 'Finance', 'active'),
  ('25420000-0000-0000-0000-0000000000a4', '25420000-0000-0000-0000-00000000000a', 'PPL Eng',     'ppl-eng@example.com',     'Engineer', 'active'),
  ('25420000-0000-0000-0000-0000000000b1', '25420000-0000-0000-0000-00000000000b', 'PPL XAdmin',  'ppl-xadmin@example.com',  'Admin', 'active'),
  ('25420000-0000-0000-0000-0000000000b2', '25420000-0000-0000-0000-00000000000b', 'PPL XUser',   'ppl-xuser@example.com',   'Engineer', 'active');
-- second-org probe row, as owner
insert into people (id, org_id, code, name) values
  ('25420000-0000-0000-0000-0000000000e9', '25420000-0000-0000-0000-00000000000b', 'P-0007', 'Foreign Person');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- The fixture supplies stable IDs for later assertions; this grant is rolled back with the test.
grant insert (id) on public.people to authenticated;

set local role authenticated;
select pg_temp.act_as('25420000-0000-0000-0000-0000000000a1');

-- AC-PPL-001 generated codes, per org, in sequence
insert into people (id, name) values ('25420000-0000-0000-0000-0000000000e1', 'Person One');
insert into people (id, name, code) values ('25420000-0000-0000-0000-0000000000e2', 'Person Two', '   ');
select is((select code from people where id = '25420000-0000-0000-0000-0000000000e1'), 'P-0001', 'AC-PPL-001 first blank code is P-0001');
select is((select code from people where id = '25420000-0000-0000-0000-0000000000e2'), 'P-0002', 'AC-PPL-001 a whitespace code counts as blank and gets P-0002');
select is((select org_id from people where id = '25420000-0000-0000-0000-0000000000e1'), '25420000-0000-0000-0000-00000000000a'::uuid, 'AC-PPL-001 org_id is stamped from the caller');

-- AC-PPL-002 typed codes kept; generator continues after the highest; duplicates refused; archived codes reusable; never reused by generator
insert into people (id, name, code, job_title) values ('25420000-0000-0000-0000-0000000000e3', 'Person Three', 'P-0010', 'Welder');
select is((select job_title from people where id = '25420000-0000-0000-0000-0000000000e3'), 'Welder', 'AC-PPL-002 job title is stored');
insert into people (id, name) values ('25420000-0000-0000-0000-0000000000e4', 'Person Four');
select is((select code from people where id = '25420000-0000-0000-0000-0000000000e4'), 'P-0011', 'AC-PPL-002 the generator continues after the highest code');
insert into people (id, name, code) values ('25420000-0000-0000-0000-0000000000e5', 'Free Text Code', 'EMP-5');
insert into people (id, name) values ('25420000-0000-0000-0000-0000000000e6', 'Person Six');
select is((select code from people where id = '25420000-0000-0000-0000-0000000000e6'), 'P-0012', 'AC-PPL-002 a non-P code does not disturb the sequence');
select throws_ok($$insert into people (name, code) values ('Dup', 'p-0001')$$, '23505', null, 'AC-PPL-002 a live duplicate code is refused, case-insensitively');
update people set archived_at = now() where id = '25420000-0000-0000-0000-0000000000e4';
insert into people (id, name) values ('25420000-0000-0000-0000-0000000000e7', 'Person Seven');
select is((select code from people where id = '25420000-0000-0000-0000-0000000000e7'), 'P-0013', 'AC-PPL-002 an archived person''s number is not reused by the generator');
select lives_ok($$insert into people (name, code) values ('Reuse', 'P-0011')$$, 'AC-PPL-002 an archived code can be typed again');
select lives_ok($$update people set name = 'Person Two B', code = 'P-0002B', job_title = 'Foreman' where id = '25420000-0000-0000-0000-0000000000e2'$$, 'AC-PPL-002 name, code and job title are editable');
select throws_ok($$update people set code = 'P-0001' where id = '25420000-0000-0000-0000-0000000000e2'$$, '23505', null, 'AC-PPL-003 editing into a live duplicate is refused');

-- A typed high code must not cause the generator to truncate at five digits.
insert into people (id, name, code) values ('25420000-0000-0000-0000-0000000000ea', 'High Code', 'P-9999');
insert into people (id, name) values ('25420000-0000-0000-0000-0000000000eb', 'Next High Code');
select is((select code from people where id = '25420000-0000-0000-0000-0000000000eb'), 'P-10000', 'AC-PPL-002 generated codes grow beyond four digits');

-- AC-PPL-003 profile link
select lives_ok($$update people set profile_id = '25420000-0000-0000-0000-0000000000a4' where id = '25420000-0000-0000-0000-0000000000e1'$$, 'AC-PPL-003 an Admin links an app user profile');
select throws_ok($$update people set profile_id = '25420000-0000-0000-0000-0000000000a4' where id = '25420000-0000-0000-0000-0000000000e2'$$, '23505', null, 'AC-PPL-003 a profile already on a live person cannot be linked twice');
select throws_ok($$update people set profile_id = '25420000-0000-0000-0000-0000000000b2' where id = '25420000-0000-0000-0000-0000000000e2'$$, '23503', null, 'AC-PPL-004 another org''s profile cannot be linked');

-- AC-PPL-003 write roles
select pg_temp.act_as('25420000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from people where org_id = '25420000-0000-0000-0000-00000000000a'), 10, 'AC-PPL-003 a Project Manager reads the register');
select throws_ok($$insert into people (name) values ('By PM')$$, '42501', null, 'AC-PPL-003 a Project Manager cannot add a person');
select pg_temp.act_as('25420000-0000-0000-0000-0000000000a3');
select throws_ok($$insert into people (name) values ('By Finance')$$, '42501', null, 'AC-PPL-003 Finance cannot add a person');
update people set archived_at = now() where id = '25420000-0000-0000-0000-0000000000e1';
select pg_temp.act_as('25420000-0000-0000-0000-0000000000a1');
select is((select archived_at is null from people where id = '25420000-0000-0000-0000-0000000000e1'), true, 'AC-PPL-003 Finance cannot archive a person');
select pg_temp.act_as('25420000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from people where id <> '25420000-0000-0000-0000-0000000000e1'), 0, 'AC-PPL-003 an Engineer sees only the person linked to them');

-- AC-PPL-004 second-org isolation, both directions
select pg_temp.act_as('25420000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from people where id = '25420000-0000-0000-0000-0000000000e9'), 0, 'AC-PPL-004 an Admin does not see another org''s person');
update people set name = 'Hijacked' where id = '25420000-0000-0000-0000-0000000000e9';
reset role;
select is((select name from people where id = '25420000-0000-0000-0000-0000000000e9'), 'Foreign Person', 'AC-PPL-004 an Admin cannot update another org''s person');
set local role authenticated;
select pg_temp.act_as('25420000-0000-0000-0000-0000000000b1');
insert into people (id, name) values ('25420000-0000-0000-0000-0000000000e8', 'Other Org New');
select is((select code from people where id = '25420000-0000-0000-0000-0000000000e8'), 'P-0008', 'AC-PPL-004 each org numbers on its own (continues after its own P-0007)');
-- Mutation controls: prove these probes actually detect a permissive policy.
reset role;
alter policy people_insert on public.people with check (true);
alter policy people_select on public.people using (true);
set local role authenticated;
select pg_temp.act_as('25420000-0000-0000-0000-0000000000a2');
select lives_ok($$insert into people (name, code) values ('Mutant PM', 'MUTANT')$$, 'mutation: permissive insert allows PM, so the earlier denial detects this break');
select is((select count(*)::int from people where id = '25420000-0000-0000-0000-0000000000e9'), 1, 'mutation: permissive select reveals foreign row, so the earlier isolation check detects this break');
select * from finish();
rollback;
