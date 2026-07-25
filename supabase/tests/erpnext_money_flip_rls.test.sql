-- erpnext_money_flip_rls.test.sql (Slice 6, task 6.1) — OWNS AC-ENA-072 (the cross-table money-flip
-- contract). Consolidates the §7 per-table proofs the slice-3/4/5 files reference: `procurement_invoices`
-- + `payments` (this slice's flip, migration 0099) PLUS the cross-table assertion spanning
-- purchase_orders/companies/procurement_quotations/procurements (the whole money surface at once).
--
-- Grant topology (verified against 0075_explicit_api_grants.sql):
--   • procurement_invoices — live INSERT grant + column UPDATE grant (id,org_id,procurement_id,
--     invoice_date,status,created_at). So its native-mirror-guard trigger + RLS insert-policy split are
--     the actually-effective gates, alongside create_procurement_invoice's RPC guard.
--   • payments — NO direct INSERT/UPDATE grant (select/trigger only). Its only write path is the
--     SECURITY DEFINER create_payment RPC (bypasses table RLS) — so the RPC's domain_externally_owned
--     guard is the REAL flip gate; the RLS/trigger split is defense-in-depth.
begin;
select plan(23);

insert into organizations (id, name) values
  ('00990000-0000-0000-0000-000000000001','AC-ENA money Org A (flipped)'),
  ('00990000-0000-0000-0000-000000000002','AC-ENA money Org B (not flipped)');
insert into auth.users (id, email) values
  ('00990000-0000-0000-0000-0000000000a1','money-a@example.com'),
  ('00990000-0000-0000-0000-0000000000b1','money-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00990000-0000-0000-0000-0000000000a1','00990000-0000-0000-0000-000000000001','A Admin','money-a@example.com','Admin','active'),
  ('00990000-0000-0000-0000-0000000000b1','00990000-0000-0000-0000-000000000002','B Admin','money-b@example.com','Admin','active');

-- Seed (as owner — bypasses RLS for seed convenience). Seeded BEFORE the flip so the quotation mirror
-- fixture is not blocked by the H-2 procurement_quotations INSERT guard (a user/owner INSERT is denied
-- once flipped — these rows model pre-flip state the org carries into the flip).
insert into companies (id, org_id, name, type) values
  ('00990000-0000-0000-0000-0000000000f1','00990000-0000-0000-0000-000000000001','Money Supplier','Vendor');
insert into procurements (id, org_id, title, status, vendor_id) values
  ('00990000-0000-0000-0000-0000000000c1','00990000-0000-0000-0000-000000000001','Org A money case','Vendor Invoiced','00990000-0000-0000-0000-0000000000f1'),
  ('00990000-0000-0000-0000-0000000000c2','00990000-0000-0000-0000-000000000002','Org B case','Ordered',null);
insert into purchase_orders (id, org_id, procurement_id, po_number, reference_number, status, date, amount) values
  ('00990000-0000-0000-0000-0000000000d1','00990000-0000-0000-0000-000000000001','00990000-0000-0000-0000-0000000000c1','PUR-ORD-M1','REF-M1','Draft','2026-07-11',500);
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, reference_number, amount, po_id) values
  ('00990000-0000-0000-0000-0000000000e1','00990000-0000-0000-0000-000000000001','00990000-0000-0000-0000-0000000000c1','VI-M1','2026-07-12','Received','BILL-M1',500,'00990000-0000-0000-0000-0000000000d1');
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, received_date, vq_number, is_selected) values
  ('00990000-0000-0000-0000-0000000000a2','00990000-0000-0000-0000-000000000001','00990000-0000-0000-0000-0000000000c1','00990000-0000-0000-0000-0000000000f1',500,'2026-07-10','VQ-M1',false);
insert into payments (id, org_id, procurement_id, invoice_id, pay_number, status, date, amount) values
  ('00990000-0000-0000-0000-000000000091','00990000-0000-0000-0000-000000000001','00990000-0000-0000-0000-0000000000c1','00990000-0000-0000-0000-0000000000e1','PAY-M1','Scheduled','2026-07-13',500);

-- Org A flips BOTH money-bearing domains: companies (Supplier) AND procurement (the whole buy-side
-- chain). Done AFTER the seed so the fixtures above model pre-flip state (H-2: a user/owner INSERT into
-- an ERP-sourced table is denied once flipped).
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('00990000-0000-0000-0000-000000000001','erpnext','companies'),
  ('00990000-0000-0000-0000-000000000001','erpnext','procurement');

-- ── procurement_invoices per-table (org A, flipped) ───────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00990000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update procurement_invoices set status = 'Paid' where id = '00990000-0000-0000-0000-0000000000e1' $$,
  '42501', null,
  'AC-ENA-072 procurement_invoices: user-JWT native-field UPDATE (status) denied while procurement is externally-owned');
select throws_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, vi_number, invoice_date, status)
       values ('00990000-0000-0000-0000-000000000001','00990000-0000-0000-0000-0000000000c1','VI-M2','2026-07-12','Received') $$,
  '42501', null,
  'AC-ENA-072 procurement_invoices: user-JWT raw INSERT denied while flipped');
select throws_ok(
  $$ select create_procurement_invoice('00990000-0000-0000-0000-0000000000c1','Received'::procurement_invoice_status,'2026-07-12','BILL-2',250) $$,
  '42501', null,
  'AC-ENA-072 procurement_invoices: create_procurement_invoice RPC refuses while procurement is externally-owned');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update procurement_invoices set amount = 750, erp_outstanding_amount = 0, status = 'Paid',
       erp_docstatus = 1, erp_modified = '2026-07-12 09:00:00.000000' where id = '00990000-0000-0000-0000-0000000000e1' $$,
  'AC-ENA-072 procurement_invoices: service-role UPDATE of native + erp_outstanding_amount + erp_* mirror cols succeeds');
select is(
  (select amount from procurement_invoices where id = '00990000-0000-0000-0000-0000000000e1'), 750::numeric,
  'AC-ENA-072 procurement_invoices: amount preserved by the service-role mirror write');
select is(
  (select po_id from procurement_invoices where id = '00990000-0000-0000-0000-0000000000e1'),
  '00990000-0000-0000-0000-0000000000d1'::uuid,
  'AC-ENA-072 procurement_invoices: po_id FK preserved under the flip');

-- ── payments per-table (org A, flipped) ───────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00990000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select create_payment('00990000-0000-0000-0000-0000000000c1','00990000-0000-0000-0000-0000000000e1','REF','Scheduled','2026-07-13',100) $$,
  '42501', null,
  'AC-ENA-072 payments: create_payment RPC refuses while procurement is externally-owned (the real gate — payments is RPC-only write)');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update payments set amount = 750, status = 'Paid', erp_docstatus = 1, erp_modified = '2026-07-13 09:00:00.000000'
       where id = '00990000-0000-0000-0000-000000000091' $$,
  'AC-ENA-072 payments: service-role UPDATE of native + erp_* mirror cols succeeds');
select is(
  (select invoice_id from payments where id = '00990000-0000-0000-0000-000000000091'),
  '00990000-0000-0000-0000-0000000000e1'::uuid,
  'AC-ENA-072 payments: invoice_id FK + same-case invariant preserved under the flip (FR-ENA-130d)');
select throws_ok(
  $$ update payments set amount = -1 where id = '00990000-0000-0000-0000-000000000091' $$,
  '23514', null,
  'AC-ENA-072 payments: payments_amount_nonneg CHECK preserved under the flip (a negative amount is still rejected)');
select lives_ok(
  $$ update payments set amount = null where id = '00990000-0000-0000-0000-000000000091' $$,
  'AC-ENA-072 payments: a null amount stays legal (nulls -> NULL, FR-ENA-072) under the flip');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00990000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from payments where id = '00990000-0000-0000-0000-000000000091'), 0,
  'AC-ENA-072 payments: org isolation — org-B member reads nothing of org-A''s row');

-- ── AC-ENA-072 cross-table (org A flipped on companies + procurement): the whole money surface ────
set local request.jwt.claims = '{"sub":"00990000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update procurement_invoices set amount = 1 where id = '00990000-0000-0000-0000-0000000000e1' $$,
  '42501', null,
  'AC-ENA-072 cross-table: user-JWT write to procurement_invoices.amount (native mirror) denied while flipped');
select throws_ok(
  $$ update purchase_orders set po_number = 'HACKED' where id = '00990000-0000-0000-0000-0000000000d1' $$,
  '42501', null,
  'AC-ENA-072 cross-table: user-JWT write to purchase_orders.po_number (native mirror) denied while flipped');
select throws_ok(
  $$ update companies set name = 'HACKED' where id = '00990000-0000-0000-0000-0000000000f1' $$,
  '42501', null,
  'AC-ENA-072 cross-table: user-JWT write to companies.name (native mirror) denied while companies is externally-owned');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update procurement_invoices set amount = 800 where id = '00990000-0000-0000-0000-0000000000e1' $$,
  'AC-ENA-072 cross-table: service-role write to procurement_invoices.amount succeeds');
select lives_ok(
  $$ update purchase_orders set po_number = 'PUR-ORD-M1-AMENDED' where id = '00990000-0000-0000-0000-0000000000d1' $$,
  'AC-ENA-072 cross-table: service-role write to purchase_orders.po_number succeeds');
select lives_ok(
  $$ update companies set name = 'Money Supplier (mirrored)' where id = '00990000-0000-0000-0000-0000000000f1' $$,
  'AC-ENA-072 cross-table: service-role write to companies.name succeeds');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00990000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update procurement_quotations set is_selected = true where id = '00990000-0000-0000-0000-0000000000a2' $$,
  'AC-ENA-072 cross-table: user write to the PMO enhancement procurement_quotations.is_selected still succeeds while flipped');
select lives_ok(
  $$ update companies set archived_at = now() where id = '00990000-0000-0000-0000-0000000000f1' $$,
  'AC-ENA-072 cross-table: user write to the PMO enhancement companies.archived_at still succeeds while flipped');
select is(
  (select count(*)::int from procurements where org_id = '00990000-0000-0000-0000-000000000001'), 1,
  'AC-ENA-072 cross-table: the procurements case aggregate (the PMO-owned case row) is still readable while flipped');

-- ── Org B (not flipped): both create RPCs still succeed byte-for-byte ──────────────────────────────
set local request.jwt.claims = '{"sub":"00990000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$ select create_procurement_invoice('00990000-0000-0000-0000-0000000000c2','Received'::procurement_invoice_status,'2026-07-12','BILL-B',300) $$,
  'AC-ENA-072 procurement_invoices: org-B (not flipped) create_procurement_invoice RPC still succeeds (byte-for-byte)');
select lives_ok(
  $$ select create_payment('00990000-0000-0000-0000-0000000000c2',null,'REF-B','Scheduled','2026-07-13',300) $$,
  'AC-ENA-072 payments: org-B (not flipped) create_payment RPC still succeeds (byte-for-byte)');

reset role;
select finish();
rollback;
