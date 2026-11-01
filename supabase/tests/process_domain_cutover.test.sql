-- process_domain_cutover.test.sql
-- ECA-4 (#1601, FR-ECA-030, PD-ECA-9) [pgTAP] — OWNS the DB half of AC-ECA-020.
--   * pre_cutover_procurement(case[, bill]): the purchase's first document PMO made itself (order, receipt or bill)
--     predates the cut-over instant, the LATER of the connection's activated_at and the procurement employ time. Rows the
--     ERP holds (erp_docstatus set) do not count, and a bill the ERP holds is paid in the ERP.
--   * With procurement employed, a receipt, bill or payment on a pre-cut-over case is still recorded in PMO
--     (OQ-ECA-1 "finish in PMO only"); on a post-cut-over case the shipped refusal stands.
--   * The native-mirror guards exempt only rows PMO made itself, so an ERP row on a pre-cut-over case stays read-only.
--   * The revenue take-over guard (0275 §7) is regression-covered by 0275_native_revenue_crossing.test.sql.
begin;
select plan(34);

insert into organizations (id, name) values
  ('04810000-0000-0000-0000-000000000001', 'ECA-4 Org A'),
  ('04810000-0000-0000-0000-000000000002', 'ECA-4 Org B');
insert into auth.users (id, email) values
  ('04810000-0000-0000-0000-0000000000a1', 'eca4-a-admin@example.com'),
  ('04810000-0000-0000-0000-0000000000a2', 'eca4-a-eng@example.com'),
  ('04810000-0000-0000-0000-0000000000b1', 'eca4-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04810000-0000-0000-0000-0000000000a1', '04810000-0000-0000-0000-000000000001', 'A Admin', 'eca4-a-admin@example.com', 'Admin', 'active'),
  ('04810000-0000-0000-0000-0000000000a2', '04810000-0000-0000-0000-000000000001', 'A Engineer', 'eca4-a-eng@example.com', 'Engineer', 'active'),
  ('04810000-0000-0000-0000-0000000000b1', '04810000-0000-0000-0000-000000000002', 'B Admin', 'eca4-b-admin@example.com', 'Admin', 'active');

-- The connection of org A went live on 2026-06-01; it employed procurement later, on 2026-07-15.
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, version_major, config, activated_at) values
  ('04810000-0000-0000-0000-000000000001', 'erpnext', 'https://synthetic.invalid', 'fixture', 16, '{"company":"ECA4 Co"}', '2026-06-01T00:00:00Z');

-- Cases: pre = PO before the connection (requested by the engineer), between = PO after the connection but before
-- procurement was employed, post = PO after both, nopo = nothing yet, billfirst = a PMO bill and no PO, erpbill = a
-- PMO order plus bill, receipt and payment the ERP holds, pushed = a PO the ERP holds, other = org B's.
insert into procurements (id, org_id, code, title, status, requested_by_id) values
  ('04810000-0000-0000-0000-0000000000c1', '04810000-0000-0000-0000-000000000001', 'ECA4-PRE',   'Ordered before the connection', 'Ordered', '04810000-0000-0000-0000-0000000000a2'),
  ('04810000-0000-0000-0000-0000000000c2', '04810000-0000-0000-0000-000000000001', 'ECA4-POST',  'Ordered after employing',       'Ordered', null),
  ('04810000-0000-0000-0000-0000000000c3', '04810000-0000-0000-0000-000000000001', 'ECA4-NOPO',  'No order yet',                  'Approved', null),
  ('04810000-0000-0000-0000-0000000000c4', '04810000-0000-0000-0000-000000000002', 'ECA4-B',     'Org B case',                    'Ordered', null),
  ('04810000-0000-0000-0000-0000000000c7', '04810000-0000-0000-0000-000000000001', 'ECA4-BETW',  'Ordered between connect and employ', 'Ordered', null),
  ('04810000-0000-0000-0000-0000000000c8', '04810000-0000-0000-0000-000000000001', 'ECA4-BILL1', 'Bill first, no order',          'Approved', null),
  ('04810000-0000-0000-0000-0000000000c9', '04810000-0000-0000-0000-000000000001', 'ECA4-ERPB',  'Order in PMO, bill in the ERP', 'Ordered', null),
  ('04810000-0000-0000-0000-0000000000ca', '04810000-0000-0000-0000-000000000001', 'ECA4-PUSH',  'Order the ERP holds',           'Ordered', null);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, amount, created_at, currency, erp_docstatus) values
  ('04810000-0000-0000-0000-0000000000d1', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c1', 'PO-PRE',  'Issued', 1000, '2026-05-01T00:00:00Z', 'IDR', null),
  ('04810000-0000-0000-0000-0000000000d2', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c2', 'PO-POST', 'Issued', 1000, '2026-08-01T00:00:00Z', 'IDR', null),
  ('04810000-0000-0000-0000-0000000000d4', '04810000-0000-0000-0000-000000000002', '04810000-0000-0000-0000-0000000000c4', 'PO-B',    'Issued', 1000, '2026-05-01T00:00:00Z', 'IDR', null),
  ('04810000-0000-0000-0000-0000000000d7', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c7', 'PO-BETW', 'Issued', 1000, '2026-07-01T00:00:00Z', 'IDR', null),
  ('04810000-0000-0000-0000-0000000000d9', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c9', 'PO-ERPB', 'Issued', 1000, '2026-05-01T00:00:00Z', 'IDR', null),
  ('04810000-0000-0000-0000-0000000000da', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000ca', 'PO-PUSH', 'Issued', 1000, '2026-05-01T00:00:00Z', 'IDR', 1);
-- Bills, payments and receipts (to be updated through the mirror guards). e9 / f9 / a99 are the ERP's.
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency, created_at, erp_docstatus) values
  ('04810000-0000-0000-0000-0000000000e1', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c1', 'VI-PRE',   '2026-05-02', 'Received', 1000, 'exclusive', 0, 'IDR', '2026-05-02T00:00:00Z', null),
  ('04810000-0000-0000-0000-0000000000e2', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c2', 'VI-POST',  '2026-08-02', 'Received', 1000, 'exclusive', 0, 'IDR', '2026-08-02T00:00:00Z', null),
  ('04810000-0000-0000-0000-0000000000e8', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c8', 'VI-BILL1', '2026-05-20', 'Received', 1000, 'exclusive', 0, 'IDR', '2026-05-20T00:00:00Z', null),
  ('04810000-0000-0000-0000-0000000000e9', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c9', 'VI-ERP',   '2026-08-05', 'Received', 1000, 'inclusive', 0, 'IDR', '2026-08-05T00:00:00Z', 1),
  ('04810000-0000-0000-0000-0000000000ea', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c9', 'VI-NAT',   '2026-05-02', 'Received', 1000, 'exclusive', 0, 'IDR', '2026-05-02T00:00:00Z', null);
insert into payments (id, org_id, procurement_id, invoice_id, pay_number, status, date, amount, currency, erp_docstatus) values
  ('04810000-0000-0000-0000-0000000000f1', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c1', '04810000-0000-0000-0000-0000000000e1', 'PAY-PRE',  'Scheduled', '2026-05-03', 100, 'IDR', null),
  ('04810000-0000-0000-0000-0000000000f2', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c2', '04810000-0000-0000-0000-0000000000e2', 'PAY-POST', 'Scheduled', '2026-08-03', 100, 'IDR', null),
  ('04810000-0000-0000-0000-0000000000f9', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c9', '04810000-0000-0000-0000-0000000000e9', 'PAY-ERP',  'Scheduled', '2026-08-06', 100, 'IDR', 1);
insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status, created_at, erp_docstatus) values
  ('04810000-0000-0000-0000-0000000000a9', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c1', 'GR-PRE',  '2026-05-04', 'Partial', '2026-05-04T00:00:00Z', null),
  ('04810000-0000-0000-0000-0000000000aa', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c2', 'GR-POST', '2026-08-04', 'Partial', '2026-08-04T00:00:00Z', null),
  ('04810000-0000-0000-0000-0000000000ab', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c9', 'GR-ERP',  '2026-08-07', 'Partial', '2026-08-07T00:00:00Z', 1);

-- ── pre_cutover_procurement ───────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"04810000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c1'), false,
  'FR-ECA-030 before procurement is employed there is no cut-over instant, so nothing is pre-cut-over');
reset role;
insert into external_domain_ownership (org_id, external_tier, domain, created_at) values
  ('04810000-0000-0000-0000-000000000001','erpnext','procurement','2026-07-15T00:00:00Z'),
  ('04810000-0000-0000-0000-000000000002','erpnext','procurement','2026-07-15T00:00:00Z');
set local role authenticated;
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c1'), true,
  'FR-ECA-030 a case whose first purchase order predates the connection is pre-cut-over');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c7'), true,
  'FR-ECA-030 a case ordered after the connection but before procurement was employed is pre-cut-over (the later instant)');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c2'), false,
  'FR-ECA-030 a case ordered after the connection and the employ is not pre-cut-over');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c3'), false,
  'FR-ECA-030 a case with no document yet is not pre-cut-over');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c8'), true,
  'FR-ECA-030 a case whose first document is a bill captured before the connection (no order) is pre-cut-over');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000ca'), false,
  'FR-ECA-030 an order the ERP holds is not a pre-cut-over document');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c9'), true,
  'FR-ECA-030 a PMO order before the connection stays pre-cut-over though the ERP later holds a bill on it');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c9', '04810000-0000-0000-0000-0000000000e9'), false,
  'FR-ECA-030 a bill the ERP holds is paid in the ERP: that payment is not pre-cut-over');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c9', '04810000-0000-0000-0000-0000000000ea'), true,
  'FR-ECA-030 a bill PMO made itself on the same case is still paid in PMO');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c1', '04810000-0000-0000-0000-0000000000e9'), true,
  'FR-ECA-030 a bill of another case does not change this case''s answer');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c4'), null,
  'FR-ECA-030 another org''s case answers null (callers fail closed)');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-00000000dead'), null,
  'FR-ECA-030 an unknown case answers null');

-- ── AC-ECA-020 (DB half): procurement is employed; PMO still records the pre-cut-over purchase ────
reset role;
set local request.jwt.claims = '{"sub":"04810000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$ select create_procurement_receipt('04810000-0000-0000-0000-0000000000c1', 'Partial'::procurement_receipt_status, '2026-08-01') $$,
  'AC-ECA-020 the requester records a receipt on a purchase ordered before the connection in PMO');
reset role;
set local request.jwt.claims = '{"sub":"04810000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$ select create_procurement_receipt('04810000-0000-0000-0000-0000000000c7', 'Partial'::procurement_receipt_status, '2026-08-01') $$,
  'AC-ECA-020 a receipt on a purchase ordered between connecting and employing is recorded in PMO');
select throws_ok(
  $$ select create_procurement_receipt('04810000-0000-0000-0000-0000000000c2', 'Partial'::procurement_receipt_status, '2026-08-01') $$,
  '42501', null,
  'AC-ECA-020 a receipt on a purchase ordered after the connection is still refused (it goes through the ERP)');
select throws_ok(
  $$ select create_procurement_receipt('04810000-0000-0000-0000-0000000000c3', 'Partial'::procurement_receipt_status, '2026-08-01') $$,
  '42501', null,
  'AC-ECA-020 a receipt on a case with no document yet is still refused');
select lives_ok(
  $$ select create_procurement_invoice('04810000-0000-0000-0000-0000000000c1', 'Received'::procurement_invoice_status, '2026-08-01', 'BILL-PRE', 100,
       p_tax_treatment => 'exclusive', p_tax_amount => 0) $$,
  'AC-ECA-020 a bill on a purchase ordered before the connection is recorded in PMO');
select throws_ok(
  $$ select create_procurement_invoice('04810000-0000-0000-0000-0000000000c2', 'Received'::procurement_invoice_status, '2026-08-01', 'BILL-POST', 100,
       p_tax_treatment => 'exclusive', p_tax_amount => 0) $$,
  '42501', null,
  'AC-ECA-020 a bill on a purchase ordered after the connection is still refused');
select lives_ok(
  $$ select create_payment('04810000-0000-0000-0000-0000000000c1', '04810000-0000-0000-0000-0000000000e1', 'PAY-REF', 'Scheduled', '2026-08-01', 100) $$,
  'AC-ECA-020 a payment on a purchase ordered before the connection is recorded in PMO');
select lives_ok(
  $$ select create_payment('04810000-0000-0000-0000-0000000000c8', '04810000-0000-0000-0000-0000000000e8', 'PAY-REF', 'Scheduled', '2026-08-01', 100) $$,
  'AC-ECA-020 a bill captured before the connection with no order can be paid in PMO');
select throws_ok(
  $$ select create_payment('04810000-0000-0000-0000-0000000000c9', '04810000-0000-0000-0000-0000000000e9', 'PAY-REF', 'Scheduled', '2026-08-08', 100) $$,
  '42501', null,
  'AC-ECA-020 a bill the ERP holds is not paid in PMO even on a pre-cut-over purchase');
select lives_ok(
  $$ select create_payment('04810000-0000-0000-0000-0000000000c9', '04810000-0000-0000-0000-0000000000ea', 'PAY-REF', 'Scheduled', '2026-08-08', 100) $$,
  'AC-ECA-020 a bill PMO made itself on that purchase is paid in PMO');
select throws_ok(
  $$ select create_payment('04810000-0000-0000-0000-0000000000c2', '04810000-0000-0000-0000-0000000000e2', 'PAY-REF', 'Scheduled', '2026-08-01', 100) $$,
  '42501', null,
  'AC-ECA-020 a payment on a purchase ordered after the connection is still refused');

-- The three native-mirror guards: the same pair, and rows the ERP holds stay read-only on a pre-cut-over purchase.
-- Run as the table owner with the user's claims, since the user role holds no update grant on these tables.
reset role;
set local request.jwt.claims = '{"sub":"04810000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update procurement_receipts set status = 'Complete' where id = '04810000-0000-0000-0000-0000000000a9' $$,
  'AC-ECA-020 a receipt of a pre-cut-over purchase can still be updated in PMO (mirror guard)');
select throws_ok(
  $$ update procurement_receipts set status = 'Complete' where id = '04810000-0000-0000-0000-0000000000aa' $$,
  '42501', null,
  'AC-ECA-020 a receipt of a post-cut-over purchase stays read-only (mirror guard)');
select throws_ok(
  $$ update procurement_receipts set status = 'Complete' where id = '04810000-0000-0000-0000-0000000000ab' $$,
  '42501', null,
  'AC-ECA-020 a receipt the ERP holds stays read-only even on a pre-cut-over purchase (mirror guard)');
select lives_ok(
  $$ update procurement_invoices set status = 'Scheduled' where id = '04810000-0000-0000-0000-0000000000e1' $$,
  'AC-ECA-020 a bill of a pre-cut-over purchase can still be updated in PMO (mirror guard)');
select throws_ok(
  $$ update procurement_invoices set status = 'Scheduled' where id = '04810000-0000-0000-0000-0000000000e2' $$,
  '42501', null,
  'AC-ECA-020 a bill of a post-cut-over purchase stays read-only (mirror guard)');
select throws_ok(
  $$ update procurement_invoices set status = 'Scheduled' where id = '04810000-0000-0000-0000-0000000000e9' $$,
  '42501', null,
  'AC-ECA-020 a bill the ERP holds stays read-only even on a pre-cut-over purchase (mirror guard)');
select lives_ok(
  $$ update payments set status = 'Paid' where id = '04810000-0000-0000-0000-0000000000f1' $$,
  'AC-ECA-020 a payment of a pre-cut-over purchase can still be updated in PMO (mirror guard)');
select throws_ok(
  $$ update payments set status = 'Paid' where id = '04810000-0000-0000-0000-0000000000f2' $$,
  '42501', null,
  'AC-ECA-020 a payment of a post-cut-over purchase stays read-only (mirror guard)');
select throws_ok(
  $$ update payments set status = 'Paid' where id = '04810000-0000-0000-0000-0000000000f9' $$,
  '42501', null,
  'AC-ECA-020 a payment the ERP holds stays read-only even on a pre-cut-over purchase (mirror guard)');

-- ── grants unchanged ──────────────────────────────────────────────────────────────────────────────
select ok(
  has_function_privilege('authenticated', 'public.create_procurement_receipt(uuid,procurement_receipt_status,date,text,text,uuid,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric,text)', 'execute')
  and has_function_privilege('authenticated', 'public.create_payment(uuid,uuid,text,text,date,numeric,text,uuid,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.pre_cutover_procurement(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.create_procurement_receipt(uuid,procurement_receipt_status,date,text,text,uuid,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric,text)', 'execute')
  and not has_function_privilege('anon', 'public.create_payment(uuid,uuid,text,text,date,numeric,text,uuid,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.pre_cutover_procurement(uuid,uuid)', 'execute'),
  'grants: the three record RPCs and the cut-over check are callable by signed-in users, never by anon');

select finish();
rollback;
