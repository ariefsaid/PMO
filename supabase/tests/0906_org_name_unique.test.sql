-- 0906_org_name_unique.test.sql — proof for 0906_org_name_unique.sql (#2264, ADR-0101).
--
-- AC ids owned here (minted for #2264):
--   AC-ORG-021  a second organization whose name matches an existing one ignoring letter case and
--               whitespace is refused (23505) by the database, on any write path. Any whitespace
--               (tab, newline, non-breaking space, runs of spaces) counts as one space, and leading
--               and trailing whitespace is ignored: two names that look the same on screen collide.
--   AC-ORG-022  a distinct name is allowed.
--   AC-ORG-023  renaming an organization onto an existing name is refused (23505).
--   AC-ORG-024  operator_create_org reports the database refusal as its existing `org_name_taken`
--               error (the name the operator-org function and `pmo org add` already understand).
--
-- These run as the migration superuser on purpose: the rule must hold for EVERY writer (service role,
-- seed, a future RPC), not only for operator_create_org, so the raw-table assertions bypass RLS and
-- grants and leave the unique index as the only thing that can refuse.
--
-- MUTATION-CHECKED: dropping organizations_name_normalized_key, building it on `name`, or building it
-- on lower(btrim(name)) instead of the whitespace-folding key turns AC-ORG-021 red. Re-run it before trusting this file.
begin;
select plan(13);

insert into organizations (id, name) values
  ('09060000-0000-0000-0000-000000000001', 'AC-UON Acme Works');

select has_index('public', 'organizations', 'organizations_name_normalized_key',
  'AC-ORG-021 organizations carries the normalized-name unique index');

select throws_ok(
  $$ insert into organizations (name) values ('AC-UON Acme Works') $$,
  '23505', null, 'AC-ORG-021 the exact same name is refused');
select throws_ok(
  $$ insert into organizations (name) values ('ac-uon ACME works') $$,
  '23505', null, 'AC-ORG-021 the same name in another letter case is refused');
select throws_ok(
  $$ insert into organizations (name) values (E' AC-UON Acme Works \t') $$,
  '23505', null, 'AC-ORG-021 the same name with surrounding spaces is refused');
select throws_ok(
  $$ insert into organizations (name) values (E'AC-UON Acme\tWorks') $$,
  '23505', null, 'AC-ORG-021 the same name with a tab between its words is refused');
select throws_ok(
  $$ insert into organizations (name) values (E'AC-UON Acme\nWorks') $$,
  '23505', null, 'AC-ORG-021 the same name with a newline between its words is refused');
select throws_ok(
  $$ insert into organizations (name) values (E'AC-UON Acme\u00a0Works') $$,
  '23505', null, 'AC-ORG-021 the same name with a non-breaking space between its words is refused');
select throws_ok(
  $$ insert into organizations (name) values ('AC-UON Acme   Works') $$,
  '23505', null, 'AC-ORG-021 the same name with a run of spaces between its words is refused');

select lives_ok(
  $$ insert into organizations (id, name) values ('09060000-0000-0000-0000-000000000002', 'AC-UON Acme Works East') $$,
  'AC-ORG-022 a distinct name is allowed');

select throws_ok(
  $$ update organizations set name = ' ac-uon acme works' where id = '09060000-0000-0000-0000-000000000002' $$,
  '23505', null, 'AC-ORG-023 renaming onto an existing name is refused');
select lives_ok(
  $$ update organizations set name = 'AC-UON ACME WORKS' where id = '09060000-0000-0000-0000-000000000001' $$,
  'AC-ORG-023 an organization may change the case of its own name');

-- AC-ORG-024 — the create function's refusal, under a live Operator.
insert into organizations (id, name) values ('09060000-0000-0000-0000-000000000003', 'AC-UON Home Org');
insert into auth.users (id, email) values
  ('09060000-0000-0000-0000-0000000000a1', 'ac-uon-operator@example.com'),
  ('09060000-0000-0000-0000-0000000000b1', 'ac-uon-new-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('09060000-0000-0000-0000-0000000000a1', '09060000-0000-0000-0000-000000000003', 'Op',
   'ac-uon-operator@example.com', 'Admin', 'active');
insert into platform_operators (user_id) values ('09060000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"09060000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select operator_create_org('  ac-uon acme works ', '09060000-0000-0000-0000-0000000000b1', 'New Admin',
       'IDR', 'id', null, 'Asia/Jakarta') $$,
  '23505', 'org_name_taken', 'AC-ORG-024 operator_create_org reports a taken name as org_name_taken');
reset role;

select is((select count(*)::int from profiles where id = '09060000-0000-0000-0000-0000000000b1'), 0,
  'AC-ORG-024 the refused create leaves no Admin profile behind');

select * from finish();
rollback;
