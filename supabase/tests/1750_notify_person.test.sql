-- 1750_notify_person.test.sql — the shared notice helper (migration 1750).
-- MUTATION: make notify_person skip the profile check (notify every person) -> 'no login: no notice' goes red;
--           replace the call with a direct insert ignoring is_active_member -> 'inactive member' goes red.
begin;
create extension if not exists pgtap;
select plan(7);
insert into organizations (id, name, default_currency) values ('17500000-0000-0000-0000-00000000010a', 'NP Org', 'IDR');
insert into auth.users (id, email) values
  ('17500000-0000-0000-0000-0000000001a1', 'np-active@example.com'),
  ('17500000-0000-0000-0000-0000000001a2', 'np-gone@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17500000-0000-0000-0000-0000000001a1', '17500000-0000-0000-0000-00000000010a', 'NP Active', 'np-active@example.com', 'Engineer', 'active'),
  ('17500000-0000-0000-0000-0000000001a2', '17500000-0000-0000-0000-00000000010a', 'NP Gone',   'np-gone@example.com',   'Engineer', 'inactive');
insert into people (id, org_id, kind, name, profile_id) values
  ('17500000-0000-0000-0000-000000001f01', '17500000-0000-0000-0000-00000000010a', 'own',    'NP With Login',  '17500000-0000-0000-0000-0000000001a1'),
  ('17500000-0000-0000-0000-000000001f02', '17500000-0000-0000-0000-00000000010a', 'vendor', 'NP No Login',    null),
  ('17500000-0000-0000-0000-000000001f03', '17500000-0000-0000-0000-00000000010a', 'own',    'NP Inactive',    '17500000-0000-0000-0000-0000000001a2');

select lives_ok($$ select notify_person('17500000-0000-0000-0000-000000001f01', 'medical_release', 'Title one', 'Body one', '/leave') $$, 'a person with a login is notified');
select is((select title || '|' || body from notifications where owner_id = '17500000-0000-0000-0000-0000000001a1'), 'Title one|Body one', 'the notice carries the title and body');
select is((select metadata->'entity'->>'type' from notifications where owner_id = '17500000-0000-0000-0000-0000000001a1'), 'medical_release', 'the kind is the entity type');
select lives_ok($$ select notify_person('17500000-0000-0000-0000-000000001f02', 'medical_release', 't', 'b', '/x') $$, 'no login: no error');
select lives_ok($$ select notify_person('17500000-0000-0000-0000-000000001f03', 'medical_release', 't', 'b', '/x') $$, 'inactive member: no error');
select is((select count(*)::int from notifications where owner_id = '17500000-0000-0000-0000-0000000001a2'), 0, 'inactive member: no notice');
set local role authenticated;
select throws_ok($$ select notify_person('17500000-0000-0000-0000-000000001f01', 'k', 't', 'b', '/x') $$, '42501', null, 'a signed-in caller cannot execute it');
select * from finish();
rollback;
