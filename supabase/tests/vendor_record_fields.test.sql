-- vendor_record_fields.test.sql — #3025 slice 1 (AC-3025).
-- A vendor record holds a code, an address and payment terms natively: the three PMO-native
-- columns exist on companies, are written through the UNCHANGED companies_write policy (the
-- four vendor-edit roles; an Engineer is refused), keep the org seam (a second organisation
-- cannot read the row at all), and clearing writes NULL. No RLS or grant changed in 2786 —
-- these are the existing rules, re-proven on the new columns.
-- Mutation-check: drop a column in 2786 and its existence test goes red; loosen the write
-- policy or the org select policy and the Engineer/second-org legs go red.
-- Isolated orgs; UUID prefix 30250000-… (issue #3025).
begin;
create extension if not exists pgtap;
select plan(11);

insert into organizations (id, name) values
  ('30250000-0000-0000-0000-000000000001','Vendor Fields Org A (3025)'),
  ('30250000-0000-0000-0000-000000000002','Vendor Fields Org B (3025)');

insert into auth.users (id, email) values
  ('30250000-0000-0000-0000-0000000000a1','admin-vf3025@example.com'),
  ('30250000-0000-0000-0000-0000000000a2','pm-vf3025@example.com'),
  ('30250000-0000-0000-0000-0000000000a3','eng-vf3025@example.com'),
  ('30250000-0000-0000-0000-0000000000b1','admin-orgb-vf3025@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('30250000-0000-0000-0000-0000000000a1','30250000-0000-0000-0000-000000000001','Admin VF 3025','admin-vf3025@example.com','Admin'),
  ('30250000-0000-0000-0000-0000000000a2','30250000-0000-0000-0000-000000000001','PM VF 3025','pm-vf3025@example.com','Project Manager'),
  ('30250000-0000-0000-0000-0000000000a3','30250000-0000-0000-0000-000000000001','Eng VF 3025','eng-vf3025@example.com','Engineer'),
  ('30250000-0000-0000-0000-0000000000b1','30250000-0000-0000-0000-000000000002','Admin B VF 3025','admin-orgb-vf3025@example.com','Admin');

-- ── The columns exist ───────────────────────────────────────────────────────
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'companies'
      and column_name in ('vendor_code','address','payment_terms_days')),
  3::bigint,
  'AC-3025: companies carries vendor_code, address and payment_terms_days');

-- ── The org-A write path (the vendor-edit roles) ────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into companies (id, org_id, name, type, vendor_code, address, payment_terms_days)
       values ('30250000-0000-0000-0000-000000000010','30250000-0000-0000-0000-000000000001',
               'Paku Mas Supply','Vendor','VEN-0077','Jl. Raya 12, Surabaya',30) $$,
  'AC-3025: an Admin creates a vendor with code, address and payment terms');

select is(
  (select vendor_code || '|' || coalesce(address,'') || '|' || payment_terms_days::text
     from companies where id = '30250000-0000-0000-0000-000000000010'),
  'VEN-0077|Jl. Raya 12, Surabaya|30',
  'AC-3025: the vendor master data landed as written');

set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ update companies set vendor_code = 'VEN-0088', payment_terms_days = 45
     where id = '30250000-0000-0000-0000-000000000010' $$,
  'AC-3025: a Project Manager (a vendor-edit role) updates the vendor fields');

select is(
  (select vendor_code || '|' || payment_terms_days::text from companies where id = '30250000-0000-0000-0000-000000000010'),
  'VEN-0088|45',
  'AC-3025: the update landed');

select lives_ok(
  $$ update companies set vendor_code = null, payment_terms_days = null
     where id = '30250000-0000-0000-0000-000000000010' $$,
  'AC-3025: clearing the fields writes NULL');

-- ── The gates stay up ───────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select throws_ok(
  $$ insert into companies (id, org_id, name, type, vendor_code)
       values ('30250000-0000-0000-0000-000000000011','30250000-0000-0000-0000-000000000001',
               'Eng Vendor','Vendor','VEN-ENG') $$,
  '42501', null,
  'AC-3025: an Engineer cannot create a company row with vendor fields (write policy unchanged)');

-- RLS on UPDATE raises nothing: the Engineer's update matches zero rows and the value stays.
select lives_ok(
  $$ update companies set vendor_code = 'VEN-HACK' where id = '30250000-0000-0000-0000-000000000010' $$,
  'AC-3025: an Engineer''s update of the vendor fields runs without error');

select is(
  (select vendor_code from companies where id = '30250000-0000-0000-0000-000000000010'),
  null,
  'AC-3025: an Engineer cannot update the vendor fields (zero rows changed, value unchanged)');

-- ── The org seam: a second organisation cannot read the row at all ─────────
set local request.jwt.claims = '{"sub":"30250000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(
  (select count(*) from companies where id = '30250000-0000-0000-0000-000000000010'),
  0::bigint,
  'AC-3025: another organisation cannot read the vendor row (select policy unchanged)');

select throws_ok(
  $$ insert into companies (id, org_id, name, type, vendor_code)
       values ('30250000-0000-0000-0000-000000000012','30250000-0000-0000-0000-000000000001',
               'Cross-org Vendor','Vendor','VEN-X') $$,
  '42501', null,
  'AC-3025: another organisation cannot stamp its vendor row into org A');

reset role;
select * from finish();
rollback;
