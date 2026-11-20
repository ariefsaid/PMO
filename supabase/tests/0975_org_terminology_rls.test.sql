-- 1024_org_terminology_rls.test.sql
-- AC-TERM-001 [pgTAP]: org_terminology — every member reads their own org's overrides; only an
-- Admin writes; a cross-org Admin cannot read or write another org's rows.
begin;
select plan(13);

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

select lives_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('workOrder','en','Job','Jobs') on conflict (org_id, term_key, locale) do update set singular = excluded.singular, plural = excluded.plural$$,
  'AC-TERM-001 Admin can upsert an existing override');
select is((select singular from org_terminology where term_key = 'workOrder'), 'Job', 'AC-TERM-001 upsert updates the existing value');

set local request.jwt.claims = '{"sub":"09750000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from org_terminology), 1, 'AC-TERM-001 an Engineer reads own-org overrides');
select throws_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('project','en','Job','Jobs')$$,
  '42501', null, 'AC-TERM-001 an Engineer cannot write');
select is_empty($$update org_terminology set singular = 'Hacked' returning 1$$, 'AC-TERM-001 an Engineer cannot update');

select is_empty($$delete from org_terminology returning 1$$, 'AC-TERM-001 an Engineer cannot delete');

set local request.jwt.claims = '{"sub":"09750000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from org_terminology), 0, 'AC-TERM-001 a cross-org Admin reads nothing');
select is_empty($$delete from org_terminology returning 1$$, 'AC-TERM-001 a cross-org Admin deletes nothing');

select is_empty($$update org_terminology set singular = 'Hacked' returning 1$$, 'AC-TERM-001 a cross-org Admin updates nothing');
select throws_ok($$insert into org_terminology (org_id, term_key, locale, singular, plural) values ('09750000-0000-0000-0000-000000000001','project','en','Job','Jobs')$$, '42501', null, 'AC-TERM-001 a cross-org Admin cannot insert into another org');

select * from finish();
rollback;
