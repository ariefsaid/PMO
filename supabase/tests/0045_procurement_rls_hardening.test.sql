-- 0045_procurement_rls_hardening.test.sql
-- MED SoD bypass (same class as MED-TS-2 / MED-PR-1): the procurement state-machine columns
-- (status, pr_number, po_number, approved_by_id, approval_notes, rejection_notes) are RPC-only.
-- A direct `update procurements set status=...` / `set approved_by_id=...` by a 4-role insider MUST
-- be denied (column-level UPDATE revoked from `authenticated`) so transition_procurement's legal-map +
-- role×transition matrix + separation-of-duties can't be bypassed. The RPC path must still work, and a
-- direct UPDATE of a NON-revoked column (total_value on a Draft) must still work (no over-revoke).
-- Defense-in-depth: the child doc-number columns (vq_number / gr_number / vi_number) are minter-only too.
-- (FR-PROC-001..009, ADR-0011/0012; mirrors 0033 MED-PR-1)
begin;
select plan(8);

-- Fixtures: one org; a Finance requester (X), a different Finance (Y), a vendor.
insert into organizations (id, name) values
  ('00450000-0000-0000-0000-000000000001','Proc Hardening Org');

insert into auth.users (id, email) values
  ('00450000-0000-0000-0000-0000000000a1','proc-hard-fin-x@example.com'),
  ('00450000-0000-0000-0000-0000000000a2','proc-hard-fin-y@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00450000-0000-0000-0000-0000000000a1','00450000-0000-0000-0000-000000000001','Fin X','proc-hard-fin-x@example.com','Finance'),
  ('00450000-0000-0000-0000-0000000000a2','00450000-0000-0000-0000-000000000001','Fin Y','proc-hard-fin-y@example.com','Finance');

insert into companies (id, org_id, name, type) values
  ('00450000-0000-0000-0000-0000000000b1','00450000-0000-0000-0000-000000000001','Vendor V','Vendor');

-- Procurement #1: a Requested proc, requested_by = Fin Y (so Fin X can legitimately approve via RPC).
insert into procurements (id, org_id, title, status, total_value, requested_by_id) values
  ('00450000-0000-0000-0000-000000000010','00450000-0000-0000-0000-000000000001',
   'Hardening Proc','Requested',1000,'00450000-0000-0000-0000-0000000000a2');

-- Procurement #2: a Draft proc for the non-revoked-column edit test.
insert into procurements (id, org_id, title, status, total_value, requested_by_id) values
  ('00450000-0000-0000-0000-000000000011','00450000-0000-0000-0000-000000000001',
   'Draft Proc','Draft',500,'00450000-0000-0000-0000-0000000000a1');

-- A child quotation for the vq_number lock test.
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, vq_number) values
  ('00450000-0000-0000-0000-0000000000c1','00450000-0000-0000-0000-000000000001',
   '00450000-0000-0000-0000-000000000010','00450000-0000-0000-0000-0000000000b1',1000,'VQ-260605-0001');

-- A child receipt for the gr_number lock test.
insert into procurement_receipts (id, org_id, procurement_id, status, gr_number) values
  ('00450000-0000-0000-0000-0000000000c2','00450000-0000-0000-0000-000000000001',
   '00450000-0000-0000-0000-000000000010','Complete','GR-260605-0001');

-- A child invoice for the vi_number lock test.
insert into procurement_invoices (id, org_id, procurement_id, status, vi_number) values
  ('00450000-0000-0000-0000-0000000000c3','00450000-0000-0000-0000-000000000001',
   '00450000-0000-0000-0000-000000000010','Received','VI-260605-0001');

-- Act as the in-org Finance Fin X (a 4-role insider; passes procurements_update's role gate).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00450000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ── Test (i): direct UPDATE of status → denied (column-level UPDATE revoked) ──
select throws_ok(
  $$ update procurements set status = 'Paid'
       where id = '00450000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'MED-SoD: direct UPDATE procurements.status by a 4-role user is denied (RPC-only column)');

-- ── Test (ii): direct UPDATE of approved_by_id → denied (forging the approver / SoD) ──
select throws_ok(
  $$ update procurements set approved_by_id = '00450000-0000-0000-0000-0000000000a1'
       where id = '00450000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'MED-SoD: direct UPDATE procurements.approved_by_id by a 4-role user is denied (RPC-only column)');

-- ── Test (iii): direct UPDATE of pr_number → denied (RPC-only doc number) ──
select throws_ok(
  $$ update procurements set pr_number = 'PR-FORGED'
       where id = '00450000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'MED-SoD: direct UPDATE procurements.pr_number by a 4-role user is denied (RPC-only column)');

-- ── Test (iv): the RPC path STILL works (Fin X approves Fin Y's Requested proc) ──
select lives_ok(
  $$ select transition_procurement('00450000-0000-0000-0000-000000000010','Approved') $$,
  'MED-SoD: transition_procurement (security-definer RPC) still performs the Approve transition');

-- ── Test (v): direct UPDATE of a NON-revoked column STILL works (no over-revoke) ──
select lives_ok(
  $$ update procurements set total_value = 750
       where id = '00450000-0000-0000-0000-000000000011' $$,
  'MED-SoD: direct UPDATE of a non-revoked column (total_value) on a Draft still works for a 4-role user');

-- ── Test (vi): direct UPDATE of child vq_number → denied (minter-only) ──
select throws_ok(
  $$ update procurement_quotations set vq_number = 'VQ-FORGED'
       where id = '00450000-0000-0000-0000-0000000000c1' $$,
  '42501', null,
  'MED-SoD: direct UPDATE procurement_quotations.vq_number is denied (minter-only column)');

-- ── Test (vii): direct UPDATE of child gr_number → denied (minter-only) ──
select throws_ok(
  $$ update procurement_receipts set gr_number = 'GR-FORGED'
       where id = '00450000-0000-0000-0000-0000000000c2' $$,
  '42501', null,
  'MED-SoD: direct UPDATE procurement_receipts.gr_number is denied (minter-only column)');

-- ── Test (viii): direct UPDATE of child vi_number → denied (minter-only) ──
select throws_ok(
  $$ update procurement_invoices set vi_number = 'VI-FORGED'
       where id = '00450000-0000-0000-0000-0000000000c3' $$,
  '42501', null,
  'MED-SoD: direct UPDATE procurement_invoices.vi_number is denied (minter-only column)');

reset role;
select * from finish();
rollback;
