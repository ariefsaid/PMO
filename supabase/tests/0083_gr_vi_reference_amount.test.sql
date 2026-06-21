-- 0083_gr_vi_reference_amount.test.sql — Schema + data shape for migration 0040.
-- Encodes: AC-PR-LEDGER-015 / AC-PR-LEDGER-016 / AC-PR-LEDGER-017
-- Tables tested: procurement_receipts (GR), procurement_invoices (VI)
-- Verifies: new columns exist, are nullable, and accept data.
begin;
select plan(10);

-- ── Fixtures (table owner — bypasses RLS) ────────────────────────────────────
insert into organizations (id, name) values
  ('00830000-0000-0000-0000-000000000001', 'GR-VI-Ref Org');

insert into auth.users (id, email) values
  ('00830000-0000-0000-0000-0000000000a1', 'pm-a@grvi.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00830000-0000-0000-0000-0000000000a1', '00830000-0000-0000-0000-000000000001',
   'PM A', 'pm-a@grvi.example', 'Project Manager');

insert into companies (id, org_id, name, type) values
  ('00830000-0000-0000-0000-000000000050', '00830000-0000-0000-0000-000000000001',
   'Vendor A', 'Vendor');

insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00830000-0000-0000-0000-000000000010', '00830000-0000-0000-0000-000000000001',
   'GR-VI-Ref Test', 'Ordered', '00830000-0000-0000-0000-0000000000a1');

-- ── AC-PR-LEDGER-016: procurement_receipts.reference_number exists and is nullable ──

select has_column('public', 'procurement_receipts', 'reference_number',
  'AC-PR-LEDGER-016: procurement_receipts.reference_number column exists');

select col_is_null('public', 'procurement_receipts', 'reference_number',
  'AC-PR-LEDGER-016: procurement_receipts.reference_number is nullable');

-- GR row with reference_number persists
insert into procurement_receipts
  (id, org_id, procurement_id, gr_number, status, receipt_date, reference_number)
values
  ('00830000-0000-0000-0000-0000000000b1',
   '00830000-0000-0000-0000-000000000001',
   '00830000-0000-0000-0000-000000000010',
   'GR-TEST-0001', 'Complete', current_date,
   'DN-TEST-0042');

select results_eq(
  $$ select reference_number from procurement_receipts
     where id = '00830000-0000-0000-0000-0000000000b1' $$,
  $$ values ('DN-TEST-0042'::text) $$,
  'AC-PR-LEDGER-016: GR.reference_number persists delivery-note value');

-- GR row with null reference_number also persists (no NOT NULL constraint)
insert into procurement_receipts
  (id, org_id, procurement_id, gr_number, status, receipt_date, reference_number)
values
  ('00830000-0000-0000-0000-0000000000b2',
   '00830000-0000-0000-0000-000000000001',
   '00830000-0000-0000-0000-000000000010',
   'GR-TEST-0002', 'Partial', current_date, null);

select results_eq(
  $$ select (reference_number is null)
     from procurement_receipts where id = '00830000-0000-0000-0000-0000000000b2' $$,
  $$ values (true) $$,
  'AC-PR-LEDGER-016: GR.reference_number null persists when not provided');

-- ── AC-PR-LEDGER-017: procurement_invoices.reference_number + amount exist and are nullable ──

select has_column('public', 'procurement_invoices', 'reference_number',
  'AC-PR-LEDGER-017: procurement_invoices.reference_number column exists');

select col_is_null('public', 'procurement_invoices', 'reference_number',
  'AC-PR-LEDGER-017: procurement_invoices.reference_number is nullable');

select has_column('public', 'procurement_invoices', 'amount',
  'AC-PR-LEDGER-017: procurement_invoices.amount column exists');

select col_is_null('public', 'procurement_invoices', 'amount',
  'AC-PR-LEDGER-017: procurement_invoices.amount is nullable');

-- VI row with reference_number + amount persists
insert into procurement_invoices
  (id, org_id, procurement_id, vi_number, status, invoice_date, reference_number, amount)
values
  ('00830000-0000-0000-0000-0000000000c1',
   '00830000-0000-0000-0000-000000000001',
   '00830000-0000-0000-0000-000000000010',
   'VI-TEST-0001', 'Received', current_date,
   'INV-TEST-2291', 478500.00);

select results_eq(
  $$ select reference_number, amount from procurement_invoices
     where id = '00830000-0000-0000-0000-0000000000c1' $$,
  $$ values ('INV-TEST-2291'::text, 478500.00::numeric(14,2)) $$,
  'AC-PR-LEDGER-017: VI.reference_number + amount persist');

-- amount is numeric(14,2)
select col_type_is('public', 'procurement_invoices', 'amount', 'numeric(14,2)',
  'AC-PR-LEDGER-017: procurement_invoices.amount is numeric(14,2)');

select finish();
rollback;
