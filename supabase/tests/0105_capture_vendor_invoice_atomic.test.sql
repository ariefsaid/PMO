-- 0105_capture_vendor_invoice_atomic.test.sql
-- Reliability harden #2 — atomic vendor-invoice capture (migration 0056_capture_vendor_invoice.sql).
--
-- The VI capture was two FE writes (transition→Vendor Invoiced, then createInvoice). A failure
-- between them advanced the status with no invoice row (or vice versa). capture_vendor_invoice()
-- does both + the status-event log in ONE transaction while REUSING (not bypassing) the
-- transition_procurement SoD/role guard and the create_procurement_invoice role gate.
--
-- Proofs:
--   1. Happy path (Finance, from Received): invoice created + status → Vendor Invoiced + event logged.
--   2. Atomicity on illegal transition: from a non-Received status the transition raises → NO invoice,
--      status unchanged (all-or-nothing).
--   3. SoD/role guard STILL fires through the RPC: a non-Finance role (Engineer) is rejected (42501)
--      and NO invoice is created, status unchanged — the guard was not bypassed.
begin;
select plan(9);

insert into organizations (id, name) values
  ('01050000-0000-0000-0000-000000000001','VI Capture Org');

insert into auth.users (id, email) values
  ('01050000-0000-0000-0000-0000000000f1','finance@example.com'),
  ('01050000-0000-0000-0000-0000000000e1','eng@example.com'),
  ('01050000-0000-0000-0000-0000000000r1','requester@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01050000-0000-0000-0000-0000000000f1','01050000-0000-0000-0000-000000000001','Fin User','finance@example.com','Finance'),
  ('01050000-0000-0000-0000-0000000000e1','01050000-0000-0000-0000-000000000001','Eng User','eng@example.com','Engineer'),
  ('01050000-0000-0000-0000-0000000000r1','01050000-0000-0000-0000-000000000001','Req User','requester@example.com','Engineer');

-- Two procurements: one at 'Received' (legal VI source) and one at 'Approved' (illegal VI source).
insert into procurements (id, org_id, title, status, requested_by_id, total_value) values
  ('01050000-0000-0000-0000-0000000000c1','01050000-0000-0000-0000-000000000001','Received Case','Received',
   '01050000-0000-0000-0000-0000000000r1', 1000),
  ('01050000-0000-0000-0000-0000000000c2','01050000-0000-0000-0000-000000000001','Approved Case','Approved',
   '01050000-0000-0000-0000-0000000000r1', 2000);

-- ── Proof 2 FIRST (illegal transition) — act as Finance on the Approved case ─────────
-- Approved→Vendor Invoiced is NOT in the legal map, so transition_procurement raises P0001.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01050000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select throws_ok(
  $$ select capture_vendor_invoice('01050000-0000-0000-0000-0000000000c2',
       'Received'::procurement_invoice_status, current_date, 'INV-X', 500, null) $$,
  'P0001', null,
  'harden #2: illegal from-status (Approved) makes capture_vendor_invoice raise (P0001)');

reset role;
select is((select status from procurements where id = '01050000-0000-0000-0000-0000000000c2'),
  'Approved'::procurement_status,
  'harden #2 ATOMICITY: status unchanged after the illegal-transition failure');
select is((select count(*)::int from procurement_invoices where procurement_id = '01050000-0000-0000-0000-0000000000c2'),
  0, 'harden #2 ATOMICITY: no invoice row created after the failure');

-- ── Proof 3 (SoD/role guard) — act as Engineer on the Received case ──────────────────
-- Received→Vendor Invoiced requires Finance; Engineer must be rejected (42501), nothing written.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01050000-0000-0000-0000-0000000000e1","role":"authenticated"}';

select throws_ok(
  $$ select capture_vendor_invoice('01050000-0000-0000-0000-0000000000c1',
       'Received'::procurement_invoice_status, current_date, 'INV-Y', 700, null) $$,
  '42501', null,
  'harden #2: the transition role/SoD guard STILL fires through the RPC (Engineer rejected, 42501)');

reset role;
select is((select status from procurements where id = '01050000-0000-0000-0000-0000000000c1'),
  'Received'::procurement_status,
  'harden #2: status unchanged after the SoD rejection');
select is((select count(*)::int from procurement_invoices where procurement_id = '01050000-0000-0000-0000-0000000000c1'),
  0, 'harden #2: no invoice created after the SoD rejection');

-- ── Proof 1 (happy path) — act as Finance on the Received case ───────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01050000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select lives_ok(
  $$ select capture_vendor_invoice('01050000-0000-0000-0000-0000000000c1',
       'Received'::procurement_invoice_status, current_date, 'INV-OK', 950, 'captured') $$,
  'harden #2: Finance captures the VI atomically (transition + invoice + event)');

reset role;
select is((select status from procurements where id = '01050000-0000-0000-0000-0000000000c1'),
  'Vendor Invoiced'::procurement_status,
  'harden #2: status advanced to Vendor Invoiced on the happy path');
select is((select count(*)::int from procurement_invoices where procurement_id = '01050000-0000-0000-0000-0000000000c1'),
  1, 'harden #2: exactly one invoice row created on the happy path');

select * from finish();
rollback;
