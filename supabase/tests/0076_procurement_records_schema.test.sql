-- 0076_procurement_records_schema.test.sql — Schema shape + 1:N + RFQ→Quotation + business-date
-- Encodes: AC-PR-001 / AC-PR-028 / AC-PR-002 / AC-PR-003 / AC-PR-006 / AC-PR-032
-- Tables tested: purchase_requests, rfqs, purchase_orders, payments
-- Column adds tested: procurement_receipts.po_id, procurement_invoices.po_id,
--                     procurement_quotations.rfq_id, procurement_quotations.valid_until
begin;
select plan(42);

-- ── Fixtures (table owner — bypasses RLS) ────────────────────────────────────
insert into organizations (id, name) values
  ('00760000-0000-0000-0000-000000000001', 'PR-Schema Org A');

insert into auth.users (id, email) values
  ('00760000-0000-0000-0000-0000000000a1', 'pm-a@prschema.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00760000-0000-0000-0000-0000000000a1', '00760000-0000-0000-0000-000000000001',
   'PM A', 'pm-a@prschema.example', 'Project Manager');

insert into companies (id, org_id, name, type) values
  ('00760000-0000-0000-0000-000000000050', '00760000-0000-0000-0000-000000000001',
   'Vendor A', 'Vendor');

insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00760000-0000-0000-0000-000000000010', '00760000-0000-0000-0000-000000000001',
   'Schema Test PR', 'Draft', '00760000-0000-0000-0000-0000000000a1');

-- ── AC-PR-001: four tables exist with required columns ───────────────────────

-- purchase_requests columns
select has_table('public', 'purchase_requests', 'AC-PR-001: table purchase_requests exists');
select has_column('public', 'purchase_requests', 'id',               'AC-PR-001: purchase_requests.id');
select has_column('public', 'purchase_requests', 'org_id',           'AC-PR-001: purchase_requests.org_id');
select col_not_null('public', 'purchase_requests', 'org_id',         'AC-PR-001: purchase_requests.org_id not null');
select has_column('public', 'purchase_requests', 'procurement_id',   'AC-PR-001: purchase_requests.procurement_id');
select col_not_null('public', 'purchase_requests', 'procurement_id', 'AC-PR-001: purchase_requests.procurement_id not null');
select has_column('public', 'purchase_requests', 'pr_number',        'AC-PR-001: purchase_requests.pr_number');
select has_column('public', 'purchase_requests', 'reference_number', 'AC-PR-001: purchase_requests.reference_number');
select col_is_null('public', 'purchase_requests', 'reference_number','AC-PR-001: purchase_requests.reference_number nullable');
select has_column('public', 'purchase_requests', 'status',           'AC-PR-001: purchase_requests.status');
select has_column('public', 'purchase_requests', 'date',             'AC-PR-001: purchase_requests.date');
select has_column('public', 'purchase_requests', 'amount',           'AC-PR-001: purchase_requests.amount');
select has_column('public', 'purchase_requests', 'created_at',       'AC-PR-001: purchase_requests.created_at');

-- rfqs columns (spot-check key ones to keep plan count manageable)
select has_table('public', 'rfqs',               'AC-PR-001: table rfqs exists');
select has_column('public', 'rfqs', 'rfq_number',       'AC-PR-001: rfqs.rfq_number');
select has_column('public', 'rfqs', 'reference_number', 'AC-PR-001: rfqs.reference_number');

-- purchase_orders columns (spot-check)
select has_table('public', 'purchase_orders',    'AC-PR-001: table purchase_orders exists');
select has_column('public', 'purchase_orders', 'po_number',         'AC-PR-001: purchase_orders.po_number');

-- payments columns (spot-check)
select has_table('public', 'payments',           'AC-PR-001: table payments exists');
select has_column('public', 'payments', 'pay_number',        'AC-PR-001: payments.pay_number');
select has_column('public', 'payments', 'invoice_id',        'AC-PR-001: payments.invoice_id');

-- FK: purchase_requests.procurement_id → procurements.id
select fk_ok('public', 'purchase_requests', 'procurement_id',
             'public', 'procurements',       'id',
             'AC-PR-001: purchase_requests.procurement_id FK → procurements.id');

-- amount is numeric(14,2) on purchase_requests
select col_type_is('public', 'purchase_requests', 'amount', 'numeric(14,2)',
                   'AC-PR-001: purchase_requests.amount is numeric(14,2)');

-- ── AC-PR-028: procurement_id not null on all four; settlement FKs nullable ──

select col_not_null('public', 'rfqs',           'procurement_id', 'AC-PR-028: rfqs.procurement_id not null');
select col_not_null('public', 'purchase_orders','procurement_id', 'AC-PR-028: purchase_orders.procurement_id not null');
select col_not_null('public', 'payments',       'procurement_id', 'AC-PR-028: payments.procurement_id not null');

select has_column('public', 'procurement_receipts', 'po_id', 'AC-PR-028: procurement_receipts.po_id exists');
select col_is_null('public', 'procurement_receipts', 'po_id','AC-PR-028: procurement_receipts.po_id nullable');

select has_column('public', 'procurement_invoices', 'po_id', 'AC-PR-028: procurement_invoices.po_id exists');
select col_is_null('public', 'procurement_invoices', 'po_id','AC-PR-028: procurement_invoices.po_id nullable');

select col_is_null('public', 'payments', 'invoice_id',        'AC-PR-028: payments.invoice_id nullable');

-- ── AC-PR-006: quotation seam columns exist and are nullable ─────────────────
select has_column('public', 'procurement_quotations', 'rfq_id',     'AC-PR-006: procurement_quotations.rfq_id exists');
select col_is_null('public', 'procurement_quotations', 'rfq_id',    'AC-PR-006: procurement_quotations.rfq_id nullable');
select has_column('public', 'procurement_quotations', 'valid_until', 'AC-PR-006: procurement_quotations.valid_until exists');
select col_is_null('public', 'procurement_quotations', 'valid_until','AC-PR-006: procurement_quotations.valid_until nullable');

-- ── AC-PR-002: 1:N — two purchase_orders + two payments + two receipts under one case ─
-- Insert as table owner (bypasses RLS)
insert into purchase_orders (id, org_id, procurement_id, po_number, status) values
  ('00760000-0000-0000-0000-0000000000b1', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', 'PO-001', 'Draft'),
  ('00760000-0000-0000-0000-0000000000b2', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', 'PO-002', 'Draft');

insert into payments (id, org_id, procurement_id, pay_number, status) values
  ('00760000-0000-0000-0000-0000000000c1', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', 'PAY-001', 'Scheduled'),
  ('00760000-0000-0000-0000-0000000000c2', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', 'PAY-002', 'Scheduled');

insert into procurement_receipts (id, org_id, procurement_id, status, receipt_date) values
  ('00760000-0000-0000-0000-0000000000d1', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', 'Partial', '2026-06-01'),
  ('00760000-0000-0000-0000-0000000000d2', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', 'Complete', '2026-06-02');

select results_eq(
  $$ select count(*)::int from purchase_orders
     where procurement_id = '00760000-0000-0000-0000-000000000010' $$,
  $$ values (2) $$,
  'AC-PR-002: two purchase_orders under one case');

select results_eq(
  $$ select count(*)::int from payments
     where procurement_id = '00760000-0000-0000-0000-000000000010' $$,
  $$ values (2) $$,
  'AC-PR-002: two payments under one case');

select results_eq(
  $$ select count(*)::int from procurement_receipts
     where procurement_id = '00760000-0000-0000-0000-000000000010' $$,
  $$ values (2) $$,
  'AC-PR-002: two procurement_receipts under one case');

-- ── AC-PR-003: RFQ→Quotation 1:N ─────────────────────────────────────────────
insert into rfqs (id, org_id, procurement_id, rfq_number, status) values
  ('00760000-0000-0000-0000-0000000000e1', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', 'RFQ-001', 'Draft');

insert into procurement_quotations
  (id, org_id, procurement_id, vendor_id, total_amount, received_date, rfq_id) values
  ('00760000-0000-0000-0000-0000000000f1', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', '00760000-0000-0000-0000-000000000050',
   1000, '2026-06-01', '00760000-0000-0000-0000-0000000000e1'),
  ('00760000-0000-0000-0000-0000000000f2', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', '00760000-0000-0000-0000-000000000050',
   2000, '2026-06-02', '00760000-0000-0000-0000-0000000000e1');

-- third quotation with rfq_id null also persists
insert into procurement_quotations
  (id, org_id, procurement_id, vendor_id, total_amount, received_date) values
  ('00760000-0000-0000-0000-0000000000f3', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', '00760000-0000-0000-0000-000000000050',
   3000, '2026-06-03');

select results_eq(
  $$ select count(*)::int from procurement_quotations
     where rfq_id = '00760000-0000-0000-0000-0000000000e1' $$,
  $$ values (2) $$,
  'AC-PR-003: two quotations cite the RFQ via rfq_id');

select results_eq(
  $$ select count(*)::int from procurement_quotations
     where procurement_id = '00760000-0000-0000-0000-000000000010' and rfq_id is null $$,
  $$ values (1) $$,
  'AC-PR-003: one quotation with rfq_id null also persists under the case');

-- ── AC-PR-032: business date ≠ created_at ────────────────────────────────────
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date) values
  ('00760000-0000-0000-0000-0000000000b9', '00760000-0000-0000-0000-000000000001',
   '00760000-0000-0000-0000-000000000010', 'PO-BDATE', 'Draft',
   (current_date - 5));

select results_eq(
  $$ select date = (current_date - 5)
     from purchase_orders where id = '00760000-0000-0000-0000-0000000000b9' $$,
  $$ values (true) $$,
  'AC-PR-032: purchase_orders.date persists as prior business date');

select results_eq(
  $$ select (created_at::date = current_date) and (date <> created_at::date)
     from purchase_orders where id = '00760000-0000-0000-0000-0000000000b9' $$,
  $$ values (true) $$,
  'AC-PR-032: created_at is today; date (5 days ago) differs from created_at::date');

select finish();
rollback;
