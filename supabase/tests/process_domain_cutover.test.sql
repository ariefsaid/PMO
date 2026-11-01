-- process_domain_cutover.test.sql
-- ECA-4 (#1601, FR-ECA-030/031, PD-ECA-9) [pgTAP] — OWNS AC-ECA-021 and the DB half of AC-ECA-020.
--   * Employing procurement or expenses is refused while PMO holds Draft records of that domain that the ERP
--     would strand; the refusal names the count. A Submitted or Approved claim does not block.
--   * pre_cutover_procurement(case): the case's first purchase order predates the connection's activated_at.
--   * With procurement employed, a receipt, bill or payment on a pre-cut-over case is still recorded in PMO
--     (OQ-ECA-1 "finish in PMO only"); on a post-cut-over case the shipped refusal stands.
--   * The revenue take-over guard (0275 §7) is regression-covered by 0275_native_revenue_crossing.test.sql.
begin;
select plan(27);

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

-- The connection of org A went live on 2026-06-01.
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, version_major, config, activated_at) values
  ('04810000-0000-0000-0000-000000000001', 'erpnext', 'https://synthetic.invalid', 'fixture', 16, '{"company":"ECA4 Co"}', '2026-06-01T00:00:00Z');

-- Cases (none Draft, so employing is not blocked by them): pre = PO before the connection, post = PO after,
-- nopo = no PO yet, other = org B's.
insert into procurements (id, org_id, code, title, status) values
  ('04810000-0000-0000-0000-0000000000c1', '04810000-0000-0000-0000-000000000001', 'ECA4-PRE',  'Ordered before the connection', 'Ordered'),
  ('04810000-0000-0000-0000-0000000000c2', '04810000-0000-0000-0000-000000000001', 'ECA4-POST', 'Ordered after the connection',  'Ordered'),
  ('04810000-0000-0000-0000-0000000000c3', '04810000-0000-0000-0000-000000000001', 'ECA4-NOPO', 'No order yet',                  'Approved'),
  ('04810000-0000-0000-0000-0000000000c4', '04810000-0000-0000-0000-000000000002', 'ECA4-B',    'Org B case',                    'Ordered'),
  ('04810000-0000-0000-0000-0000000000c5', '04810000-0000-0000-0000-000000000001', 'ECA4-DRAFT', 'Open draft',                   'Draft');
insert into purchase_orders (id, org_id, procurement_id, po_number, status, amount, created_at, currency) values
  ('04810000-0000-0000-0000-0000000000d1', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c1', 'PO-PRE',  'Issued', 1000, '2026-05-01T00:00:00Z', 'IDR'),
  ('04810000-0000-0000-0000-0000000000d2', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c2', 'PO-POST', 'Issued', 1000, '2026-07-01T00:00:00Z', 'IDR'),
  ('04810000-0000-0000-0000-0000000000d4', '04810000-0000-0000-0000-000000000002', '04810000-0000-0000-0000-0000000000c4', 'PO-B',    'Issued', 1000, '2026-05-01T00:00:00Z', 'IDR');
-- One bill, one payment and one receipt on each of the pre and post cases (to be updated through the mirror guards).
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency) values
  ('04810000-0000-0000-0000-0000000000e1', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c1', 'VI-PRE',  '2026-05-02', 'Received', 1000, 'exclusive', 0, 'IDR'),
  ('04810000-0000-0000-0000-0000000000e2', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c2', 'VI-POST', '2026-07-02', 'Received', 1000, 'exclusive', 0, 'IDR');
insert into payments (id, org_id, procurement_id, invoice_id, pay_number, status, date, amount, currency) values
  ('04810000-0000-0000-0000-0000000000f1', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c1', '04810000-0000-0000-0000-0000000000e1', 'PAY-PRE',  'Scheduled', '2026-05-03', 100, 'IDR'),
  ('04810000-0000-0000-0000-0000000000f2', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c2', '04810000-0000-0000-0000-0000000000e2', 'PAY-POST', 'Scheduled', '2026-07-03', 100, 'IDR');
insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status) values
  ('04810000-0000-0000-0000-0000000000a9', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c1', 'GR-PRE',  '2026-05-04', 'Partial'),
  ('04810000-0000-0000-0000-0000000000aa', '04810000-0000-0000-0000-000000000001', '04810000-0000-0000-0000-0000000000c2', 'GR-POST', '2026-07-04', 'Partial');
-- Expense claims: one Draft (strands), one Submitted and one Approved (do not).
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, currency) values
  ('04810000-0000-0000-0000-000000000b01', '04810000-0000-0000-0000-000000000001', 'claim', '04810000-0000-0000-0000-0000000000a2', 'Draft claim',     10, 'Draft',     'IDR'),
  ('04810000-0000-0000-0000-000000000b02', '04810000-0000-0000-0000-000000000001', 'claim', '04810000-0000-0000-0000-0000000000a2', 'Submitted claim', 10, 'Submitted', 'IDR'),
  ('04810000-0000-0000-0000-000000000b03', '04810000-0000-0000-0000-000000000001', 'claim', '04810000-0000-0000-0000-0000000000a2', 'Approved claim',  10, 'Approved',  'IDR');

-- ── AC-ECA-021: employing is refused while drafts would be stranded ───────────────────────────────
set local request.jwt.claims = '{}';
select throws_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('04810000-0000-0000-0000-000000000001','erpnext','procurement') $$,
  'P0001', 'submit or cancel the 1 draft(s) in PMO before the ERP takes this over',
  'AC-ECA-021 employing procurement is refused with the count while a purchase draft is open');
select throws_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('04810000-0000-0000-0000-000000000001','erpnext','procurement') $$,
  'P0001', null,
  'AC-ECA-021 the refusal carries the process-drafts-open detail');
select is((select count(*)::int from external_domain_ownership where org_id = '04810000-0000-0000-0000-000000000001'), 0,
  'AC-ECA-021 a refused employ writes no ownership row');
update procurements set status = 'Cancelled' where id = '04810000-0000-0000-0000-0000000000c5';
select lives_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('04810000-0000-0000-0000-000000000001','erpnext','procurement') $$,
  'AC-ECA-021 after the draft is cancelled, procurement can be employed');

select throws_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('04810000-0000-0000-0000-000000000001','erpnext','expenses') $$,
  'P0001', 'submit or cancel the 1 draft(s) in PMO before the ERP takes this over',
  'AC-ECA-021 employing expenses is refused with the count while a claim draft is open (a Submitted and an Approved claim do not count)');
update expense_claims set status = 'Cancelled' where id = '04810000-0000-0000-0000-000000000b01';
select lives_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('04810000-0000-0000-0000-000000000001','erpnext','expenses') $$,
  'AC-ECA-021 expenses can be employed once no claim is a draft, with Submitted and Approved claims left alone');
select lives_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('04810000-0000-0000-0000-000000000002','erpnext','procurement') $$,
  'AC-ECA-021 another org''s drafts are not counted (org B employs freely)');

-- Re-employing a domain the org already employs takes nothing over (admin_change_domain_ownership inserts with
-- on conflict do nothing), so a draft raised since is not refused.
insert into procurements (id, org_id, code, title, status) values
  ('04810000-0000-0000-0000-0000000000c6', '04810000-0000-0000-0000-000000000001', 'ECA4-DRAFT2', 'Draft raised after employing', 'Draft');
select lives_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('04810000-0000-0000-0000-000000000001','erpnext','procurement')
     on conflict (org_id, external_tier, domain) do nothing $$,
  'AC-ECA-021 re-employing a domain the org already employs is not refused for a draft raised since');

-- ── pre_cutover_procurement ───────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"04810000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c1'), true,
  'FR-ECA-030 a case whose first purchase order predates the connection is pre-cut-over');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c2'), false,
  'FR-ECA-030 a case ordered after the connection is not pre-cut-over');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c3'), false,
  'FR-ECA-030 a case with no purchase order yet is not pre-cut-over');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-0000000000c4'), null,
  'FR-ECA-030 another org''s case answers null (callers fail closed)');
select is(public.pre_cutover_procurement('04810000-0000-0000-0000-00000000dead'), null,
  'FR-ECA-030 an unknown case answers null');

-- ── AC-ECA-020 (DB half): procurement is employed; PMO still records the pre-cut-over purchase ────
select lives_ok(
  $$ select create_procurement_receipt('04810000-0000-0000-0000-0000000000c1', 'Partial'::procurement_receipt_status, '2026-08-01') $$,
  'AC-ECA-020 a receipt on a purchase ordered before the connection is recorded in PMO');
select throws_ok(
  $$ select create_procurement_receipt('04810000-0000-0000-0000-0000000000c2', 'Partial'::procurement_receipt_status, '2026-08-01') $$,
  '42501', null,
  'AC-ECA-020 a receipt on a purchase ordered after the connection is still refused (it goes through the ERP)');
select throws_ok(
  $$ select create_procurement_receipt('04810000-0000-0000-0000-0000000000c3', 'Partial'::procurement_receipt_status, '2026-08-01') $$,
  '42501', null,
  'AC-ECA-020 a receipt on a case with no order yet is still refused');
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
select throws_ok(
  $$ select create_payment('04810000-0000-0000-0000-0000000000c2', '04810000-0000-0000-0000-0000000000e2', 'PAY-REF', 'Scheduled', '2026-08-01', 100) $$,
  '42501', null,
  'AC-ECA-020 a payment on a purchase ordered after the connection is still refused');

-- The three native-mirror guards: the same pair. Run as the table owner with the user's claims, since the
-- user role holds no update grant on these tables; the guard looks only at the claims.
reset role;
set local request.jwt.claims = '{"sub":"04810000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update procurement_receipts set status = 'Complete' where id = '04810000-0000-0000-0000-0000000000a9' $$,
  'AC-ECA-020 a receipt of a pre-cut-over purchase can still be updated in PMO (mirror guard)');
select throws_ok(
  $$ update procurement_receipts set status = 'Complete' where id = '04810000-0000-0000-0000-0000000000aa' $$,
  '42501', null,
  'AC-ECA-020 a receipt of a post-cut-over purchase stays read-only (mirror guard)');
select lives_ok(
  $$ update procurement_invoices set status = 'Scheduled' where id = '04810000-0000-0000-0000-0000000000e1' $$,
  'AC-ECA-020 a bill of a pre-cut-over purchase can still be updated in PMO (mirror guard)');
select throws_ok(
  $$ update procurement_invoices set status = 'Scheduled' where id = '04810000-0000-0000-0000-0000000000e2' $$,
  '42501', null,
  'AC-ECA-020 a bill of a post-cut-over purchase stays read-only (mirror guard)');
select lives_ok(
  $$ update payments set status = 'Paid' where id = '04810000-0000-0000-0000-0000000000f1' $$,
  'AC-ECA-020 a payment of a pre-cut-over purchase can still be updated in PMO (mirror guard)');
select throws_ok(
  $$ update payments set status = 'Paid' where id = '04810000-0000-0000-0000-0000000000f2' $$,
  '42501', null,
  'AC-ECA-020 a payment of a post-cut-over purchase stays read-only (mirror guard)');

-- ── grants unchanged ──────────────────────────────────────────────────────────────────────────────
select ok(
  has_function_privilege('authenticated', 'public.create_procurement_receipt(uuid,procurement_receipt_status,date,text,text,uuid,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.create_procurement_receipt(uuid,procurement_receipt_status,date,text,text,uuid,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.pre_cutover_procurement(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.pre_cutover_procurement(uuid)', 'execute'),
  'grants: the receipt RPC and the cut-over check are callable by signed-in users, never by anon');

select finish();
rollback;
