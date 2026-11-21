-- 1231_org_role_names.test.sql
-- AC-TX-005 [pgTAP]: org_role_names — Admin-only write, own-org read, length-bounded, known keys and languages only.
-- Mutation notes: replace the Admin check in org_role_names_insert with `true` -> the Engineer insert assertion goes red;
-- drop the char_length check -> the 61-character and blank assertions go red; drop the org_id clause from
-- the select policy -> the cross-org read assertion goes red; drop the role_key FK -> the unknown-key assertion goes red.
begin;
select plan(13);

insert into organizations (id, name) values
  ('12310000-0000-0000-0000-000000000001','AC-TX Roles Org A'),
  ('12310000-0000-0000-0000-000000000002','AC-TX Roles Org B');
insert into auth.users (id, email) values
  ('12310000-0000-0000-0000-0000000000a1','rn-a-admin@example.com'),
  ('12310000-0000-0000-0000-0000000000a2','rn-a-eng@example.com'),
  ('12310000-0000-0000-0000-0000000000b1','rn-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('12310000-0000-0000-0000-0000000000a1','12310000-0000-0000-0000-000000000001','A Admin','rn-a-admin@example.com','Admin','active'),
  ('12310000-0000-0000-0000-0000000000a2','12310000-0000-0000-0000-000000000001','A Eng','rn-a-eng@example.com','Engineer','active'),
  ('12310000-0000-0000-0000-0000000000b1','12310000-0000-0000-0000-000000000002','B Admin','rn-b-admin@example.com','Admin','active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"12310000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into org_role_names (role_key, locale, name) values ('storekeeper','en','Yard Keeper')$$,
  'AC-TX-005 an Admin renames a role (org_id stamped, not sent)');
select is((select org_id from org_role_names limit 1), '12310000-0000-0000-0000-000000000001'::uuid,
  'AC-TX-005 org_id is stamped to the caller''s org');
select lives_ok($$insert into org_role_names (role_key, locale, name) values ('storekeeper','en','Yard Lead') on conflict (org_id, role_key, locale) do update set name = excluded.name$$,
  'AC-TX-005 an Admin can upsert');
select is((select name from org_role_names where role_key = 'storekeeper'), 'Yard Lead', 'AC-TX-005 upsert updates the name');
select throws_ok($$insert into org_role_names (role_key, locale, name) values ('buyer','en','   ')$$, '23514', null, 'AC-TX-005 a blank name is refused');
select throws_ok($$insert into org_role_names (role_key, locale, name) values ('buyer','en',repeat('x',61))$$, '23514', null, 'AC-TX-005 a 61-character name is refused');
select throws_ok($$insert into org_role_names (role_key, locale, name) values ('buyer','fr','Acheteur')$$, '23514', null, 'AC-TX-005 an unknown language is refused');
select throws_ok($$insert into org_role_names (role_key, locale, name) values ('no_such_role','en','X')$$, '23503', null, 'AC-TX-005 an unknown role key is refused');

set local request.jwt.claims = '{"sub":"12310000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from org_role_names), 1, 'AC-TX-005 an Engineer reads own-org names');
select throws_ok($$insert into org_role_names (role_key, locale, name) values ('buyer','en','Purchaser')$$, '42501', null, 'AC-TX-005 an Engineer cannot write');
select is_empty($$update org_role_names set name = 'Hacked' returning 1$$, 'AC-TX-005 an Engineer cannot update');

set local request.jwt.claims = '{"sub":"12310000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from org_role_names), 0, 'AC-TX-005 a cross-org Admin reads nothing');
select throws_ok($$insert into org_role_names (org_id, role_key, locale, name) values ('12310000-0000-0000-0000-000000000001','buyer','en','Forged')$$, '42501', null, 'AC-TX-005 a cross-org Admin cannot forge org_id');

select * from finish();
rollback;
