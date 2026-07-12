-- erpnext_procurement_flip_rls.test.sql
-- AC-ENA-003 (procurement) [pgTAP] — OWNS AC-ENA-003 + the §7 per-table proof for
-- procurement_items/purchase_requests/rfqs/procurement_quotations (docs/specs/erpnext-adapter.spec.md
-- §7/§9). References but does NOT own AC-ENA-072 (owner: slice 6 erpnext_money_flip_rls.test.sql).
--
-- AC-ENA-003 (the owner): Given org A `procurement`->`erpnext` and org B not flipped, a delivery-role
-- member of org B performing a native procurement write (the `createPurchaseRequest` RPC path)
-- succeeds via the direct DAL (org B byte-for-byte pre-P2); the SAME write in org A is RLS-denied on
-- native cols (the migration 0097 native-mirror-guard triggers, fired even through the SECURITY
-- DEFINER `create_purchase_request` RPC, since a trigger always fires regardless of definer-bypassed
-- RLS on the underlying INSERT).
--
-- §7 per-table proofs:
--   * procurement_items: service-role write setting erp_line_amount (NOT amount) -> lives_ok, and the
--     GENERATED amount is unaffected (FR-ENA-071); a user native UPDATE to quantity/rate/erp_line_amount
--     -> 42501.
--   * purchase_requests/rfqs: user native write (pr_number/rfq_number/amount/erp_*) -> 42501;
--     service-role -> lives_ok; status CHECK preserved; org-isolated.
--   * procurement_quotations: native (total_amount/vq_number/erp_*) user write -> 42501; the
--     PMO enhancement `is_selected` stays user-writable; `procurement_quotations_one_selected_idx`
--     intact under flip.
--   * procurements (case aggregate): stays user-writable even when `procurement` is externally-owned
--     (the case folder is PMO's — FR-ENA-073/101).
begin;
select plan(25);

insert into organizations (id, name) values
  ('00970000-0000-0000-0000-000000000001','AC-ENA-003 Procurement Org A (flipped)'),
  ('00970000-0000-0000-0000-000000000002','AC-ENA-003 Procurement Org B (PMO-owned)');

insert into auth.users (id, email) values
  ('00970000-0000-0000-0000-0000000000a1','ena003-a-admin@example.com'),
  ('00970000-0000-0000-0000-0000000000b1','ena003-b-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('00970000-0000-0000-0000-0000000000a1','00970000-0000-0000-0000-000000000001','Org A Admin','ena003-a-admin@example.com','Admin','active'),
  ('00970000-0000-0000-0000-0000000000b1','00970000-0000-0000-0000-000000000002','Org B Admin','ena003-b-admin@example.com','Admin','active');

reset role;
insert into procurements (id, org_id, code, title, status) values
  ('00970000-0000-0000-0000-000000000010','00970000-0000-0000-0000-000000000001','ENA-A-001','Org A Case','Draft'),
  ('00970000-0000-0000-0000-000000000020','00970000-0000-0000-0000-000000000002','ENA-B-001','Org B Case','Draft');

insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('00970000-0000-0000-0000-000000000110','00970000-0000-0000-0000-000000000001','00970000-0000-0000-0000-000000000010','Item A',2,100);

insert into purchase_requests (id, org_id, procurement_id, pr_number, status, amount) values
  ('00970000-0000-0000-0000-000000000120','00970000-0000-0000-0000-000000000001','00970000-0000-0000-0000-000000000010','MAT-REQ-2026-00001','Draft',200);

insert into rfqs (id, org_id, procurement_id, rfq_number, status, amount) values
  ('00970000-0000-0000-0000-000000000130','00970000-0000-0000-0000-000000000001','00970000-0000-0000-0000-000000000010','PUR-RFQ-2026-00001','Draft',null);

insert into companies (id, org_id, name, type) values
  ('00970000-0000-0000-0000-000000000140','00970000-0000-0000-0000-000000000001','Spike Supplier','Vendor');

insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, is_selected) values
  ('00970000-0000-0000-0000-000000000150','00970000-0000-0000-0000-000000000001','00970000-0000-0000-0000-000000000010','00970000-0000-0000-0000-000000000140',150,false);

-- Flip org A's `procurement` domain to `erpnext`; org B stays PMO-owned (unflipped, byte-for-byte).
insert into external_domain_ownership (org_id, external_tier, domain)
values ('00970000-0000-0000-0000-000000000001','erpnext','procurement');

-- ── AC-ENA-003 core: the createPurchaseRequest RPC path (org B lives, org A denied) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$ select create_purchase_request('00970000-0000-0000-0000-000000000020','PO-REF-B','Draft',current_date,500) $$,
  'AC-ENA-003 org B (not flipped) createPurchaseRequest succeeds via the direct DAL (byte-for-byte pre-P2)');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select create_purchase_request('00970000-0000-0000-0000-000000000010','PO-REF-A','Draft',current_date,500) $$,
  '42501', null,
  'AC-ENA-003 org A (flipped) the SAME createPurchaseRequest write is RLS-denied on native cols');

-- ── procurement_items: §7 ──
select throws_ok(
  $$ update procurement_items set quantity = 9 where id = '00970000-0000-0000-0000-000000000110' $$,
  '42501', null,
  'procurement_items user native UPDATE to quantity denied while procurement externally-owned');
select throws_ok(
  $$ update procurement_items set rate = 9 where id = '00970000-0000-0000-0000-000000000110' $$,
  '42501', null,
  'procurement_items user native UPDATE to rate denied while procurement externally-owned');
select throws_ok(
  $$ update procurement_items set erp_line_amount = 9 where id = '00970000-0000-0000-0000-000000000110' $$,
  '42501', null,
  'procurement_items user native UPDATE to erp_line_amount denied while procurement externally-owned');
select lives_ok(
  $$ update procurement_items set name = 'Item A renamed by PMO' where id = '00970000-0000-0000-0000-000000000110' $$,
  'procurement_items PMO-owned enhancement (name) stays user-writable while flipped');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update procurement_items set quantity = 3, rate = 111, erp_line_amount = 333 where id = '00970000-0000-0000-0000-000000000110' $$,
  'procurement_items service-role write setting erp_line_amount (NOT amount) lives_ok');
select is(
  (select amount from procurement_items where id = '00970000-0000-0000-0000-000000000110'),
  333::numeric(14,2),
  'procurement_items GENERATED amount (quantity*rate) unaffected by the erp_line_amount mirror');

-- ── purchase_requests: §7 ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update purchase_requests set pr_number = 'HACKED' where id = '00970000-0000-0000-0000-000000000120' $$,
  '42501', null,
  'purchase_requests user native UPDATE to pr_number denied while procurement externally-owned');
select throws_ok(
  $$ update purchase_requests set amount = 999 where id = '00970000-0000-0000-0000-000000000120' $$,
  '42501', null,
  'purchase_requests user native UPDATE to amount denied while procurement externally-owned');
select throws_ok(
  $$ insert into purchase_requests (org_id, procurement_id, pr_number, status)
     values ('00970000-0000-0000-0000-000000000001','00970000-0000-0000-0000-000000000010','DIRECT-INSERT','Draft') $$,
  '42501', null,
  'purchase_requests user native INSERT denied while procurement externally-owned');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update purchase_requests set amount = 250.00, erp_docstatus = 1, erp_modified = '2026-07-11 10:00:00' where id = '00970000-0000-0000-0000-000000000120' $$,
  'purchase_requests service-role mirror write lives_ok');
select throws_ok(
  $$ update purchase_requests set status = 'not-a-real-status' where id = '00970000-0000-0000-0000-000000000120' $$,
  '23514', null,
  'purchase_requests status CHECK constraint preserved under the flip');

-- ── rfqs: §7 ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update rfqs set rfq_number = 'HACKED' where id = '00970000-0000-0000-0000-000000000130' $$,
  '42501', null,
  'rfqs user native UPDATE to rfq_number denied while procurement externally-owned');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update rfqs set amount = 0, erp_docstatus = 1, erp_modified = '2026-07-11 10:00:00' where id = '00970000-0000-0000-0000-000000000130' $$,
  'rfqs service-role mirror write lives_ok');

-- ── procurement_quotations: §7 (Finding 8 — is_selected preserved) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update procurement_quotations set total_amount = 999 where id = '00970000-0000-0000-0000-000000000150' $$,
  '42501', null,
  'procurement_quotations user native UPDATE to total_amount denied while procurement externally-owned');
select throws_ok(
  $$ update procurement_quotations set vq_number = 'HACKED' where id = '00970000-0000-0000-0000-000000000150' $$,
  '42501', null,
  'procurement_quotations user native UPDATE to vq_number denied while procurement externally-owned');
select lives_ok(
  $$ update procurement_quotations set is_selected = true where id = '00970000-0000-0000-0000-000000000150' $$,
  'procurement_quotations PMO enhancement is_selected stays user-writable while flipped');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$ insert into procurement_quotations (org_id, procurement_id, vendor_id, total_amount, is_selected)
     values ('00970000-0000-0000-0000-000000000001','00970000-0000-0000-0000-000000000010','00970000-0000-0000-0000-000000000140',77,true) $$,
  '23505', null,
  'procurement_quotations_one_selected_idx still enforces at most one is_selected per procurement under flip');
select lives_ok(
  $$ update procurement_quotations set total_amount = 150000, vq_number = 'PUR-SQTN-2026-00001', erp_docstatus = 1 where id = '00970000-0000-0000-0000-000000000150' $$,
  'procurement_quotations service-role mirror write lives_ok');

-- ── procurements (case aggregate): stays user-writable even when procurement is externally-owned ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update procurements set title = 'Org A Case (renamed by PMO)' where id = '00970000-0000-0000-0000-000000000010' $$,
  'AC-ENA-101/073 procurements case aggregate stays user-writable while procurement is externally-owned');

-- ── org-isolation: org B never sees/affects org A's flipped-domain rows or vice versa ──
set local request.jwt.claims = '{"sub":"00970000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  (select count(*)::int from purchase_requests where id = '00970000-0000-0000-0000-000000000120'),
  0,
  'purchase_requests org-isolated: org B cannot see org A''s row');
select is(
  (select count(*)::int from rfqs where id = '00970000-0000-0000-0000-000000000130'),
  0,
  'rfqs org-isolated: org B cannot see org A''s row');
select is(
  (select count(*)::int from procurement_quotations where id = '00970000-0000-0000-0000-000000000150'),
  0,
  'procurement_quotations org-isolated: org B cannot see org A''s row');
select is(
  (select count(*)::int from procurement_items where id = '00970000-0000-0000-0000-000000000110'),
  0,
  'procurement_items org-isolated: org B cannot see org A''s row');

select finish();
rollback;
