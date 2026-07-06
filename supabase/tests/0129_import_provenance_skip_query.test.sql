-- 0129_import_provenance_skip_query.test.sql — provenance columns + skip-query proof.
-- Migration under test: 0072_import_provenance.sql
--
-- AC-IDEM-001  import_batch_id/imported_at stamped and non-NULL when supplied
-- AC-IDEM-006  skip-query returns the existing row for (org_id, import_key, batch); nothing for a new key
-- AC-IDEM-007  existing rows have NULL import_batch_id/imported_at/import_key (migration is additive)
-- (unnumbered)  capture_vendor_invoice (0056) still resolves + succeeds post-0072 — proves the
--               5-positional-arg call site into the now-8-param create_procurement_invoice keeps
--               working via the 3 new trailing params' defaults (fix-round finding #2).
begin;
select plan(7);

insert into organizations (id, name) values
  ('01290000-0000-0000-0000-000000000001', 'Idem Org A');
insert into auth.users (id, email) values
  ('01290000-0000-0000-0000-0000000000a1', 'pm-idem@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01290000-0000-0000-0000-0000000000a1','01290000-0000-0000-0000-000000000001',
   'PM Idem','pm-idem@example.com','Project Manager');
insert into auth.users (id, email) values
  ('01290000-0000-0000-0000-0000000000a2', 'fin-idem@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01290000-0000-0000-0000-0000000000a2','01290000-0000-0000-0000-000000000001',
   'Finance Idem','fin-idem@example.com','Finance');

-- Pre-existing (pre-migration-shaped) row: no provenance columns supplied.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('01290000-0000-0000-0000-000000000010','01290000-0000-0000-0000-000000000001',
   'Legacy Case (no import)','Draft','01290000-0000-0000-0000-0000000000a1');

-- AC-IDEM-007: pre-existing row has NULL provenance columns.
select is(
  (select import_batch_id from procurements where id = '01290000-0000-0000-0000-000000000010'),
  null,
  'AC-IDEM-007: pre-existing procurement row has NULL import_batch_id (additive migration)');
select is(
  (select import_key from procurements where id = '01290000-0000-0000-0000-000000000010'),
  null,
  'AC-IDEM-007: pre-existing procurement row has NULL import_key (additive migration)');

-- Imported row: provenance columns supplied directly (as the commit-layer / historical script would).
insert into procurements
  (id, org_id, title, status, requested_by_id, import_key, import_batch_id, imported_at)
values
  ('01290000-0000-0000-0000-000000000011','01290000-0000-0000-0000-000000000001',
   'Imported Case','Draft','01290000-0000-0000-0000-0000000000a1',
   'CASE-REF-001','01290000-0000-0000-0000-00000000ba01', now());

-- AC-IDEM-001: stamped and non-NULL.
select isnt(
  (select import_batch_id from procurements where id = '01290000-0000-0000-0000-000000000011'),
  null,
  'AC-IDEM-001: import_batch_id is stamped and non-NULL on an imported row');
select isnt(
  (select imported_at from procurements where id = '01290000-0000-0000-0000-000000000011'),
  null,
  'AC-IDEM-001: imported_at is stamped and non-NULL on an imported row');

-- AC-IDEM-006: the skip-query (org_id, import_key, import_batch_id) returns the existing row.
select is(
  (select id from procurements
     where org_id = '01290000-0000-0000-0000-000000000001'
       and import_key = 'CASE-REF-001'
       and import_batch_id = '01290000-0000-0000-0000-00000000ba01')::text,
  '01290000-0000-0000-0000-000000000011',
  'AC-IDEM-006: skip-query returns the existing row for (org_id, import_key, batch)');

-- AC-IDEM-006: the same query for a genuinely-new key returns nothing.
select is(
  (select count(*) from procurements
     where org_id = '01290000-0000-0000-0000-000000000001'
       and import_key = 'CASE-REF-999'
       and import_batch_id = '01290000-0000-0000-0000-00000000ba01'),
  0::bigint,
  'AC-IDEM-006: skip-query returns nothing for a genuinely-new import_key');

-- (unnumbered, fix-round finding #2): capture_vendor_invoice (0056) still resolves and succeeds
-- post-0072. Its call into create_procurement_invoice is 5 positional args; the 3 new trailing
-- provenance params must resolve from their defaults for this to keep working.
-- Received -> Vendor Invoiced requires role Finance (migration 0038's legal-map role gate).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01290000-0000-0000-0000-0000000000a2","role":"authenticated"}';

insert into procurements (id, org_id, title, status, requested_by_id) values
  ('01290000-0000-0000-0000-000000000012','01290000-0000-0000-0000-000000000001',
   'Cap-VI Case','Received','01290000-0000-0000-0000-0000000000a2');

select is(
  (select status from capture_vendor_invoice(
    '01290000-0000-0000-0000-000000000012'::uuid, 'Received'::procurement_invoice_status,
    '2026-07-04'::date, 'VI-TEST-001', 1234.56, null))::text,
  'Received',
  'capture_vendor_invoice still succeeds post-0072 (5-positional-arg call site into the extended create_procurement_invoice)');

reset role;

select * from finish();
rollback;
