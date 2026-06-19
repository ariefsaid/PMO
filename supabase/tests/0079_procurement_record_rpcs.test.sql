-- 0079_procurement_record_rpcs.test.sql — Creation RPCs: minting, permissive capture, cross-org, role gate.
-- Migration under test: 0037_procurement_record_rpcs.sql
--
-- AC-PR-004  minting format + per-day increment for all four prefixes (PR/RFQ/PO/PAY)
-- AC-PR-014  capture does NOT force a status transition (permissive, OD-PROC-7-D)
-- AC-PR-015  cross-org create → 42501 (parent-org guard) for each of the four RPCs
-- AC-PR-016  Admin / Executive / Finance each create a record under an in-org case → lives_ok
-- AC-PR-017  Engineer cannot create (4-role gate) → 42501
begin;
select plan(16);

-- ── Fixtures (inserted as table owner — bypasses RLS) ─────────────────────────
insert into organizations (id, name) values
  ('00790000-0000-0000-0000-000000000001', 'RPC Org A'),
  ('00790000-0000-0000-0000-000000000002', 'RPC Org B');

insert into auth.users (id, email) values
  ('00790000-0000-0000-0000-0000000000a1', 'pm-rpc@example.com'),
  ('00790000-0000-0000-0000-0000000000a2', 'admin-rpc@example.com'),
  ('00790000-0000-0000-0000-0000000000a3', 'fin-rpc@example.com'),
  ('00790000-0000-0000-0000-0000000000a4', 'exec-rpc@example.com'),
  ('00790000-0000-0000-0000-0000000000a5', 'eng-rpc@example.com'),
  ('00790000-0000-0000-0000-0000000000b1', 'pm-rpc-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00790000-0000-0000-0000-0000000000a1','00790000-0000-0000-0000-000000000001','PM A','pm-rpc@example.com','Project Manager'),
  ('00790000-0000-0000-0000-0000000000a2','00790000-0000-0000-0000-000000000001','Admin A','admin-rpc@example.com','Admin'),
  ('00790000-0000-0000-0000-0000000000a3','00790000-0000-0000-0000-000000000001','Fin A','fin-rpc@example.com','Finance'),
  ('00790000-0000-0000-0000-0000000000a4','00790000-0000-0000-0000-000000000001','Exec A','exec-rpc@example.com','Executive'),
  ('00790000-0000-0000-0000-0000000000a5','00790000-0000-0000-0000-000000000001','Eng A','eng-rpc@example.com','Engineer'),
  ('00790000-0000-0000-0000-0000000000b1','00790000-0000-0000-0000-000000000002','PM B','pm-rpc-b@example.com','Project Manager');

-- Org-A: one procurement in Draft (for minting + role tests)
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00790000-0000-0000-0000-000000000010','00790000-0000-0000-0000-000000000001',
   'RPC Test Case A','Draft','00790000-0000-0000-0000-0000000000a1');

-- Org-A: one procurement in Ordered (for AC-PR-014 permissive capture)
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00790000-0000-0000-0000-000000000011','00790000-0000-0000-0000-000000000001',
   'RPC Ordered Case','Ordered','00790000-0000-0000-0000-0000000000a1');

-- Org-B: one procurement (cross-org guard target)
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00790000-0000-0000-0000-000000000020','00790000-0000-0000-0000-000000000002',
   'RPC Case Org B','Draft','00790000-0000-0000-0000-0000000000b1');

-- ── AC-PR-004: minting format + per-day increment ─────────────────────────────
-- All calls as PM (Project Manager) in Org A.

set local role authenticated;
set local request.jwt.claims = '{"sub":"00790000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- create_purchase_request → pr_number matches ^PR-[0-9]{10}$
select ok(
  ((select pr_number from create_purchase_request(
      '00790000-0000-0000-0000-000000000010', null, null, null, null)) ~ '^PR-[0-9]{10}$'),
  'AC-PR-004: create_purchase_request mints pr_number matching ^PR-[0-9]{10}$');

-- create_rfq first call → rfq_number matches ^RFQ-[0-9]{10}$
select ok(
  ((select rfq_number from create_rfq(
      '00790000-0000-0000-0000-000000000010', null, null, null, null)) ~ '^RFQ-[0-9]{10}$'),
  'AC-PR-004: create_rfq first call mints rfq_number matching ^RFQ-[0-9]{10}$');

-- create_rfq second call → still matches and seq increments
-- Capture both seq suffixes: last 4 digits of rfq_number
do $$
declare
  v_first  text;
  v_second text;
begin
  select rfq_number into v_first  from create_rfq('00790000-0000-0000-0000-000000000010', null, null, null, null);
  select rfq_number into v_second from create_rfq('00790000-0000-0000-0000-000000000010', null, null, null, null);
  -- store for the next assertions
  perform set_config('pmo.rfq_first',  v_first,  true);
  perform set_config('pmo.rfq_second', v_second, true);
end; $$;

select ok(
  (current_setting('pmo.rfq_second') ~ '^RFQ-[0-9]{10}$'),
  'AC-PR-004: create_rfq second call also matches ^RFQ-[0-9]{10}$');

select ok(
  (right(current_setting('pmo.rfq_second'), 4)::int =
   right(current_setting('pmo.rfq_first'),  4)::int + 1),
  'AC-PR-004: create_rfq second call seq is first+1 (per-day increment)');

-- create_purchase_order → po_number matches ^PO-[0-9]{10}$
select ok(
  ((select po_number from create_purchase_order(
      '00790000-0000-0000-0000-000000000010', null, null, null, null)) ~ '^PO-[0-9]{10}$'),
  'AC-PR-004: create_purchase_order mints po_number matching ^PO-[0-9]{10}$');

-- create_payment → pay_number matches ^PAY-[0-9]{10}$
select ok(
  ((select pay_number from create_payment(
      '00790000-0000-0000-0000-000000000010', null, null, null, null, null)) ~ '^PAY-[0-9]{10}$'),
  'AC-PR-004: create_payment mints pay_number matching ^PAY-[0-9]{10}$');

reset role;

-- ── AC-PR-014: permissive capture — status NOT forced ─────────────────────────
-- create_purchase_order on an Ordered case → succeeds AND status stays Ordered.

set local role authenticated;
set local request.jwt.claims = '{"sub":"00790000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select create_purchase_order('00790000-0000-0000-0000-000000000011', null, null, null, null) $$,
  'AC-PR-014: create_purchase_order on an Ordered case succeeds (permissive capture)');

select is(
  (select status::text from procurements where id = '00790000-0000-0000-0000-000000000011'),
  'Ordered',
  'AC-PR-014: procurements.status stays Ordered after create_purchase_order (no forced transition)');

reset role;

-- ── AC-PR-015: cross-org parent guard → 42501 for each RPC ──────────────────
-- Org-A PM calls RPCs with an Org-B procurement_id → must throw 42501.

set local role authenticated;
set local request.jwt.claims = '{"sub":"00790000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select create_purchase_request('00790000-0000-0000-0000-000000000020', null, null, null, null) $$,
  '42501', null,
  'AC-PR-015: create_purchase_request cross-org → 42501');

select throws_ok(
  $$ select create_rfq('00790000-0000-0000-0000-000000000020', null, null, null, null) $$,
  '42501', null,
  'AC-PR-015: create_rfq cross-org → 42501');

select throws_ok(
  $$ select create_purchase_order('00790000-0000-0000-0000-000000000020', null, null, null, null) $$,
  '42501', null,
  'AC-PR-015: create_purchase_order cross-org → 42501');

select throws_ok(
  $$ select create_payment('00790000-0000-0000-0000-000000000020', null, null, null, null, null) $$,
  '42501', null,
  'AC-PR-015: create_payment cross-org → 42501');

reset role;

-- ── AC-PR-016: write-set roles may create (Admin / Executive / Finance) ───────

-- Admin creates a purchase_request
set local role authenticated;
set local request.jwt.claims = '{"sub":"00790000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select create_purchase_request('00790000-0000-0000-0000-000000000010', null, null, null, null) $$,
  'AC-PR-016: Admin can create_purchase_request');

reset role;

-- Finance creates a payment
set local role authenticated;
set local request.jwt.claims = '{"sub":"00790000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ select create_payment('00790000-0000-0000-0000-000000000010', null, null, null, null, null) $$,
  'AC-PR-016: Finance can create_payment');

reset role;

-- Executive creates an rfq
set local role authenticated;
set local request.jwt.claims = '{"sub":"00790000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select lives_ok(
  $$ select create_rfq('00790000-0000-0000-0000-000000000010', null, null, null, null) $$,
  'AC-PR-016: Executive can create_rfq');

reset role;

-- ── AC-PR-017: Engineer cannot create (4-role gate) → 42501 ─────────────────

set local role authenticated;
set local request.jwt.claims = '{"sub":"00790000-0000-0000-0000-0000000000a5","role":"authenticated"}';

select throws_ok(
  $$ select create_purchase_request('00790000-0000-0000-0000-000000000010', null, null, null, null) $$,
  '42501', null,
  'AC-PR-017: Engineer cannot create_purchase_request → 42501');

reset role;

select * from finish();
rollback;
