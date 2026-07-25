-- erpnext_po_receipts_flip_rls.test.sql (Slice 5, task 5.1)
-- §7 per-table proof for `purchase_orders` + `procurement_receipts` under the `procurement` domain flip.
-- REFERENCES AC-ENA-072 (the cross-table money-flip owner, slice 6 erpnext_money_flip_rls.test.sql) — this
-- file does NOT own it. Also proves 5.8's FK-integrity assertion (procurement_receipts.po_id survives a
-- service-role write, the same-case invariant).
--
-- NOTE (grant topology, verified against 0075_explicit_api_grants.sql): `purchase_orders` carries NO
-- direct INSERT/UPDATE grant for `authenticated` at all — its only write path is the SECURITY DEFINER
-- `create_purchase_order` RPC (which bypasses table RLS). So the REAL flip gate for purchase_orders is
-- the `domain_externally_owned` guard added to that RPC (proven below), not the table policy split (kept
-- for defense-in-depth/consistency, but the pre-existing grant absence already denies a raw write).
-- `procurement_receipts` DOES carry a live INSERT grant + a column UPDATE grant (id, org_id,
-- procurement_id, receipt_date, status, created_at) — so its table-level native-mirror-guard trigger +
-- RLS insert-policy split are the actually-effective gates, in addition to its own creation RPC's guard.
begin;
select plan(16);

insert into organizations (id, name) values
  ('00980000-0000-0000-0000-000000000001','AC-ENA PO/GR Org A (flipped)'),
  ('00980000-0000-0000-0000-000000000002','AC-ENA PO/GR Org B (not flipped)');
insert into auth.users (id, email) values
  ('00980000-0000-0000-0000-0000000000a1','po-gr-a@example.com'),
  ('00980000-0000-0000-0000-0000000000b1','po-gr-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00980000-0000-0000-0000-0000000000a1','00980000-0000-0000-0000-000000000001','A Admin','po-gr-a@example.com','Admin','active'),
  ('00980000-0000-0000-0000-0000000000b1','00980000-0000-0000-0000-000000000002','B Admin','po-gr-b@example.com','Admin','active');

-- Flip org A's `procurement` domain to `erpnext`; org B stays unflipped (byte-for-byte).
insert into external_domain_ownership (org_id, external_tier, domain)
values ('00980000-0000-0000-0000-000000000001','erpnext','procurement');

-- Parent case rows (as owner — bypasses RLS for seed convenience).
insert into procurements (id, org_id, title, status) values
  ('00980000-0000-0000-0000-0000000000c1','00980000-0000-0000-0000-000000000001','Org A case','Ordered'),
  ('00980000-0000-0000-0000-0000000000c2','00980000-0000-0000-0000-000000000002','Org B case','Ordered');

insert into purchase_orders (id, org_id, procurement_id, po_number, reference_number, status, date, amount) values
  ('00980000-0000-0000-0000-0000000000d1','00980000-0000-0000-0000-000000000001','00980000-0000-0000-0000-0000000000c1','PUR-ORD-1','REF-1','Draft','2026-07-11',100);

insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status, po_id) values
  ('00980000-0000-0000-0000-0000000000e1','00980000-0000-0000-0000-000000000001','00980000-0000-0000-0000-0000000000c1','GR-1','2026-07-12','Partial','00980000-0000-0000-0000-0000000000d1');

-- ── purchase_orders (org A, flipped) ──────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00980000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update purchase_orders set po_number = 'HACKED' where id = '00980000-0000-0000-0000-0000000000d1' $$,
  '42501', null,
  'AC-ENA-052 purchase_orders: user-JWT native-field UPDATE (po_number) denied while procurement is externally-owned');
select throws_ok(
  $$ update purchase_orders set amount = 999 where id = '00980000-0000-0000-0000-0000000000d1' $$,
  '42501', null,
  'AC-ENA-052 purchase_orders: user-JWT native-field UPDATE (amount) denied while flipped');
select throws_ok(
  $$ insert into purchase_orders (org_id, procurement_id, po_number, status)
       values ('00980000-0000-0000-0000-000000000001','00980000-0000-0000-0000-0000000000c1','PUR-ORD-2','Draft') $$,
  '42501', null,
  'AC-ENA-052 purchase_orders: user-JWT raw INSERT denied while procurement is externally-owned');
-- The REAL flip gate: create_purchase_order (SECURITY DEFINER, bypasses table RLS) must itself refuse
-- while the org's procurement domain is externally-owned — never a route back to the direct DAL.
select throws_ok(
  $$ select create_purchase_order('00980000-0000-0000-0000-0000000000c1','REF-2','Draft','2026-07-11',150) $$,
  '42501', null,
  'AC-ENA-052 purchase_orders: create_purchase_order RPC refuses while procurement is externally-owned');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update purchase_orders set po_number = 'PUR-ORD-1-AMENDED', erp_docstatus = 1, erp_modified = '2026-07-11 10:00:00.000000'
       where id = '00980000-0000-0000-0000-0000000000d1' $$,
  'AC-ENA-052 purchase_orders: service-role UPDATE of native + erp_* mirror cols succeeds');
select is(
  (select status from purchase_orders where id = '00980000-0000-0000-0000-0000000000d1'), 'Draft',
  'AC-ENA-052 purchase_orders: status CHECK constraint preserved under the flip (value unchanged, still legal)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00980000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from purchase_orders where id = '00980000-0000-0000-0000-0000000000d1'), 0,
  'AC-ENA-052 purchase_orders: org isolation — org-B member reads nothing of org-A''s row');

-- Org B (not flipped): create_purchase_order RPC still succeeds (byte-for-byte, no flip).
select lives_ok(
  $$ select create_purchase_order('00980000-0000-0000-0000-0000000000c2','REF-B-1','Draft','2026-07-11',200) $$,
  'AC-ENA-052 purchase_orders: org-B (not flipped) create_purchase_order RPC still succeeds (byte-for-byte)');

-- ── procurement_receipts (org A, flipped) ─────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00980000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update procurement_receipts set status = 'Complete' where id = '00980000-0000-0000-0000-0000000000e1' $$,
  '42501', null,
  'AC-ENA-052 procurement_receipts: user-JWT native-field UPDATE (status) denied while flipped');
select throws_ok(
  $$ insert into procurement_receipts (org_id, procurement_id, gr_number, status)
       values ('00980000-0000-0000-0000-000000000001','00980000-0000-0000-0000-0000000000c1','GR-2','Partial') $$,
  '42501', null,
  'AC-ENA-052 procurement_receipts: user-JWT raw INSERT denied while flipped');
select throws_ok(
  $$ select create_procurement_receipt('00980000-0000-0000-0000-0000000000c1','Partial','2026-07-12') $$,
  '42501', null,
  'AC-ENA-052 procurement_receipts: create_procurement_receipt RPC refuses while procurement is externally-owned');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update procurement_receipts set gr_number = 'GR-1-AMENDED', po_id = '00980000-0000-0000-0000-0000000000d1',
       status = 'Complete', erp_docstatus = 1, erp_modified = '2026-07-11 10:05:00.000000'
       where id = '00980000-0000-0000-0000-0000000000e1' $$,
  'AC-ENA-052/5.8 procurement_receipts: service-role UPDATE of native + po_id FK + erp_* mirror cols succeeds');
select is(
  (select po_id from procurement_receipts where id = '00980000-0000-0000-0000-0000000000e1'),
  '00980000-0000-0000-0000-0000000000d1'::uuid,
  'AC-ENA-052/5.8 procurement_receipts: po_id FK integrity preserved under a service-role mirror write (same-case invariant)');
select is(
  (select status from procurement_receipts where id = '00980000-0000-0000-0000-0000000000e1'), 'Complete',
  'AC-ENA-052 procurement_receipts: procurement_receipt_status enum (Partial|Complete) preserved under the flip');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00980000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from procurement_receipts where id = '00980000-0000-0000-0000-0000000000e1'), 0,
  'AC-ENA-052 procurement_receipts: org isolation — org-B member reads nothing of org-A''s row');

-- Org B (not flipped): create_procurement_receipt RPC still succeeds (byte-for-byte, no flip).
select lives_ok(
  $$ select create_procurement_receipt('00980000-0000-0000-0000-0000000000c2','Partial','2026-07-12') $$,
  'AC-ENA-052 procurement_receipts: org-B (not flipped) create_procurement_receipt RPC still succeeds (byte-for-byte)');

reset role;
select finish();
rollback;
