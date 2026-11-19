-- 0975_org_terminology_rls.test.sql
-- AC-TERM-001 [pgTAP]: org_terminology — every member reads their own org's overrides; only an
-- Admin writes; a cross-org Admin cannot read or write another org's rows.
begin;
select plan(8);

insert into organizations (id, name) values
  ('09750000-0000-0000-0000-000000000001','AC-TERM Org A'),
  ('09750000-0000-0000-0000-000000000002','AC-TERM Org B');
insert into auth.users (id, email) values
  ('09750000-0000-0000-0000-0000000000a1','term-a-admin@example.com'),
  ('09750000-0000-0000-0000-0000000000a2','term-a-eng@example.com'),
  ('09750000-0000-0000-0000-0000000000b1','term-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('09750000-0000-0000-0000-0000000000a1','09750000-0000-0000-0000-000000000001','A Admin','term-a-admin@example.com','Admin','active'),
  ('09750000-0000-0000-0000-0000000000a2','09750000-0000-0000-0000-000000000001','A Eng','term-a-eng@example.com','Engineer','active'),
  ('09750000-0000-0000-0000-0000000000b1','09750000-0000-0000-0000-000000000002','B Admin','term-b-admin@example.com','Admin','active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"09750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('workOrder','en','Job Card','Job Cards')$$,
  'AC-TERM-001 org-A Admin writes an override (org_id stamped, not sent)');
select is((select org_id from org_terminology limit 1), '09750000-0000-0000-0000-000000000001'::uuid,
  'AC-TERM-001 org_id is stamped to the caller''s org');
select throws_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('invoice','en','X','Xs')$$,
  '23514', null, 'AC-TERM-001 only the fixed term set is overridable');

set local request.jwt.claims = '{"sub":"09750000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from org_terminology), 1, 'AC-TERM-001 an Engineer reads own-org overrides');
select throws_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('project','en','Job','Jobs')$$,
  '42501', null, 'AC-TERM-001 an Engineer cannot write');
select is_empty($$update org_terminology set singular = 'Hacked' returning 1$$, 'AC-TERM-001 an Engineer cannot update');

set local request.jwt.claims = '{"sub":"09750000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from org_terminology), 0, 'AC-TERM-001 a cross-org Admin reads nothing');
select is_empty($$delete from org_terminology returning 1$$, 'AC-TERM-001 a cross-org Admin deletes nothing');

select * from finish();
rollback;
