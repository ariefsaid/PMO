-- 0077_procurement_records_chain.test.sql — Model-C settlement chain (PO-less, multi-PO, back-link)
-- Encodes: AC-PR-029 / AC-PR-030 / AC-PR-031
-- Tests that:
--   AC-PR-029: PO-less case — invoice (po_id null) + payment (invoice_id → that invoice) both persist
--   AC-PR-030: invoice with po_id = PO#2 correctly references PO#2
--   AC-PR-031: invoice po_id null → update sets po_id → succeeds, row count stays 1
begin;
select plan(6);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00770000-0000-0000-0000-000000000001', 'PR-Chain Org A');

insert into auth.users (id, email) values
  ('00770000-0000-0000-0000-0000000000a1', 'pm@prchain.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00770000-0000-0000-0000-0000000000a1', '00770000-0000-0000-0000-000000000001',
   'PM Chain', 'pm@prchain.example', 'Project Manager');

-- Case A: no PR, no quotation, no PO (PO-less scenario)
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00770000-0000-0000-0000-000000000010', '00770000-0000-0000-0000-000000000001',
   'PO-less Case', 'Vendor Invoiced', '00770000-0000-0000-0000-0000000000a1');

-- Case B: two POs (for multi-PO attribution test)
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00770000-0000-0000-0000-000000000011', '00770000-0000-0000-0000-000000000001',
   'Multi-PO Case', 'Vendor Invoiced', '00770000-0000-0000-0000-0000000000a1');

insert into purchase_orders (id, org_id, procurement_id, po_number, status) values
  ('00770000-0000-0000-0000-000000000aa1', '00770000-0000-0000-0000-000000000001',
   '00770000-0000-0000-0000-000000000011', 'PO-001', 'Issued'),
  ('00770000-0000-0000-0000-000000000aa2', '00770000-0000-0000-0000-000000000001',
   '00770000-0000-0000-0000-000000000011', 'PO-002', 'Issued');

-- ── AC-PR-029: PO-less — invoice (po_id null) + payment (invoice_id → invoice) ─
insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date) values
  ('00770000-0000-0000-0000-000000000020', '00770000-0000-0000-0000-000000000001',
   '00770000-0000-0000-0000-000000000010', 'Received', '2026-06-10');

-- po_id on this invoice must be null (PO-less)
select results_eq(
  $$ select po_id is null from procurement_invoices
     where id = '00770000-0000-0000-0000-000000000020' $$,
  $$ values (true) $$,
  'AC-PR-029: PO-less invoice persists with po_id null');

insert into payments (id, org_id, procurement_id, invoice_id, pay_number, status) values
  ('00770000-0000-0000-0000-000000000030', '00770000-0000-0000-0000-000000000001',
   '00770000-0000-0000-0000-000000000010',
   '00770000-0000-0000-0000-000000000020', 'PAY-001', 'Scheduled');

select results_eq(
  $$ select count(*)::int from procurement_invoices
     where procurement_id = '00770000-0000-0000-0000-000000000010' $$,
  $$ values (1) $$,
  'AC-PR-029: exactly one invoice under the PO-less case');

select results_eq(
  $$ select count(*)::int from payments
     where procurement_id = '00770000-0000-0000-0000-000000000010' $$,
  $$ values (1) $$,
  'AC-PR-029: exactly one payment under the PO-less case');

-- ── AC-PR-030: invoice po_id = PO#2 → joins to PO#2 ─────────────────────────
insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date, po_id) values
  ('00770000-0000-0000-0000-000000000021', '00770000-0000-0000-0000-000000000001',
   '00770000-0000-0000-0000-000000000011', 'Received', '2026-06-11',
   '00770000-0000-0000-0000-000000000aa2');  -- points to PO#2

select results_eq(
  $$ select po_id = '00770000-0000-0000-0000-000000000aa2'::uuid
     from procurement_invoices
     where id = '00770000-0000-0000-0000-000000000021' $$,
  $$ values (true) $$,
  'AC-PR-030: invoice with po_id = PO#2 joins correctly to PO#2');

-- ── AC-PR-031: update po_id null → non-null succeeds, row count stays 1 ──────
-- Insert invoice with po_id null
insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date) values
  ('00770000-0000-0000-0000-000000000022', '00770000-0000-0000-0000-000000000001',
   '00770000-0000-0000-0000-000000000011', 'Received', '2026-06-12');

-- Update to link to PO#1 (nullable → non-null update)
update procurement_invoices
   set po_id = '00770000-0000-0000-0000-000000000aa1'
 where id = '00770000-0000-0000-0000-000000000022';

select results_eq(
  $$ select count(*)::int from procurement_invoices
     where id = '00770000-0000-0000-0000-000000000022' $$,
  $$ values (1) $$,
  'AC-PR-031: row count stays 1 after updating po_id');

select results_eq(
  $$ select po_id is not null
     from procurement_invoices
     where id = '00770000-0000-0000-0000-000000000022' $$,
  $$ values (true) $$,
  'AC-PR-031: po_id is now non-null after update (nullable → non-null succeeds)');

select finish();
rollback;
