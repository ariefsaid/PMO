-- 0350_engineer_purchasing_scope.test.sql — Engineer purchasing read scope (owner ruling 2026-10-23).
-- An Engineer reads only the procurements they raised and those requests' records and files; no vendor
-- bills, payments, sales invoices, incoming receipts or the same money by another name. PM, Finance,
-- Executive and Admin reads are unchanged, and organisation tenancy still holds.
begin;
create extension if not exists pgtap;
select no_plan();


insert into organizations (id, name) values
  ('03500000-0000-0000-0000-0000000000a0', 'EPS Org A'),
  ('03500000-0000-0000-0000-0000000000b0', 'EPS Org B');
insert into auth.users (id, email) values
  ('03500000-0000-0000-0000-0000000000e1', 'eps-eng1@example.test'),
  ('03500000-0000-0000-0000-0000000000e2', 'eps-eng2@example.test'),
  ('03500000-0000-0000-0000-0000000000c1', 'eps-pm@example.test'),
  ('03500000-0000-0000-0000-0000000000c2', 'eps-fin@example.test'),
  ('03500000-0000-0000-0000-0000000000c3', 'eps-exec@example.test'),
  ('03500000-0000-0000-0000-0000000000c4', 'eps-admin@example.test'),
  ('03500000-0000-0000-0000-0000000000e9', 'eps-engb@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03500000-0000-0000-0000-0000000000e1', '03500000-0000-0000-0000-0000000000a0', 'EPS eng1', 'eps-eng1@example.test', 'Engineer', 'active'),
  ('03500000-0000-0000-0000-0000000000e2', '03500000-0000-0000-0000-0000000000a0', 'EPS eng2', 'eps-eng2@example.test', 'Engineer', 'active'),
  ('03500000-0000-0000-0000-0000000000c1', '03500000-0000-0000-0000-0000000000a0', 'EPS pm', 'eps-pm@example.test', 'Project Manager', 'active'),
  ('03500000-0000-0000-0000-0000000000c2', '03500000-0000-0000-0000-0000000000a0', 'EPS fin', 'eps-fin@example.test', 'Finance', 'active'),
  ('03500000-0000-0000-0000-0000000000c3', '03500000-0000-0000-0000-0000000000a0', 'EPS exec', 'eps-exec@example.test', 'Executive', 'active'),
  ('03500000-0000-0000-0000-0000000000c4', '03500000-0000-0000-0000-0000000000a0', 'EPS admin', 'eps-admin@example.test', 'Admin', 'active'),
  ('03500000-0000-0000-0000-0000000000e9', '03500000-0000-0000-0000-0000000000b0', 'EPS engB', 'eps-engb@example.test', 'Engineer', 'active');
insert into companies (id, org_id, name, type) values
  ('03500000-0000-0000-0000-0000000000d1', '03500000-0000-0000-0000-0000000000a0', 'EPS Vendor A', 'Vendor'),
  ('03500000-0000-0000-0000-0000000000d2', '03500000-0000-0000-0000-0000000000b0', 'EPS Vendor B', 'Vendor');
insert into projects (id, org_id, name, status) values
  ('03500000-0000-0000-0000-0000000000f1', '03500000-0000-0000-0000-0000000000a0', 'EPS Project', 'Ongoing Project');

-- Purchasing and money fixtures are written by the table owner with triggers off: this file proves READ
-- visibility only, so the rows need to exist, not to have travelled the write paths (each has its own proof).
set local session_replication_role = replica;

insert into procurements (id, org_id, title, status, requested_by_id, vendor_id, currency, total_value, approved_total_value) values
  ('03500001-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', 'EPS request 1', 'Vendor Invoiced', '03500000-0000-0000-0000-0000000000e1', '03500000-0000-0000-0000-0000000000d1', 'IDR', 1000, 1000),
  ('03500001-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', 'EPS request 2', 'Vendor Invoiced', '03500000-0000-0000-0000-0000000000e2', '03500000-0000-0000-0000-0000000000d1', 'IDR', 1000, 1000),
  ('03500001-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', 'EPS request 3', 'Vendor Invoiced', '03500000-0000-0000-0000-0000000000e9', '03500000-0000-0000-0000-0000000000d2', 'IDR', 1000, 1000);
insert into procurement_items (id, org_id, procurement_id, name) values
  ('03500002-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000001', 'EPS item 1'),
  ('03500002-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000002', 'EPS item 2'),
  ('03500002-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500001-0000-0000-0000-000000000003', 'EPS item 3');
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, currency) values
  ('03500003-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000d1', 'IDR'),
  ('03500003-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000d1', 'IDR'),
  ('03500003-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500001-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000d2', 'IDR');
insert into procurement_receipts (id, org_id, procurement_id, status) values
  ('03500004-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000001', 'Complete'),
  ('03500004-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000002', 'Complete'),
  ('03500004-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500001-0000-0000-0000-000000000003', 'Complete');
insert into procurement_status_events (id, org_id, procurement_id, to_status) values
  ('03500005-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000001', 'Requested'),
  ('03500005-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000002', 'Requested'),
  ('03500005-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500001-0000-0000-0000-000000000003', 'Requested');
insert into procurement_documents (id, org_id, procurement_id, type) values
  ('03500006-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000001', 'PR'),
  ('03500006-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000002', 'PR'),
  ('03500006-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500001-0000-0000-0000-000000000003', 'PR');
insert into purchase_requests (id, org_id, procurement_id, currency) values
  ('03500007-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000001', 'IDR'),
  ('03500007-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000002', 'IDR'),
  ('03500007-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500001-0000-0000-0000-000000000003', 'IDR');
insert into rfqs (id, org_id, procurement_id, currency) values
  ('03500008-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000001', 'IDR'),
  ('03500008-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000002', 'IDR'),
  ('03500008-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500001-0000-0000-0000-000000000003', 'IDR');
insert into purchase_orders (id, org_id, procurement_id, currency) values
  ('03500009-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000001', 'IDR'),
  ('03500009-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000002', 'IDR'),
  ('03500009-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500001-0000-0000-0000-000000000003', 'IDR');
insert into procurement_quotation_files (id, org_id, quotation_id, title) values
  ('03500010-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500003-0000-0000-0000-000000000001', 'EPS file 1'),
  ('03500010-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500003-0000-0000-0000-000000000002', 'EPS file 2'),
  ('03500010-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500003-0000-0000-0000-000000000003', 'EPS file 3');
insert into procurement_receipt_files (id, org_id, receipt_id, title) values
  ('03500011-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500004-0000-0000-0000-000000000001', 'EPS file 1'),
  ('03500011-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500004-0000-0000-0000-000000000002', 'EPS file 2'),
  ('03500011-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500004-0000-0000-0000-000000000003', 'EPS file 3');
insert into purchase_request_files (id, org_id, purchase_request_id, title) values
  ('03500012-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500007-0000-0000-0000-000000000001', 'EPS file 1'),
  ('03500012-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500007-0000-0000-0000-000000000002', 'EPS file 2'),
  ('03500012-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500007-0000-0000-0000-000000000003', 'EPS file 3');
insert into rfq_files (id, org_id, rfq_id, title) values
  ('03500013-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500008-0000-0000-0000-000000000001', 'EPS file 1'),
  ('03500013-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500008-0000-0000-0000-000000000002', 'EPS file 2'),
  ('03500013-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500008-0000-0000-0000-000000000003', 'EPS file 3');
insert into purchase_order_files (id, org_id, purchase_order_id, title) values
  ('03500014-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500009-0000-0000-0000-000000000001', 'EPS file 1'),
  ('03500014-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500009-0000-0000-0000-000000000002', 'EPS file 2'),
  ('03500014-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500009-0000-0000-0000-000000000003', 'EPS file 3');
insert into procurement_invoices (id, org_id, procurement_id, status, tax_treatment, tax_amount, amount, currency) values
  ('03500020-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000001', 'Received', 'exclusive', 0, 900, 'IDR'),
  ('03500020-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000002', 'Received', 'exclusive', 0, 900, 'IDR'),
  ('03500020-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500001-0000-0000-0000-000000000003', 'Received', 'exclusive', 0, 900, 'IDR');
insert into procurement_invoice_files (id, org_id, invoice_id, title) values
  ('03500021-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500020-0000-0000-0000-000000000001', 'EPS bill file 1'),
  ('03500021-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500020-0000-0000-0000-000000000002', 'EPS bill file 2'),
  ('03500021-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500020-0000-0000-0000-000000000003', 'EPS bill file 3');
insert into payments (id, org_id, procurement_id, amount, currency) values
  ('03500022-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000001', 900, 'IDR'),
  ('03500022-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500001-0000-0000-0000-000000000002', 900, 'IDR'),
  ('03500022-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500001-0000-0000-0000-000000000003', 900, 'IDR');
insert into payment_files (id, org_id, payment_id, title) values
  ('03500023-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500022-0000-0000-0000-000000000001', 'EPS payment file 1'),
  ('03500023-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500022-0000-0000-0000-000000000002', 'EPS payment file 2'),
  ('03500023-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500022-0000-0000-0000-000000000003', 'EPS payment file 3');
insert into vendor_withholding_slips (id, org_id, vendor_id, slip_number, slip_date, tax_period, pph_type, currency, tax_base, withheld_amount, invoice_count, created_by, create_payload) values
  ('03500024-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500000-0000-0000-0000-0000000000d1', 'EPS-SLIP-1', date '2026-10-01', date '2026-10-01', 'pph23', 'IDR', 900, 18, 1, '03500000-0000-0000-0000-0000000000c2', '{}'::jsonb),
  ('03500024-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500000-0000-0000-0000-0000000000d1', 'EPS-SLIP-2', date '2026-10-01', date '2026-10-01', 'pph23', 'IDR', 900, 18, 1, '03500000-0000-0000-0000-0000000000c2', '{}'::jsonb),
  ('03500024-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500000-0000-0000-0000-0000000000d2', 'EPS-SLIP-3', date '2026-10-01', date '2026-10-01', 'pph23', 'IDR', 900, 18, 1, '03500000-0000-0000-0000-0000000000e9', '{}'::jsonb);
insert into vendor_withholding_slip_bills (id, org_id, slip_id, invoice_id, procurement_id, withheld_at_record, type_source, currency) values
  ('03500025-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500024-0000-0000-0000-000000000001', '03500020-0000-0000-0000-000000000001', '03500001-0000-0000-0000-000000000001', 18, 'declared', 'IDR'),
  ('03500025-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500024-0000-0000-0000-000000000002', '03500020-0000-0000-0000-000000000002', '03500001-0000-0000-0000-000000000002', 18, 'declared', 'IDR'),
  ('03500025-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500024-0000-0000-0000-000000000003', '03500020-0000-0000-0000-000000000003', '03500001-0000-0000-0000-000000000003', 18, 'declared', 'IDR');
insert into sales_invoices (id, org_id, project_id, status, tax_treatment, tax_amount, amount, currency) values
  ('03500030-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500000-0000-0000-0000-0000000000f1', 'Unpaid', 'exclusive', 0, 5000, 'IDR'),
  ('03500030-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500000-0000-0000-0000-0000000000f1', 'Unpaid', 'exclusive', 0, 5000, 'IDR'),
  ('03500030-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', null, 'Unpaid', 'exclusive', 0, 5000, 'IDR');
insert into sales_invoice_authors (org_id, sales_invoice_id, user_id) values
  ('03500000-0000-0000-0000-0000000000a0', '03500030-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000c2'),
  ('03500000-0000-0000-0000-0000000000a0', '03500030-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000c2'),
  ('03500000-0000-0000-0000-0000000000b0', '03500030-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000e9');
insert into sales_invoice_submit_authorizations (org_id, sales_invoice_id, user_id) values
  ('03500000-0000-0000-0000-0000000000a0', '03500030-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000c4'),
  ('03500000-0000-0000-0000-0000000000a0', '03500030-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000c4'),
  ('03500000-0000-0000-0000-0000000000b0', '03500030-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000e9');
insert into incoming_payments (id, org_id, sales_invoice_id, amount, currency) values
  ('03500031-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', '03500030-0000-0000-0000-000000000001', 5000, 'IDR'),
  ('03500031-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', '03500030-0000-0000-0000-000000000002', 5000, 'IDR'),
  ('03500031-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', '03500030-0000-0000-0000-000000000003', 5000, 'IDR');
insert into erp_ap_aging_snapshot (id, org_id, snapshot_id, party, total_outstanding) values
  ('03500032-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'EPS supplier 1', 900),
  ('03500032-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'EPS supplier 2', 900),
  ('03500032-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', gen_random_uuid(), 'EPS supplier 3', 900);
insert into erp_ar_aging_snapshot (id, org_id, snapshot_id, party, total_outstanding) values
  ('03500033-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'EPS customer 1', 5000),
  ('03500033-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'EPS customer 2', 5000),
  ('03500033-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000b0', gen_random_uuid(), 'EPS customer 3', 5000);
-- ERP commands: one revenue, one procurement and one budget command per organisation.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('03500040-0000-0000-0000-000000000001', '03500000-0000-0000-0000-0000000000a0', 'revenue', 'eps-1', 'eps-key-1', 'erpnext', 'create', 'pending'),
  ('03500040-0000-0000-0000-000000000002', '03500000-0000-0000-0000-0000000000a0', 'procurement', 'eps-2', 'eps-key-2', 'erpnext', 'create', 'pending'),
  ('03500040-0000-0000-0000-000000000003', '03500000-0000-0000-0000-0000000000a0', 'budget', 'eps-3', 'eps-key-3', 'erpnext', 'create', 'pending'),
  ('03500040-0000-0000-0000-000000000004', '03500000-0000-0000-0000-0000000000b0', 'revenue', 'eps-4', 'eps-key-4', 'erpnext', 'create', 'pending'),
  ('03500040-0000-0000-0000-000000000005', '03500000-0000-0000-0000-0000000000b0', 'procurement', 'eps-5', 'eps-key-5', 'erpnext', 'create', 'pending'),
  ('03500040-0000-0000-0000-000000000006', '03500000-0000-0000-0000-0000000000b0', 'budget', 'eps-6', 'eps-key-6', 'erpnext', 'create', 'pending');
insert into storage.objects (id, bucket_id, name, owner) values
  ('03500050-0000-0000-0000-000000000001', 'procurement-files', '03500000-0000-0000-0000-0000000000a0/03500001-0000-0000-0000-000000000001/quotation/03500050-0000-0000-0000-000000000001/f.pdf', '03500000-0000-0000-0000-0000000000e1'),
  ('03500051-0000-0000-0000-000000000001', 'procurement-files', '03500000-0000-0000-0000-0000000000a0/03500001-0000-0000-0000-000000000001/invoice/03500051-0000-0000-0000-000000000001/f.pdf', '03500000-0000-0000-0000-0000000000e1'),
  ('03500052-0000-0000-0000-000000000001', 'procurement-files', '03500000-0000-0000-0000-0000000000a0/03500001-0000-0000-0000-000000000001/payment/03500052-0000-0000-0000-000000000001/f.pdf', '03500000-0000-0000-0000-0000000000e1'),
  ('03500050-0000-0000-0000-000000000002', 'procurement-files', '03500000-0000-0000-0000-0000000000a0/03500001-0000-0000-0000-000000000002/quotation/03500050-0000-0000-0000-000000000002/f.pdf', '03500000-0000-0000-0000-0000000000e2'),
  ('03500051-0000-0000-0000-000000000002', 'procurement-files', '03500000-0000-0000-0000-0000000000a0/03500001-0000-0000-0000-000000000002/invoice/03500051-0000-0000-0000-000000000002/f.pdf', '03500000-0000-0000-0000-0000000000e2'),
  ('03500052-0000-0000-0000-000000000002', 'procurement-files', '03500000-0000-0000-0000-0000000000a0/03500001-0000-0000-0000-000000000002/payment/03500052-0000-0000-0000-000000000002/f.pdf', '03500000-0000-0000-0000-0000000000e2'),
  ('03500050-0000-0000-0000-000000000003', 'procurement-files', '03500000-0000-0000-0000-0000000000b0/03500001-0000-0000-0000-000000000003/quotation/03500050-0000-0000-0000-000000000003/f.pdf', '03500000-0000-0000-0000-0000000000e9'),
  ('03500051-0000-0000-0000-000000000003', 'procurement-files', '03500000-0000-0000-0000-0000000000b0/03500001-0000-0000-0000-000000000003/invoice/03500051-0000-0000-0000-000000000003/f.pdf', '03500000-0000-0000-0000-0000000000e9'),
  ('03500052-0000-0000-0000-000000000003', 'procurement-files', '03500000-0000-0000-0000-0000000000b0/03500001-0000-0000-0000-000000000003/payment/03500052-0000-0000-0000-000000000003/f.pdf', '03500000-0000-0000-0000-0000000000e9');

set local session_replication_role = origin;

set local role authenticated;

-- AC-SEC-222: an Engineer reads the procurement they raised and not a colleague's.
set local request.jwt.claims = '{"sub":"03500000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select results_eq($$select id from public.procurements order by 1$$, $$values ('03500001-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-222 Engineer reads only the procurement they raised');
set local request.jwt.claims = '{"sub":"03500000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select results_eq($$select id from public.procurements order by 1$$, $$values ('03500001-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-222 a second Engineer reads only their own procurement');

-- AC-SEC-223: an Engineer reads a request's records and files only under their own request.
set local request.jwt.claims = '{"sub":"03500000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select results_eq($$select id from public.procurement_items order by 1$$, $$values ('03500002-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads procurement_items only under their own request');
select results_eq($$select id from public.procurement_quotations order by 1$$, $$values ('03500003-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads procurement_quotations only under their own request');
select results_eq($$select id from public.procurement_receipts order by 1$$, $$values ('03500004-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads procurement_receipts only under their own request');
select results_eq($$select id from public.procurement_status_events order by 1$$, $$values ('03500005-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads procurement_status_events only under their own request');
select results_eq($$select id from public.procurement_documents order by 1$$, $$values ('03500006-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads procurement_documents only under their own request');
select results_eq($$select id from public.purchase_requests order by 1$$, $$values ('03500007-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads purchase_requests only under their own request');
select results_eq($$select id from public.rfqs order by 1$$, $$values ('03500008-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads rfqs only under their own request');
select results_eq($$select id from public.purchase_orders order by 1$$, $$values ('03500009-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads purchase_orders only under their own request');
select results_eq($$select id from public.procurement_quotation_files order by 1$$, $$values ('03500010-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads procurement_quotation_files only under their own request');
select results_eq($$select id from public.procurement_receipt_files order by 1$$, $$values ('03500011-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads procurement_receipt_files only under their own request');
select results_eq($$select id from public.purchase_request_files order by 1$$, $$values ('03500012-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads purchase_request_files only under their own request');
select results_eq($$select id from public.rfq_files order by 1$$, $$values ('03500013-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads rfq_files only under their own request');
select results_eq($$select id from public.purchase_order_files order by 1$$, $$values ('03500014-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-223 Engineer reads purchase_order_files only under their own request');

-- AC-SEC-224: an Engineer reads no invoices, payments or the same money by another name.
select is_empty($$select id from public.procurement_invoices$$, 'AC-SEC-224 Engineer reads no procurement_invoices');
select is_empty($$select id from public.procurement_invoice_files$$, 'AC-SEC-224 Engineer reads no procurement_invoice_files');
select is_empty($$select id from public.payments$$, 'AC-SEC-224 Engineer reads no payments');
select is_empty($$select id from public.payment_files$$, 'AC-SEC-224 Engineer reads no payment_files');
select is_empty($$select id from public.vendor_withholding_slips$$, 'AC-SEC-224 Engineer reads no vendor_withholding_slips');
select is_empty($$select id from public.vendor_withholding_slip_bills$$, 'AC-SEC-224 Engineer reads no vendor_withholding_slip_bills');
select is_empty($$select id from public.sales_invoices$$, 'AC-SEC-224 Engineer reads no sales_invoices');
select is_empty($$select id from public.incoming_payments$$, 'AC-SEC-224 Engineer reads no incoming_payments');
select is_empty($$select id from public.erp_ap_aging_snapshot$$, 'AC-SEC-224 Engineer reads no erp_ap_aging_snapshot');
select is_empty($$select id from public.erp_ar_aging_snapshot$$, 'AC-SEC-224 Engineer reads no erp_ar_aging_snapshot');
select is_empty($$select sales_invoice_id from public.sales_invoice_authors$$, 'AC-SEC-224 Engineer reads no sales_invoice_authors');
select is_empty($$select sales_invoice_id from public.sales_invoice_submit_authorizations$$, 'AC-SEC-224 Engineer reads no sales_invoice_submit_authorizations');
select results_eq($$select domain from public.external_command_outbox order by 1$$, $$values ('budget'::text)$$, 'AC-SEC-224 Engineer reads no revenue or procurement ERP commands; other domains unchanged');

-- AC-SEC-225: procurement-files storage — an Engineer reads objects under their own request only, never a bill or payment file.
select results_eq($$select id from storage.objects where bucket_id = 'procurement-files' and id::text like '035000%' order by 1$$, $$values ('03500050-0000-0000-0000-000000000001'::uuid)$$, 'AC-SEC-225 Engineer reads only the non-money files of their own request');

-- AC-SEC-226: the payment-ceiling read returns no bill amounts to an Engineer, even for their own request.
select is_empty($$select * from public.procurement_payment_within_ceiling('03500001-0000-0000-0000-000000000001')$$, 'AC-SEC-226 payment ceiling returns no row to an Engineer');

-- AC-SEC-227: Project Manager, Finance, Executive and Admin reads are unchanged.
set local request.jwt.claims = '{"sub":"03500000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select results_eq($$select id from public.procurements order by 1$$, $$values ('03500001-0000-0000-0000-000000000001'::uuid), ('03500001-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement in the organisation');
select results_eq($$select id from public.procurement_items order by 1$$, $$values ('03500002-0000-0000-0000-000000000001'::uuid), ('03500002-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement_items row in the organisation');
select results_eq($$select id from public.procurement_quotations order by 1$$, $$values ('03500003-0000-0000-0000-000000000001'::uuid), ('03500003-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement_quotations row in the organisation');
select results_eq($$select id from public.procurement_receipts order by 1$$, $$values ('03500004-0000-0000-0000-000000000001'::uuid), ('03500004-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement_receipts row in the organisation');
select results_eq($$select id from public.procurement_status_events order by 1$$, $$values ('03500005-0000-0000-0000-000000000001'::uuid), ('03500005-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement_status_events row in the organisation');
select results_eq($$select id from public.procurement_documents order by 1$$, $$values ('03500006-0000-0000-0000-000000000001'::uuid), ('03500006-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement_documents row in the organisation');
select results_eq($$select id from public.purchase_requests order by 1$$, $$values ('03500007-0000-0000-0000-000000000001'::uuid), ('03500007-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every purchase_requests row in the organisation');
select results_eq($$select id from public.rfqs order by 1$$, $$values ('03500008-0000-0000-0000-000000000001'::uuid), ('03500008-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every rfqs row in the organisation');
select results_eq($$select id from public.purchase_orders order by 1$$, $$values ('03500009-0000-0000-0000-000000000001'::uuid), ('03500009-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every purchase_orders row in the organisation');
select results_eq($$select id from public.procurement_quotation_files order by 1$$, $$values ('03500010-0000-0000-0000-000000000001'::uuid), ('03500010-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement_quotation_files row in the organisation');
select results_eq($$select id from public.procurement_receipt_files order by 1$$, $$values ('03500011-0000-0000-0000-000000000001'::uuid), ('03500011-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement_receipt_files row in the organisation');
select results_eq($$select id from public.purchase_request_files order by 1$$, $$values ('03500012-0000-0000-0000-000000000001'::uuid), ('03500012-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every purchase_request_files row in the organisation');
select results_eq($$select id from public.rfq_files order by 1$$, $$values ('03500013-0000-0000-0000-000000000001'::uuid), ('03500013-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every rfq_files row in the organisation');
select results_eq($$select id from public.purchase_order_files order by 1$$, $$values ('03500014-0000-0000-0000-000000000001'::uuid), ('03500014-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every purchase_order_files row in the organisation');
select results_eq($$select id from public.procurement_invoices order by 1$$, $$values ('03500020-0000-0000-0000-000000000001'::uuid), ('03500020-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement_invoices row in the organisation');
select results_eq($$select id from public.procurement_invoice_files order by 1$$, $$values ('03500021-0000-0000-0000-000000000001'::uuid), ('03500021-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement_invoice_files row in the organisation');
select results_eq($$select id from public.payments order by 1$$, $$values ('03500022-0000-0000-0000-000000000001'::uuid), ('03500022-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every payments row in the organisation');
select results_eq($$select id from public.payment_files order by 1$$, $$values ('03500023-0000-0000-0000-000000000001'::uuid), ('03500023-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every payment_files row in the organisation');
select results_eq($$select id from public.vendor_withholding_slips order by 1$$, $$values ('03500024-0000-0000-0000-000000000001'::uuid), ('03500024-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every vendor_withholding_slips row in the organisation');
select results_eq($$select id from public.vendor_withholding_slip_bills order by 1$$, $$values ('03500025-0000-0000-0000-000000000001'::uuid), ('03500025-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every vendor_withholding_slip_bills row in the organisation');
select results_eq($$select id from public.sales_invoices order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every sales_invoices row in the organisation');
select results_eq($$select id from public.incoming_payments order by 1$$, $$values ('03500031-0000-0000-0000-000000000001'::uuid), ('03500031-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every incoming_payments row in the organisation');
select results_eq($$select id from public.erp_ap_aging_snapshot order by 1$$, $$values ('03500032-0000-0000-0000-000000000001'::uuid), ('03500032-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every erp_ap_aging_snapshot row in the organisation');
select results_eq($$select id from public.erp_ar_aging_snapshot order by 1$$, $$values ('03500033-0000-0000-0000-000000000001'::uuid), ('03500033-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every erp_ar_aging_snapshot row in the organisation');
select results_eq($$select sales_invoice_id from public.sales_invoice_authors order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every sales_invoice_authors row in the organisation');
select results_eq($$select sales_invoice_id from public.sales_invoice_submit_authorizations order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every sales_invoice_submit_authorizations row in the organisation');
select results_eq($$select domain from public.external_command_outbox order by 1$$, $$values ('budget'::text), ('procurement'::text), ('revenue'::text)$$, 'AC-SEC-227 Project Manager reads ERP commands of every domain');
select results_eq($$select id from storage.objects where bucket_id = 'procurement-files' and id::text like '035000%' order by 1$$, $$values ('03500050-0000-0000-0000-000000000001'::uuid), ('03500050-0000-0000-0000-000000000002'::uuid), ('03500051-0000-0000-0000-000000000001'::uuid), ('03500051-0000-0000-0000-000000000002'::uuid), ('03500052-0000-0000-0000-000000000001'::uuid), ('03500052-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Project Manager reads every procurement file object in the organisation');
select is((select count(*)::int from public.procurement_payment_within_ceiling('03500001-0000-0000-0000-000000000001')), 1, 'AC-SEC-227 Project Manager reads the payment ceiling');
set local request.jwt.claims = '{"sub":"03500000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select results_eq($$select id from public.procurements order by 1$$, $$values ('03500001-0000-0000-0000-000000000001'::uuid), ('03500001-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement in the organisation');
select results_eq($$select id from public.procurement_items order by 1$$, $$values ('03500002-0000-0000-0000-000000000001'::uuid), ('03500002-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement_items row in the organisation');
select results_eq($$select id from public.procurement_quotations order by 1$$, $$values ('03500003-0000-0000-0000-000000000001'::uuid), ('03500003-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement_quotations row in the organisation');
select results_eq($$select id from public.procurement_receipts order by 1$$, $$values ('03500004-0000-0000-0000-000000000001'::uuid), ('03500004-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement_receipts row in the organisation');
select results_eq($$select id from public.procurement_status_events order by 1$$, $$values ('03500005-0000-0000-0000-000000000001'::uuid), ('03500005-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement_status_events row in the organisation');
select results_eq($$select id from public.procurement_documents order by 1$$, $$values ('03500006-0000-0000-0000-000000000001'::uuid), ('03500006-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement_documents row in the organisation');
select results_eq($$select id from public.purchase_requests order by 1$$, $$values ('03500007-0000-0000-0000-000000000001'::uuid), ('03500007-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every purchase_requests row in the organisation');
select results_eq($$select id from public.rfqs order by 1$$, $$values ('03500008-0000-0000-0000-000000000001'::uuid), ('03500008-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every rfqs row in the organisation');
select results_eq($$select id from public.purchase_orders order by 1$$, $$values ('03500009-0000-0000-0000-000000000001'::uuid), ('03500009-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every purchase_orders row in the organisation');
select results_eq($$select id from public.procurement_quotation_files order by 1$$, $$values ('03500010-0000-0000-0000-000000000001'::uuid), ('03500010-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement_quotation_files row in the organisation');
select results_eq($$select id from public.procurement_receipt_files order by 1$$, $$values ('03500011-0000-0000-0000-000000000001'::uuid), ('03500011-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement_receipt_files row in the organisation');
select results_eq($$select id from public.purchase_request_files order by 1$$, $$values ('03500012-0000-0000-0000-000000000001'::uuid), ('03500012-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every purchase_request_files row in the organisation');
select results_eq($$select id from public.rfq_files order by 1$$, $$values ('03500013-0000-0000-0000-000000000001'::uuid), ('03500013-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every rfq_files row in the organisation');
select results_eq($$select id from public.purchase_order_files order by 1$$, $$values ('03500014-0000-0000-0000-000000000001'::uuid), ('03500014-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every purchase_order_files row in the organisation');
select results_eq($$select id from public.procurement_invoices order by 1$$, $$values ('03500020-0000-0000-0000-000000000001'::uuid), ('03500020-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement_invoices row in the organisation');
select results_eq($$select id from public.procurement_invoice_files order by 1$$, $$values ('03500021-0000-0000-0000-000000000001'::uuid), ('03500021-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement_invoice_files row in the organisation');
select results_eq($$select id from public.payments order by 1$$, $$values ('03500022-0000-0000-0000-000000000001'::uuid), ('03500022-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every payments row in the organisation');
select results_eq($$select id from public.payment_files order by 1$$, $$values ('03500023-0000-0000-0000-000000000001'::uuid), ('03500023-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every payment_files row in the organisation');
select results_eq($$select id from public.vendor_withholding_slips order by 1$$, $$values ('03500024-0000-0000-0000-000000000001'::uuid), ('03500024-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every vendor_withholding_slips row in the organisation');
select results_eq($$select id from public.vendor_withholding_slip_bills order by 1$$, $$values ('03500025-0000-0000-0000-000000000001'::uuid), ('03500025-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every vendor_withholding_slip_bills row in the organisation');
select results_eq($$select id from public.sales_invoices order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every sales_invoices row in the organisation');
select results_eq($$select id from public.incoming_payments order by 1$$, $$values ('03500031-0000-0000-0000-000000000001'::uuid), ('03500031-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every incoming_payments row in the organisation');
select results_eq($$select id from public.erp_ap_aging_snapshot order by 1$$, $$values ('03500032-0000-0000-0000-000000000001'::uuid), ('03500032-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every erp_ap_aging_snapshot row in the organisation');
select results_eq($$select id from public.erp_ar_aging_snapshot order by 1$$, $$values ('03500033-0000-0000-0000-000000000001'::uuid), ('03500033-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every erp_ar_aging_snapshot row in the organisation');
select results_eq($$select sales_invoice_id from public.sales_invoice_authors order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every sales_invoice_authors row in the organisation');
select results_eq($$select sales_invoice_id from public.sales_invoice_submit_authorizations order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every sales_invoice_submit_authorizations row in the organisation');
select results_eq($$select domain from public.external_command_outbox order by 1$$, $$values ('budget'::text), ('procurement'::text), ('revenue'::text)$$, 'AC-SEC-227 Finance reads ERP commands of every domain');
select results_eq($$select id from storage.objects where bucket_id = 'procurement-files' and id::text like '035000%' order by 1$$, $$values ('03500050-0000-0000-0000-000000000001'::uuid), ('03500050-0000-0000-0000-000000000002'::uuid), ('03500051-0000-0000-0000-000000000001'::uuid), ('03500051-0000-0000-0000-000000000002'::uuid), ('03500052-0000-0000-0000-000000000001'::uuid), ('03500052-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Finance reads every procurement file object in the organisation');
select is((select count(*)::int from public.procurement_payment_within_ceiling('03500001-0000-0000-0000-000000000001')), 1, 'AC-SEC-227 Finance reads the payment ceiling');
set local request.jwt.claims = '{"sub":"03500000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select results_eq($$select id from public.procurements order by 1$$, $$values ('03500001-0000-0000-0000-000000000001'::uuid), ('03500001-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement in the organisation');
select results_eq($$select id from public.procurement_items order by 1$$, $$values ('03500002-0000-0000-0000-000000000001'::uuid), ('03500002-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement_items row in the organisation');
select results_eq($$select id from public.procurement_quotations order by 1$$, $$values ('03500003-0000-0000-0000-000000000001'::uuid), ('03500003-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement_quotations row in the organisation');
select results_eq($$select id from public.procurement_receipts order by 1$$, $$values ('03500004-0000-0000-0000-000000000001'::uuid), ('03500004-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement_receipts row in the organisation');
select results_eq($$select id from public.procurement_status_events order by 1$$, $$values ('03500005-0000-0000-0000-000000000001'::uuid), ('03500005-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement_status_events row in the organisation');
select results_eq($$select id from public.procurement_documents order by 1$$, $$values ('03500006-0000-0000-0000-000000000001'::uuid), ('03500006-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement_documents row in the organisation');
select results_eq($$select id from public.purchase_requests order by 1$$, $$values ('03500007-0000-0000-0000-000000000001'::uuid), ('03500007-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every purchase_requests row in the organisation');
select results_eq($$select id from public.rfqs order by 1$$, $$values ('03500008-0000-0000-0000-000000000001'::uuid), ('03500008-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every rfqs row in the organisation');
select results_eq($$select id from public.purchase_orders order by 1$$, $$values ('03500009-0000-0000-0000-000000000001'::uuid), ('03500009-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every purchase_orders row in the organisation');
select results_eq($$select id from public.procurement_quotation_files order by 1$$, $$values ('03500010-0000-0000-0000-000000000001'::uuid), ('03500010-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement_quotation_files row in the organisation');
select results_eq($$select id from public.procurement_receipt_files order by 1$$, $$values ('03500011-0000-0000-0000-000000000001'::uuid), ('03500011-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement_receipt_files row in the organisation');
select results_eq($$select id from public.purchase_request_files order by 1$$, $$values ('03500012-0000-0000-0000-000000000001'::uuid), ('03500012-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every purchase_request_files row in the organisation');
select results_eq($$select id from public.rfq_files order by 1$$, $$values ('03500013-0000-0000-0000-000000000001'::uuid), ('03500013-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every rfq_files row in the organisation');
select results_eq($$select id from public.purchase_order_files order by 1$$, $$values ('03500014-0000-0000-0000-000000000001'::uuid), ('03500014-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every purchase_order_files row in the organisation');
select results_eq($$select id from public.procurement_invoices order by 1$$, $$values ('03500020-0000-0000-0000-000000000001'::uuid), ('03500020-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement_invoices row in the organisation');
select results_eq($$select id from public.procurement_invoice_files order by 1$$, $$values ('03500021-0000-0000-0000-000000000001'::uuid), ('03500021-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement_invoice_files row in the organisation');
select results_eq($$select id from public.payments order by 1$$, $$values ('03500022-0000-0000-0000-000000000001'::uuid), ('03500022-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every payments row in the organisation');
select results_eq($$select id from public.payment_files order by 1$$, $$values ('03500023-0000-0000-0000-000000000001'::uuid), ('03500023-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every payment_files row in the organisation');
select results_eq($$select id from public.vendor_withholding_slips order by 1$$, $$values ('03500024-0000-0000-0000-000000000001'::uuid), ('03500024-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every vendor_withholding_slips row in the organisation');
select results_eq($$select id from public.vendor_withholding_slip_bills order by 1$$, $$values ('03500025-0000-0000-0000-000000000001'::uuid), ('03500025-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every vendor_withholding_slip_bills row in the organisation');
select results_eq($$select id from public.sales_invoices order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every sales_invoices row in the organisation');
select results_eq($$select id from public.incoming_payments order by 1$$, $$values ('03500031-0000-0000-0000-000000000001'::uuid), ('03500031-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every incoming_payments row in the organisation');
select results_eq($$select id from public.erp_ap_aging_snapshot order by 1$$, $$values ('03500032-0000-0000-0000-000000000001'::uuid), ('03500032-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every erp_ap_aging_snapshot row in the organisation');
select results_eq($$select id from public.erp_ar_aging_snapshot order by 1$$, $$values ('03500033-0000-0000-0000-000000000001'::uuid), ('03500033-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every erp_ar_aging_snapshot row in the organisation');
select results_eq($$select sales_invoice_id from public.sales_invoice_authors order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every sales_invoice_authors row in the organisation');
select results_eq($$select sales_invoice_id from public.sales_invoice_submit_authorizations order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every sales_invoice_submit_authorizations row in the organisation');
select results_eq($$select domain from public.external_command_outbox order by 1$$, $$values ('budget'::text), ('procurement'::text), ('revenue'::text)$$, 'AC-SEC-227 Executive reads ERP commands of every domain');
select results_eq($$select id from storage.objects where bucket_id = 'procurement-files' and id::text like '035000%' order by 1$$, $$values ('03500050-0000-0000-0000-000000000001'::uuid), ('03500050-0000-0000-0000-000000000002'::uuid), ('03500051-0000-0000-0000-000000000001'::uuid), ('03500051-0000-0000-0000-000000000002'::uuid), ('03500052-0000-0000-0000-000000000001'::uuid), ('03500052-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Executive reads every procurement file object in the organisation');
select is((select count(*)::int from public.procurement_payment_within_ceiling('03500001-0000-0000-0000-000000000001')), 1, 'AC-SEC-227 Executive reads the payment ceiling');
set local request.jwt.claims = '{"sub":"03500000-0000-0000-0000-0000000000c4","role":"authenticated"}';
select results_eq($$select id from public.procurements order by 1$$, $$values ('03500001-0000-0000-0000-000000000001'::uuid), ('03500001-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement in the organisation');
select results_eq($$select id from public.procurement_items order by 1$$, $$values ('03500002-0000-0000-0000-000000000001'::uuid), ('03500002-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement_items row in the organisation');
select results_eq($$select id from public.procurement_quotations order by 1$$, $$values ('03500003-0000-0000-0000-000000000001'::uuid), ('03500003-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement_quotations row in the organisation');
select results_eq($$select id from public.procurement_receipts order by 1$$, $$values ('03500004-0000-0000-0000-000000000001'::uuid), ('03500004-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement_receipts row in the organisation');
select results_eq($$select id from public.procurement_status_events order by 1$$, $$values ('03500005-0000-0000-0000-000000000001'::uuid), ('03500005-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement_status_events row in the organisation');
select results_eq($$select id from public.procurement_documents order by 1$$, $$values ('03500006-0000-0000-0000-000000000001'::uuid), ('03500006-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement_documents row in the organisation');
select results_eq($$select id from public.purchase_requests order by 1$$, $$values ('03500007-0000-0000-0000-000000000001'::uuid), ('03500007-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every purchase_requests row in the organisation');
select results_eq($$select id from public.rfqs order by 1$$, $$values ('03500008-0000-0000-0000-000000000001'::uuid), ('03500008-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every rfqs row in the organisation');
select results_eq($$select id from public.purchase_orders order by 1$$, $$values ('03500009-0000-0000-0000-000000000001'::uuid), ('03500009-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every purchase_orders row in the organisation');
select results_eq($$select id from public.procurement_quotation_files order by 1$$, $$values ('03500010-0000-0000-0000-000000000001'::uuid), ('03500010-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement_quotation_files row in the organisation');
select results_eq($$select id from public.procurement_receipt_files order by 1$$, $$values ('03500011-0000-0000-0000-000000000001'::uuid), ('03500011-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement_receipt_files row in the organisation');
select results_eq($$select id from public.purchase_request_files order by 1$$, $$values ('03500012-0000-0000-0000-000000000001'::uuid), ('03500012-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every purchase_request_files row in the organisation');
select results_eq($$select id from public.rfq_files order by 1$$, $$values ('03500013-0000-0000-0000-000000000001'::uuid), ('03500013-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every rfq_files row in the organisation');
select results_eq($$select id from public.purchase_order_files order by 1$$, $$values ('03500014-0000-0000-0000-000000000001'::uuid), ('03500014-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every purchase_order_files row in the organisation');
select results_eq($$select id from public.procurement_invoices order by 1$$, $$values ('03500020-0000-0000-0000-000000000001'::uuid), ('03500020-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement_invoices row in the organisation');
select results_eq($$select id from public.procurement_invoice_files order by 1$$, $$values ('03500021-0000-0000-0000-000000000001'::uuid), ('03500021-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement_invoice_files row in the organisation');
select results_eq($$select id from public.payments order by 1$$, $$values ('03500022-0000-0000-0000-000000000001'::uuid), ('03500022-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every payments row in the organisation');
select results_eq($$select id from public.payment_files order by 1$$, $$values ('03500023-0000-0000-0000-000000000001'::uuid), ('03500023-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every payment_files row in the organisation');
select results_eq($$select id from public.vendor_withholding_slips order by 1$$, $$values ('03500024-0000-0000-0000-000000000001'::uuid), ('03500024-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every vendor_withholding_slips row in the organisation');
select results_eq($$select id from public.vendor_withholding_slip_bills order by 1$$, $$values ('03500025-0000-0000-0000-000000000001'::uuid), ('03500025-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every vendor_withholding_slip_bills row in the organisation');
select results_eq($$select id from public.sales_invoices order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every sales_invoices row in the organisation');
select results_eq($$select id from public.incoming_payments order by 1$$, $$values ('03500031-0000-0000-0000-000000000001'::uuid), ('03500031-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every incoming_payments row in the organisation');
select results_eq($$select id from public.erp_ap_aging_snapshot order by 1$$, $$values ('03500032-0000-0000-0000-000000000001'::uuid), ('03500032-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every erp_ap_aging_snapshot row in the organisation');
select results_eq($$select id from public.erp_ar_aging_snapshot order by 1$$, $$values ('03500033-0000-0000-0000-000000000001'::uuid), ('03500033-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every erp_ar_aging_snapshot row in the organisation');
select results_eq($$select sales_invoice_id from public.sales_invoice_authors order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every sales_invoice_authors row in the organisation');
select results_eq($$select sales_invoice_id from public.sales_invoice_submit_authorizations order by 1$$, $$values ('03500030-0000-0000-0000-000000000001'::uuid), ('03500030-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every sales_invoice_submit_authorizations row in the organisation');
select results_eq($$select domain from public.external_command_outbox order by 1$$, $$values ('budget'::text), ('procurement'::text), ('revenue'::text)$$, 'AC-SEC-227 Admin reads ERP commands of every domain');
select results_eq($$select id from storage.objects where bucket_id = 'procurement-files' and id::text like '035000%' order by 1$$, $$values ('03500050-0000-0000-0000-000000000001'::uuid), ('03500050-0000-0000-0000-000000000002'::uuid), ('03500051-0000-0000-0000-000000000001'::uuid), ('03500051-0000-0000-0000-000000000002'::uuid), ('03500052-0000-0000-0000-000000000001'::uuid), ('03500052-0000-0000-0000-000000000002'::uuid)$$, 'AC-SEC-227 Admin reads every procurement file object in the organisation');
select is((select count(*)::int from public.procurement_payment_within_ceiling('03500001-0000-0000-0000-000000000001')), 1, 'AC-SEC-227 Admin reads the payment ceiling');

-- AC-SEC-228: tenancy — an Engineer in another organisation reads only their own request there.
set local request.jwt.claims = '{"sub":"03500000-0000-0000-0000-0000000000e9","role":"authenticated"}';
select results_eq($$select id from public.procurements order by 1$$, $$values ('03500001-0000-0000-0000-000000000003'::uuid)$$, 'AC-SEC-228 other-organisation Engineer reads only their own request');
select results_eq($$select id from public.procurement_items order by 1$$, $$values ('03500002-0000-0000-0000-000000000003'::uuid)$$, 'AC-SEC-228 other-organisation Engineer reads only their own request items');
select is_empty($$select id from public.procurement_invoices$$, 'AC-SEC-228 other-organisation Engineer reads no vendor bills');
select results_eq($$select id from storage.objects where bucket_id = 'procurement-files' and id::text like '035000%' order by 1$$, $$values ('03500050-0000-0000-0000-000000000003'::uuid)$$, 'AC-SEC-228 other-organisation Engineer reads only their own request files');
select is_empty($$select * from public.procurement_payment_within_ceiling('03500001-0000-0000-0000-000000000001')$$, 'AC-SEC-228 payment ceiling returns nothing across organisations');

reset role;
select * from finish();
rollback;
