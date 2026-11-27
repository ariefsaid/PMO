-- vendor_tax_number.test.sql — #3025 slice 2 (AC-3025).
-- The vendor's tax number lives in its own table (company_tax_numbers) whose read AND write are
-- exactly the four vendor-edit roles in the caller's own organisation; everyone else — same-org
-- non-edit roles and every other organisation — gets nothing. The org seam is stamped from the
-- parent company, so no write can place the value in a foreign organisation even by naming one.
-- The ERP mirror column erp_tax_id is untouched: nothing in 2788 reads or writes it.
-- Mutation-check: drop the four-role conjunct from either policy and every Engineer leg goes
-- red; drop the org conjunct and the second-organisation legs go red; loosen the with-check and
-- the cross-org stamp refusal goes red.
-- Isolated orgs; UUID prefix 30250000-… (issue #3025).
begin;
create extension if not exists pgtap;
select plan(27);

insert into organizations (id, name) values
  ('30250000-0000-0000-0000-000000000001','Vendor Tax Org A (3025)'),
  ('30250000-0000-0000-0000-000000000002','Vendor Tax Org B (3025)');

insert into auth.users (id, email) values
  ('30250000-0000-0000-0000-0000000000a1','admin-vtax3025@example.com'),
  ('30250000-0000-0000-0000-0000000000a2','pm-vtax3025@example.com'),
  ('30250000-0000-0000-0000-0000000000a3','eng-vtax3025@example.com'),
  ('30250000-0000-0000-0000-0000000000a4','fin-vtax3025@example.com'),
  ('30250000-0000-0000-0000-0000000000a5','exec-vtax3025@example.com'),
  ('30250000-0000-0000-0000-0000000000a6','offfin-vtax3025@example.com'),
  ('30250000-0000-0000-0000-0000000000a7','field-vtax3025@example.com'),
  ('30250000-0000-0000-0000-0000000000b1','admin-orgb-vtax3025@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('30250000-0000-0000-0000-0000000000a1','30250000-0000-0000-0000-000000000001','Admin VT 3025','admin-vtax3025@example.com','Admin'),
  ('30250000-0000-0000-0000-0000000000a2','30250000-0000-0000-0000-000000000001','PM VT 3025','pm-vtax3025@example.com','Project Manager'),
  ('30250000-0000-0000-0000-0000000000a3','30250000-0000-0000-0000-000000000001','Eng VT 3025','eng-vtax3025@example.com','Engineer'),
  ('30250000-0000-0000-0000-0000000000a4','30250000-0000-0000-0000-000000000001','Fin VT 3025','fin-vtax3025@example.com','Finance'),
  ('30250000-0000-0000-0000-0000000000a5','30250000-0000-0000-0000-000000000001','Exec VT 3025','exec-vtax3025@example.com','Executive'),
  ('30250000-0000-0000-0000-0000000000a6','30250000-0000-0000-0000-000000000001','Off Fin VT 3025','offfin-vtax3025@example.com','Finance'),
  ('30250000-0000-0000-0000-0000000000a7','30250000-0000-0000-0000-000000000001','Field VT 3025','field-vtax3025@example.com','Project Manager'),
  ('30250000-0000-0000-0000-0000000000b1','30250000-0000-0000-0000-000000000002','Admin B VT 3025','admin-orgb-vtax3025@example.com','Admin');

-- A deactivated Finance member (token still valid) and a field account whose base role is a
-- vendor-edit role: the active-member and field-account conditions are what must stop them.
update profiles set status = 'disabled' where id = '30250000-0000-0000-0000-0000000000a6';
update profiles set built_in_role = 'foreman' where id = '30250000-0000-0000-0000-0000000000a7';

insert into companies (id, org_id, name, type) values
  ('30250000-0000-0000-0000-000000000010','30250000-0000-0000-0000-000000000001','Paku Mas Supply','Vendor'),
  ('30250000-0000-0000-0000-000000000011','30250000-0000-0000-0000-000000000002','Org B Vendor','Vendor');

-- ── Each vendor-edit role writes and reads ──────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into company_tax_numbers (company_id, tax_number)
       values ('30250000-0000-0000-0000-000000000010','01.234.567.8-901.000') $$,
  'AC-3025: an Admin keeps the vendor''s tax number');

select is(
  (select org_id from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  '30250000-0000-0000-0000-000000000001'::uuid,
  'AC-3025: the org seam is stamped from the parent company, never from the caller''s payload');

select is(
  (select tax_number from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  '01.234.567.8-901.000',
  'AC-3025: an Admin reads it back');

set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ update company_tax_numbers set tax_number = '01.234.567.8-901.999'
     where company_id = '30250000-0000-0000-0000-000000000010' $$,
  'AC-3025: a Project Manager (a vendor-edit role) updates it');

select is(
  (select tax_number from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  '01.234.567.8-901.999',
  'AC-3025: a Project Manager reads it back');

set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ update company_tax_numbers set tax_number = '02.345.678.9-012.000'
     where company_id = '30250000-0000-0000-0000-000000000010' $$,
  'AC-3025: Finance updates it');

set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(
  (select tax_number from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  '02.345.678.9-012.000',
  'AC-3025: an Executive reads it back');

-- ── Same-org roles that cannot edit a vendor: nothing ───────────────────────
set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select is(
  (select count(*) from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  0::bigint,
  'AC-3025: an Engineer cannot read the tax number');

select throws_ok(
  $$ insert into company_tax_numbers (company_id, tax_number)
       values ('30250000-0000-0000-0000-000000000010','01.234.567.8-901.000') $$,
  '42501', null,
  'AC-3025: an Engineer cannot write the tax number');

-- RLS on UPDATE/DELETE raises nothing: the statement matches zero rows. The value is checked
-- afterwards as the Executive, who can read it.
select lives_ok(
  $$ update company_tax_numbers set tax_number = 'x' where company_id = '30250000-0000-0000-0000-000000000010' $$,
  'AC-3025: an Engineer''s update of the tax number runs without error');

select lives_ok(
  $$ delete from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010' $$,
  'AC-3025: an Engineer''s delete of the tax number runs without error');

set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(
  (select tax_number from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  '02.345.678.9-012.000',
  'AC-3025: an Engineer cannot update or delete the tax number (zero rows changed, value unchanged)');

-- ── A deactivated member of a vendor-edit role: nothing, per command ────────
set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a6","role":"authenticated"}';

select is(
  (select count(*) from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  0::bigint,
  'AC-3025: a deactivated Finance member cannot read the tax number');

select throws_ok(
  $$ insert into company_tax_numbers (company_id, tax_number)
       values ('30250000-0000-0000-0000-000000000010','03.000.000.0-000.000') $$,
  '42501', null,
  'AC-3025: a deactivated Finance member cannot write the tax number');

select lives_ok(
  $$ update company_tax_numbers set tax_number = 'x' where company_id = '30250000-0000-0000-0000-000000000010' $$,
  'AC-3025: a deactivated Finance member''s update runs without error');

select lives_ok(
  $$ delete from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010' $$,
  'AC-3025: a deactivated Finance member''s delete runs without error');

set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(
  (select tax_number from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  '02.345.678.9-012.000',
  'AC-3025: a deactivated Finance member cannot update or delete the tax number (value unchanged)');

-- ── A field account (base role Project Manager): reads nothing ──────────────
set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a7","role":"authenticated"}';

select is(
  (select count(*) from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  0::bigint,
  'AC-3025: a field account cannot read the tax number');

-- ── Hard facts the suite guards also hold ───────────────────────────────────
reset role;
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.company_tax_numbers'::regclass),
  'AC-3025: row-level security is forced on company_tax_numbers');

select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'company_tax_numbers' and grantee = 'anon'),
  0::bigint,
  'AC-3025: anon holds no grant on company_tax_numbers');
set local role authenticated;

-- ── A second organisation: nothing, even as its Admin ───────────────────────
set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(
  (select count(*) from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  0::bigint,
  'AC-3025: another organisation cannot read the tax number');

select throws_ok(
  $$ insert into company_tax_numbers (company_id, tax_number)
       values ('30250000-0000-0000-0000-000000000010','99.999.999.9-999.999') $$,
  '42501', null,
  'AC-3025: another organisation cannot stamp a tax number onto org A''s vendor (org seam)');

-- ── The data rules ──────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into company_tax_numbers (company_id, tax_number)
       values ('30250000-0000-0000-0000-000000000010','   ') $$,
  '23514', null,
  'AC-3025: a blank tax number is refused');

select lives_ok(
  $$ insert into company_tax_numbers (company_id, org_id, tax_number)
       values ('30250000-0000-0000-0000-000000000010','30250000-0000-0000-0000-000000000002','01.234.567.8-901.000')
       on conflict (company_id) do update set tax_number = excluded.tax_number $$,
  'AC-3025: the upsert path works (one row per vendor, company_id key)');

select is(
  (select count(*) from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  1::bigint,
  'AC-3025: exactly one row per vendor after the upsert');

select lives_ok(
  $$ delete from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010' $$,
  'AC-3025: clearing the tax number deletes the row');

select is(
  (select count(*) from company_tax_numbers where company_id = '30250000-0000-0000-0000-000000000010'),
  0::bigint,
  'AC-3025: the row is gone after clearing');

reset role;
select * from finish();
rollback;
