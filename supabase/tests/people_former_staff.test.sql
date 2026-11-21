-- people_former_staff.test.sql — #2703 (AC-FSF-010). Former staff stay on record and stay org-scoped:
-- the register's readers may read an archived person of their own organisation, and nobody may read
-- another organisation's. No policy change ships with #2703; this test pins the read contract the
-- Former staff view depends on, plus one mutation control proving the denials are real.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27030000-0000-0000-0000-00000000000a', 'FSF Org',   'IDR', 'UTC'),
  ('27030000-0000-0000-0000-00000000000b', 'FSF Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('27030000-0000-0000-0000-0000000000a1', 'fsf-admin@example.com'),
  ('27030000-0000-0000-0000-0000000000a2', 'fsf-pm@example.com'),
  ('27030000-0000-0000-0000-0000000000a3', 'fsf-finance@example.com'),
  ('27030000-0000-0000-0000-0000000000a4', 'fsf-exec@example.com'),
  ('27030000-0000-0000-0000-0000000000a5', 'fsf-eng@example.com'),
  ('27030000-0000-0000-0000-0000000000b1', 'fsf-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27030000-0000-0000-0000-0000000000a1', '27030000-0000-0000-0000-00000000000a', 'FSF Admin',   'fsf-admin@example.com',   'Admin', 'active'),
  ('27030000-0000-0000-0000-0000000000a2', '27030000-0000-0000-0000-00000000000a', 'FSF PM',      'fsf-pm@example.com',      'Project Manager', 'active'),
  ('27030000-0000-0000-0000-0000000000a3', '27030000-0000-0000-0000-00000000000a', 'FSF Finance', 'fsf-finance@example.com', 'Finance', 'active'),
  ('27030000-0000-0000-0000-0000000000a4', '27030000-0000-0000-0000-00000000000a', 'FSF Exec',    'fsf-exec@example.com',    'Executive', 'active'),
  ('27030000-0000-0000-0000-0000000000a5', '27030000-0000-0000-0000-00000000000a', 'FSF Eng',     'fsf-eng@example.com',     'Engineer', 'active'),
  ('27030000-0000-0000-0000-0000000000b1', '27030000-0000-0000-0000-00000000000b', 'FSF XAdmin',  'fsf-xadmin@example.com',  'Admin', 'active');

-- One active person and one former person in each org. Written as the owner: the fixtures are not
-- testing the archive rule (1008 owns it), only what each reader can see afterwards.
insert into people (id, org_id, code, name, archived_at) values
  ('27030000-0000-0000-0000-0000000000e1', '27030000-0000-0000-0000-00000000000a', 'P-0001', 'Still Here',  null),
  ('27030000-0000-0000-0000-0000000000e2', '27030000-0000-0000-0000-00000000000a', 'P-0009', 'Now Former',  now()),
  ('27030000-0000-0000-0000-0000000000e3', '27030000-0000-0000-0000-00000000000b', 'P-0009', 'Other Former', now());

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;

-- The register's readers see former staff of their own organisation.
select pg_temp.act_as('27030000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from people where archived_at is not null), 1, 'AC-FSF-010 an Admin reads the former person of their own org');
select is((select code from people where id = '27030000-0000-0000-0000-0000000000e2'), 'P-0009', 'AC-FSF-010 the former person keeps their code and record');
select is((select count(*)::int from people where id = '27030000-0000-0000-0000-0000000000e3'), 0, 'AC-FSF-010 an Admin cannot read another org''s former person');

select pg_temp.act_as('27030000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from people where archived_at is not null), 1, 'AC-FSF-010 a Project Manager reads former staff');
select pg_temp.act_as('27030000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from people where archived_at is not null), 1, 'AC-FSF-010 Finance reads former staff');
select pg_temp.act_as('27030000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from people where archived_at is not null), 1, 'AC-FSF-010 an Executive reads former staff');

-- An Engineer who is neither the manager nor the linked profile cannot read the register at all.
select pg_temp.act_as('27030000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from people), 0, 'AC-FSF-010 an unlinked Engineer reads no people, former or active');

-- The second org's Admin sees only its own former person.
select pg_temp.act_as('27030000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from people where archived_at is not null and org_id = '27030000-0000-0000-0000-00000000000a'), 0, 'AC-FSF-010 another org''s Admin cannot read the former person');

-- Mutation control: make the select policy permissive and the Engineer probe must see the row.
reset role;
alter policy people_select on public.people using (true);
set local role authenticated;
select pg_temp.act_as('27030000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from people), 3, 'mutation: a permissive select reveals every former/active row, so the Engineer denial detects this break');

select * from finish();
rollback;
