-- 1230_terminology_expansion.test.sql
-- AC-TX-001 [pgTAP]: the term_key check accepts exactly the 16 terms; only an Admin writes; members read own org.
-- Mutation notes: drop one key from the widened check in 1230 -> the 16-key loop assertion goes red;
-- replace the Admin check in the 1024 policies with `true` -> the Engineer write assertion goes red.
begin;
select plan(8);

insert into organizations (id, name) values
  ('12300000-0000-0000-0000-000000000001','AC-TX Org A'),
  ('12300000-0000-0000-0000-000000000002','AC-TX Org B');
insert into auth.users (id, email) values
  ('12300000-0000-0000-0000-0000000000a1','tx-a-admin@example.com'),
  ('12300000-0000-0000-0000-0000000000a2','tx-a-eng@example.com'),
  ('12300000-0000-0000-0000-0000000000b1','tx-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('12300000-0000-0000-0000-0000000000a1','12300000-0000-0000-0000-000000000001','A Admin','tx-a-admin@example.com','Admin','active'),
  ('12300000-0000-0000-0000-0000000000a2','12300000-0000-0000-0000-000000000001','A Eng','tx-a-eng@example.com','Engineer','active'),
  ('12300000-0000-0000-0000-0000000000b1','12300000-0000-0000-0000-000000000002','B Admin','tx-b-admin@example.com','Admin','active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"12300000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$
  insert into org_terminology (term_key, locale, singular, plural)
  select k, 'en', 'X ' || k, 'Xs ' || k from unnest(array[
    'workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest',
    'billOfQuantities','contractItem','dailyRevenue','acceptedQuantity','costVariation','deliveryNote',
    'stockCount','imprest','standIn','progressClaim']) as k
$$, 'AC-TX-001 an Admin writes every one of the 16 terms');
select is((select count(*)::int from org_terminology), 16, 'AC-TX-001 sixteen rows stored');
select throws_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('progressAssessment','en','X','Xs')$$,
  '23514', null, 'AC-TX-001 a term outside the 16 is refused');
select throws_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('standIn','id',repeat('x',61),'x')$$,
  '23514', null, 'AC-TX-001 a 61-character name is refused');

set local request.jwt.claims = '{"sub":"12300000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from org_terminology), 16, 'AC-TX-001 an Engineer reads own-org terms');
select throws_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('imprest','id','Kas','Kas')$$,
  '42501', null, 'AC-TX-001 an Engineer cannot write a new term');

set local request.jwt.claims = '{"sub":"12300000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from org_terminology), 0, 'AC-TX-001 a cross-org Admin reads nothing');
select is_empty($$update org_terminology set singular = 'Hacked' returning 1$$, 'AC-TX-001 a cross-org Admin updates nothing');

select * from finish();
rollback;
