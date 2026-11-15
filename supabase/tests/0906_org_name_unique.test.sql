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
--   AC-ORG-025  organization_id_by_name finds an organization by the same key, so a re-run with a
--               spacing variant of its name is recognised (the operator-org function's re-run lookup).
--   AC-ORG-026  a name whose key is empty (tab-only, non-breaking-space-only, zero-width-only) is
--               refused as org_name_required.
--   AC-ORG-027  operator_create_org's error order: a taken name is reported before any Admin check.
--   AC-ORG-028  the migration's duplicate rename keeps the oldest name and renames every later match.
--
-- These run as the migration superuser on purpose: the rule must hold for EVERY writer (service role,
-- seed, a future RPC), not only for operator_create_org, so the raw-table assertions bypass RLS and
-- grants and leave the unique index as the only thing that can refuse.
--
-- MUTATION-CHECKED: dropping organizations_name_normalized_key, building it on `name`, or building it
-- on lower(btrim(name)) instead of the whitespace-folding key turns AC-ORG-021 red. Re-run it before trusting this file.
begin;
select plan(34);

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

select throws_ok(
  $$ insert into organizations (name) values (E'AC-UON Acme\u200bWorks') $$,
  '23505', null, 'AC-ORG-021 the same name with a zero-width space (U+200B) between its words is refused');
select throws_ok(
  $$ insert into organizations (name) values (E'\ufeffAC-UON Acme\ufeffWorks') $$,
  '23505', null, 'AC-ORG-021 the same name with a byte-order mark (U+FEFF) is refused');
select throws_ok(
  $$ insert into organizations (name) values (E'AC-UON Acme\u0085Works') $$,
  '23505', null, 'AC-ORG-021 the same name with a next-line character (U+0085) between its words is refused');

select is(public.org_name_key(E' \u00a0AC-UON\t\u2003Acme \u200b\ufeff\u0085Works\n'), 'ac-uon acme works',
  'AC-ORG-021 org_name_key folds every whitespace character to one space, trims and lower-cases');
select is(public.org_name_key(E'\t\u00a0\u200b\ufeff\u0085 '), '',
  'AC-ORG-026 org_name_key of a whitespace-only name is empty');

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

-- AC-ORG-026 — blank names are refused on the key, before anything is written.
select throws_ok(
  $$ select operator_create_org(E'\t\t', '09060000-0000-0000-0000-0000000000b1', 'New Admin',
       'IDR', 'id', null, 'Asia/Jakarta') $$,
  'P0001', 'org_name_required', 'AC-ORG-026 a tab-only name is refused as org_name_required');
select throws_ok(
  $$ select operator_create_org(E'\u00a0', '09060000-0000-0000-0000-0000000000b1', 'New Admin',
       'IDR', 'id', null, 'Asia/Jakarta') $$,
  'P0001', 'org_name_required', 'AC-ORG-026 a non-breaking-space-only name is refused as org_name_required');
select throws_ok(
  $$ select operator_create_org(E'\u200b\ufeff\u0085', '09060000-0000-0000-0000-0000000000b1', 'New Admin',
       'IDR', 'id', null, 'Asia/Jakarta') $$,
  'P0001', 'org_name_required', 'AC-ORG-026 a zero-width-only name is refused as org_name_required');

-- AC-ORG-027 — a taken name is reported before the Admin checks.
select throws_ok(
  $$ select operator_create_org('AC-UON Acme Works', '09060000-0000-0000-0000-0000000000a1', 'Op',
       'IDR', 'id', null, 'Asia/Jakarta') $$,
  '23505', 'org_name_taken', 'AC-ORG-027 a taken name is reported before admin_already_has_profile');
select throws_ok(
  $$ select operator_create_org('AC-UON Acme Works', '09060000-0000-0000-0000-0000000000f9', 'Nobody',
       'IDR', 'id', null, 'Asia/Jakarta') $$,
  '23505', 'org_name_taken', 'AC-ORG-027 a taken name is reported before unknown_admin_user');
reset role;

select is((select count(*)::int from profiles where id = '09060000-0000-0000-0000-0000000000b1'), 0,
  'AC-ORG-024 the refused create leaves no Admin profile behind');

-- AC-ORG-025 — the re-run lookup, as the operator-org function's service client calls it.
set local role service_role;
select is(public.organization_id_by_name(E'ac-uon\u00a0 ACME\tworks '), '09060000-0000-0000-0000-000000000001'::uuid,
  'AC-ORG-025 a spacing variant of an existing name finds that organization');
select is(public.organization_id_by_name('AC-UON Nobody Has This'), null::uuid,
  'AC-ORG-025 a distinct name finds nothing');
select throws_ok(
  $$ select public.organization_id_by_name(E'\t\u200b') $$,
  'P0001', 'org_name_required', 'AC-ORG-026 the lookup refuses a name whose key is empty');
reset role;
select ok(not has_function_privilege('authenticated', 'public.organization_id_by_name(text)', 'execute')
      and not has_function_privilege('anon', 'public.organization_id_by_name(text)', 'execute'),
  'AC-ORG-025 only the service role can run the name lookup');

-- AC-ORG-028 — the duplicate rename (0906 §1), on rows that would break the index.
drop index public.organizations_name_normalized_key;
insert into organizations (id, name, created_at) values
  ('a9060000-0000-0000-0000-000000000011', 'AC-DUP Same Name',   '2020-01-01'),
  ('b9060000-0000-0000-0000-000000000012', E'ac-dup\tsame  NAME', '2021-01-01'),
  ('c9060000-0000-0000-0000-000000000013', E' AC-DUP Same\u00a0Name ', '2022-01-01'),
  ('d9060000-0000-0000-0000-000000000014', 'AC-DUP Other Name',  '2023-01-01');
select lives_ok($$ select public.organizations_rename_duplicate_names() $$,
  'AC-ORG-028 the duplicate rename runs');
select is((select name from organizations where id = 'a9060000-0000-0000-0000-000000000011'), 'AC-DUP Same Name',
  'AC-ORG-028 the oldest organization keeps its name');
select is((select name from organizations where id = 'b9060000-0000-0000-0000-000000000012'),
  E'ac-dup\tsame  NAME (duplicate b9060000)', 'AC-ORG-028 a later match is renamed with its id prefix');
select is((select name from organizations where id = 'c9060000-0000-0000-0000-000000000013'),
  E'AC-DUP Same\u00a0Name (duplicate c9060000)', 'AC-ORG-028 a later match is renamed, its surrounding spaces trimmed');
select is((select name from organizations where id = 'd9060000-0000-0000-0000-000000000014'), 'AC-DUP Other Name',
  'AC-ORG-028 a distinct name is left alone');
select lives_ok(
  $$ create unique index organizations_name_normalized_key on public.organizations (public.org_name_key(name)) $$,
  'AC-ORG-028 after the rename the unique index builds');
select ok(not has_function_privilege('service_role', 'public.organizations_rename_duplicate_names()', 'execute')
      and not has_function_privilege('authenticated', 'public.organizations_rename_duplicate_names()', 'execute'),
  'AC-ORG-028 no API role can run the duplicate rename');

select * from finish();
rollback;
