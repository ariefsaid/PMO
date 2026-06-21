-- 0082_same_case_invariant.test.sql
-- Security hardening: cross-case settlement FK invariant.
-- Migration under test: 0039_same_case_fk_invariant.sql
--
-- AC-PR-SEC-001a create_payment with cross-ORG invoice_id → 42501 (existence oracle closed)
-- AC-PR-SEC-001b create_payment with cross-CASE (same-org) invoice_id → 42501
-- AC-PR-SEC-002  direct insert procurement_receipts.po_id pointing to other-case PO → 42501
-- AC-PR-SEC-003  direct insert procurement_invoices.po_id pointing to other-case PO → 42501
-- AC-PR-SEC-004  direct insert procurement_quotations.rfq_id pointing to other-case RFQ → 42501
-- AC-PR-SEC-005  same-case create_payment(invoice_id) → lives_ok (regression AC-PR-029)
-- AC-PR-SEC-006  same-case procurement_receipts.po_id → lives_ok (regression AC-PR-030)
-- AC-PR-SEC-007  same-case procurement_invoices.po_id → lives_ok (regression AC-PR-030)
-- AC-PR-SEC-008  same-case procurement_quotations.rfq_id → lives_ok (regression AC-PR-031)
-- AC-PR-SEC-009  update procurement_receipts.po_id to cross-case PO → 42501
-- AC-PR-SEC-010  update procurement_invoices.po_id to cross-case PO → 42501
-- AC-PR-SEC-011  update procurement_quotations.rfq_id to cross-case RFQ → 42501
begin;
select plan(12);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Two orgs, two cases per org to cover both cross-org AND cross-case scenarios.

insert into organizations (id, name) values
  ('00820000-0000-0000-0000-000000000001', 'Sec Org A'),
  ('00820000-0000-0000-0000-000000000002', 'Sec Org B');

insert into auth.users (id, email) values
  ('00820000-0000-0000-0000-0000000000a1', 'pm-sec@example.com'),
  ('00820000-0000-0000-0000-0000000000b1', 'pm-sec-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00820000-0000-0000-0000-0000000000a1','00820000-0000-0000-0000-000000000001',
   'PM SecA','pm-sec@example.com','Project Manager'),
  ('00820000-0000-0000-0000-0000000000b1','00820000-0000-0000-0000-000000000002',
   'PM SecB','pm-sec-b@example.com','Project Manager');

-- Org A: Case 1 and Case 2 (cross-CASE, same-org scenario)
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00820000-0000-0000-0000-000000000010','00820000-0000-0000-0000-000000000001',
   'Sec Case A1','Draft','00820000-0000-0000-0000-0000000000a1'),
  ('00820000-0000-0000-0000-000000000011','00820000-0000-0000-0000-000000000001',
   'Sec Case A2','Draft','00820000-0000-0000-0000-0000000000a1');

-- Org B: Case 1 (cross-ORG scenario)
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00820000-0000-0000-0000-000000000020','00820000-0000-0000-0000-000000000002',
   'Sec Case B1','Draft','00820000-0000-0000-0000-0000000000b1');

-- Org A: predecessor records under Case A1
insert into rfqs (id, org_id, procurement_id, rfq_number, status) values
  ('00820000-0000-0000-0000-000000000030','00820000-0000-0000-0000-000000000001',
   '00820000-0000-0000-0000-000000000010','RFQ-SEC-001','Issued');

insert into purchase_orders (id, org_id, procurement_id, po_number, status) values
  ('00820000-0000-0000-0000-000000000040','00820000-0000-0000-0000-000000000001',
   '00820000-0000-0000-0000-000000000010','PO-SEC-001','Issued');

insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date) values
  ('00820000-0000-0000-0000-000000000050','00820000-0000-0000-0000-000000000001',
   '00820000-0000-0000-0000-000000000010','Received','2026-06-19');

-- Org B: predecessor records under Case B1 (cross-org attack targets)
insert into rfqs (id, org_id, procurement_id, rfq_number, status) values
  ('00820000-0000-0000-0000-000000000031','00820000-0000-0000-0000-000000000002',
   '00820000-0000-0000-0000-000000000020','RFQ-SEC-B01','Issued');

insert into purchase_orders (id, org_id, procurement_id, po_number, status) values
  ('00820000-0000-0000-0000-000000000041','00820000-0000-0000-0000-000000000002',
   '00820000-0000-0000-0000-000000000020','PO-SEC-B01','Issued');

insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date) values
  ('00820000-0000-0000-0000-000000000051','00820000-0000-0000-0000-000000000002',
   '00820000-0000-0000-0000-000000000020','Received','2026-06-19');

-- Org A: Case A2 predecessor records (cross-CASE attack targets — same org, different case)
insert into rfqs (id, org_id, procurement_id, rfq_number, status) values
  ('00820000-0000-0000-0000-000000000032','00820000-0000-0000-0000-000000000001',
   '00820000-0000-0000-0000-000000000011','RFQ-SEC-A2','Issued');

insert into purchase_orders (id, org_id, procurement_id, po_number, status) values
  ('00820000-0000-0000-0000-000000000042','00820000-0000-0000-0000-000000000001',
   '00820000-0000-0000-0000-000000000011','PO-SEC-A2','Issued');

insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date) values
  ('00820000-0000-0000-0000-000000000052','00820000-0000-0000-0000-000000000001',
   '00820000-0000-0000-0000-000000000011','Received','2026-06-19');

-- ── AC-PR-SEC-001: create_payment with cross-case invoice_id → 42501 ──────────
-- Org-A PM calls create_payment(Case A1, invoice from Case B1) — cross-org.
-- The RPC guard must catch this BEFORE the FK insert (existence oracle closed).

set local role authenticated;
set local request.jwt.claims = '{"sub":"00820000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select create_payment(
       '00820000-0000-0000-0000-000000000010'::uuid,  -- Case A1
       '00820000-0000-0000-0000-000000000051'::uuid,  -- invoice from Case B1 (cross-org)
       null, null, null, null) $$,
  '42501', null,
  'AC-PR-SEC-001: create_payment with cross-org invoice_id → 42501');

reset role;

-- Also prove cross-CASE (same org): Org-A PM links Case A1 payment to Case A2 invoice.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00820000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select create_payment(
       '00820000-0000-0000-0000-000000000010'::uuid,  -- Case A1
       '00820000-0000-0000-0000-000000000052'::uuid,  -- invoice from Case A2 (cross-case, same org)
       null, null, null, null) $$,
  '42501', null,
  'AC-PR-SEC-001: create_payment with cross-case (same-org) invoice_id → 42501');

reset role;

-- ── AC-PR-SEC-002: direct insert procurement_receipts.po_id → cross-case PO → 42501 ─

select throws_ok(
  $$ insert into procurement_receipts (org_id, procurement_id, status, po_id) values
       ('00820000-0000-0000-0000-000000000001',
        '00820000-0000-0000-0000-000000000010',  -- Case A1
        'Partial',
        '00820000-0000-0000-0000-000000000042')  -- PO from Case A2 (cross-case, same org)
  $$,
  '42501', null,
  'AC-PR-SEC-002: insert procurement_receipts with cross-case po_id → 42501');

-- ── AC-PR-SEC-003: direct insert procurement_invoices.po_id → cross-case PO → 42501 ─

select throws_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, po_id) values
       ('00820000-0000-0000-0000-000000000001',
        '00820000-0000-0000-0000-000000000010',  -- Case A1
        'Received', '2026-06-19',
        '00820000-0000-0000-0000-000000000042')  -- PO from Case A2 (cross-case, same org)
  $$,
  '42501', null,
  'AC-PR-SEC-003: insert procurement_invoices with cross-case po_id → 42501');

-- ── AC-PR-SEC-004: direct insert procurement_quotations.rfq_id → cross-case RFQ → 42501 ─

insert into companies (id, org_id, name, type) values
  ('00820000-0000-0000-0000-000000000060','00820000-0000-0000-0000-000000000001',
   'Sec Vendor A','Vendor');

select throws_ok(
  $$ insert into procurement_quotations (org_id, procurement_id, vendor_id, total_amount, received_date, rfq_id) values
       ('00820000-0000-0000-0000-000000000001',
        '00820000-0000-0000-0000-000000000010',  -- Case A1
        '00820000-0000-0000-0000-000000000060',
        1000.00, '2026-06-19',
        '00820000-0000-0000-0000-000000000032')  -- RFQ from Case A2 (cross-case, same org)
  $$,
  '42501', null,
  'AC-PR-SEC-004: insert procurement_quotations with cross-case rfq_id → 42501');

-- ── AC-PR-SEC-005: same-case create_payment(invoice_id) → lives_ok ───────────

set local role authenticated;
set local request.jwt.claims = '{"sub":"00820000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select create_payment(
       '00820000-0000-0000-0000-000000000010'::uuid,  -- Case A1
       '00820000-0000-0000-0000-000000000050'::uuid,  -- invoice from SAME Case A1
       null, null, null, null) $$,
  'AC-PR-SEC-005: create_payment with same-case invoice_id succeeds (regression AC-PR-029)');

reset role;

-- ── AC-PR-SEC-006: same-case procurement_receipts.po_id → lives_ok ───────────

select lives_ok(
  $$ insert into procurement_receipts (org_id, procurement_id, status, po_id) values
       ('00820000-0000-0000-0000-000000000001',
        '00820000-0000-0000-0000-000000000010',  -- Case A1
        'Partial',
        '00820000-0000-0000-0000-000000000040')  -- PO from SAME Case A1
  $$,
  'AC-PR-SEC-006: insert procurement_receipts with same-case po_id succeeds (regression AC-PR-030)');

-- ── AC-PR-SEC-007: same-case procurement_invoices.po_id → lives_ok ───────────

select lives_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, po_id) values
       ('00820000-0000-0000-0000-000000000001',
        '00820000-0000-0000-0000-000000000010',  -- Case A1
        'Received', '2026-06-19',
        '00820000-0000-0000-0000-000000000040')  -- PO from SAME Case A1
  $$,
  'AC-PR-SEC-007: insert procurement_invoices with same-case po_id succeeds (regression AC-PR-030)');

-- ── AC-PR-SEC-008: same-case procurement_quotations.rfq_id → lives_ok ────────

select lives_ok(
  $$ insert into procurement_quotations (org_id, procurement_id, vendor_id, total_amount, received_date, rfq_id) values
       ('00820000-0000-0000-0000-000000000001',
        '00820000-0000-0000-0000-000000000010',  -- Case A1
        '00820000-0000-0000-0000-000000000060',
        2000.00, '2026-06-19',
        '00820000-0000-0000-0000-000000000030')  -- RFQ from SAME Case A1
  $$,
  'AC-PR-SEC-008: insert procurement_quotations with same-case rfq_id succeeds (regression AC-PR-031)');

-- ── AC-PR-SEC-009: UPDATE procurement_receipts.po_id to cross-case → 42501 ───
-- First insert a receipt with po_id null (same-case, valid), then try to update it cross-case.

insert into procurement_receipts (id, org_id, procurement_id, status) values
  ('00820000-0000-0000-0000-000000000070','00820000-0000-0000-0000-000000000001',
   '00820000-0000-0000-0000-000000000010','Complete');

select throws_ok(
  $$ update procurement_receipts
        set po_id = '00820000-0000-0000-0000-000000000042'  -- PO from Case A2 (cross-case)
      where id   = '00820000-0000-0000-0000-000000000070'   -- receipt on Case A1
  $$,
  '42501', null,
  'AC-PR-SEC-009: update procurement_receipts.po_id to cross-case → 42501');

-- ── AC-PR-SEC-010: UPDATE procurement_invoices.po_id to cross-case → 42501 ───

select throws_ok(
  $$ update procurement_invoices
        set po_id = '00820000-0000-0000-0000-000000000042'  -- PO from Case A2 (cross-case)
      where id   = '00820000-0000-0000-0000-000000000050'   -- invoice on Case A1
  $$,
  '42501', null,
  'AC-PR-SEC-010: update procurement_invoices.po_id to cross-case → 42501');

-- ── AC-PR-SEC-011: UPDATE procurement_quotations.rfq_id to cross-case → 42501 ─

-- Insert a quotation with rfq_id null first (same-case, valid)
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, received_date) values
  ('00820000-0000-0000-0000-000000000080','00820000-0000-0000-0000-000000000001',
   '00820000-0000-0000-0000-000000000010',
   '00820000-0000-0000-0000-000000000060',
   500.00, '2026-06-19');

select throws_ok(
  $$ update procurement_quotations
        set rfq_id = '00820000-0000-0000-0000-000000000032'  -- RFQ from Case A2 (cross-case)
      where id    = '00820000-0000-0000-0000-000000000080'   -- quotation on Case A1
  $$,
  '42501', null,
  'AC-PR-SEC-011: update procurement_quotations.rfq_id to cross-case → 42501');

select * from finish();
rollback;
