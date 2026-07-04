-- 0110_procurement_records_write_hardening.test.sql
-- AUDIT-H1 (2026-07-04 seven-dimension audit) — procurement record forgery / destructive-delete
-- residual of the RED-3/RED-4 class. Migration 0058 revokes client write grants on the four
-- record tables (RPC-only writes), adds amount >= 0 CHECKs, and makes *_files hard-DELETE Admin-only.
--
-- Proofs:
--   1. A 4-role insider (PM) direct INSERT into payments is DENIED (42501 — grant revoked).
--   2. A PM direct UPDATE of payments (amount/status forgery path) is DENIED (42501).
--   3. A PM direct DELETE of payments (evidence destruction path) is DENIED (42501).
--   4. A PM direct INSERT into purchase_orders is DENIED (42501 — second table spot-proof).
--   5. The legit RPC path still works: create_payment as PM returns a row.
--   6. create_payment with a NEGATIVE amount is DENIED (23514 — payments_amount_nonneg CHECK).
--   7. A negative amount is blocked even for the table owner (23514 — CHECK is unconditional).
--   8. A PM hard-DELETE of a payment_files row is DENIED (restrictive policy => row survives).
--   9. An Admin hard-DELETE of a payment_files row is ALLOWED.
begin;
select plan(9);

-- Fixtures (inserted as table owner).
insert into organizations (id, name) values
  ('01100000-0000-0000-0000-000000000001','Record Hardening Org');

insert into auth.users (id, email) values
  ('01100000-0000-0000-0000-0000000000a1','pm-rec@example.com'),
  ('01100000-0000-0000-0000-0000000000a2','admin-rec@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01100000-0000-0000-0000-0000000000a1','01100000-0000-0000-0000-000000000001','PM Rec','pm-rec@example.com','Project Manager'),
  ('01100000-0000-0000-0000-0000000000a2','01100000-0000-0000-0000-000000000001','Admin Rec','admin-rec@example.com','Admin');

insert into procurements (id, org_id, title, status, requested_by_id) values
  ('01100000-0000-0000-0000-000000000010','01100000-0000-0000-0000-000000000001','Rec Case','Draft',
   '01100000-0000-0000-0000-0000000000a1');

insert into payments (id, org_id, procurement_id, pay_number, status, amount) values
  ('01100000-0000-0000-0000-000000000020','01100000-0000-0000-0000-000000000001',
   '01100000-0000-0000-0000-000000000010','PAY-T-1','Scheduled',100.00);

insert into payment_files (id, org_id, payment_id, title, file_path) values
  ('01100000-0000-0000-0000-000000000030','01100000-0000-0000-0000-000000000001',
   '01100000-0000-0000-0000-000000000020','evidence.pdf','x/evidence.pdf'),
  ('01100000-0000-0000-0000-000000000031','01100000-0000-0000-0000-000000000001',
   '01100000-0000-0000-0000-000000000020','evidence2.pdf','x/evidence2.pdf');

-- ── 7. CHECK is unconditional: even the table owner cannot persist a negative amount. ──
select throws_ok(
  $$insert into payments (org_id, procurement_id, pay_number, status, amount)
    values ('01100000-0000-0000-0000-000000000001','01100000-0000-0000-0000-000000000010','PAY-T-NEG','Scheduled',-5)$$,
  '23514',
  null,
  'AUDIT-H1: negative payment amount is blocked by CHECK even as owner');

-- ── As the PM (a 4-role write insider) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 1. Direct INSERT (forgery path) — grant revoked => 42501.
select throws_ok(
  $$insert into payments (org_id, procurement_id, pay_number, status, amount)
    values ('01100000-0000-0000-0000-000000000001','01100000-0000-0000-0000-000000000010','PAY-T-2','Paid',999999)$$,
  '42501',
  null,
  'AUDIT-H1: PM direct INSERT into payments is denied (RPC-only writes)');

-- 2. Direct UPDATE (amount/status flip) — grant revoked => 42501.
select throws_ok(
  $$update payments set amount = 0.01, status = 'Paid' where id = '01100000-0000-0000-0000-000000000020'$$,
  '42501',
  null,
  'AUDIT-H1: PM direct UPDATE of payments is denied (RPC-only writes)');

-- 3. Direct DELETE (evidence destruction) — grant revoked => 42501.
select throws_ok(
  $$delete from payments where id = '01100000-0000-0000-0000-000000000020'$$,
  '42501',
  null,
  'AUDIT-H1: PM direct DELETE of payments is denied (RPC-only writes)');

-- 4. Second table spot-proof: direct INSERT into purchase_orders — 42501.
select throws_ok(
  $$insert into purchase_orders (org_id, procurement_id, po_number, status, amount)
    values ('01100000-0000-0000-0000-000000000001','01100000-0000-0000-0000-000000000010','PO-T-1','Issued',1)$$,
  '42501',
  null,
  'AUDIT-H1: PM direct INSERT into purchase_orders is denied (RPC-only writes)');

-- 5. The legit RPC path is unaffected (SECURITY DEFINER runs as function owner).
select is(
  (select (create_payment(
     '01100000-0000-0000-0000-000000000010', null, 'ref-1', 'Scheduled', current_date, 250.00)).amount),
  250.00::numeric,
  'AUDIT-H1: create_payment RPC still works for a 4-role insider');

-- 6. The RPC cannot persist a negative amount either (CHECK rides under the definer insert).
select throws_ok(
  $$select create_payment('01100000-0000-0000-0000-000000000010', null, 'ref-2', 'Scheduled', current_date, -250.00)$$,
  '23514',
  null,
  'AUDIT-H1: create_payment with a negative amount is blocked by the CHECK');

-- 8. PM hard-DELETE of a payment file: restrictive Admin-only policy => 0 rows affected.
delete from payment_files where id = '01100000-0000-0000-0000-000000000030';
select is(
  (select count(*)::int from payment_files where id = '01100000-0000-0000-0000-000000000030'),
  1,
  'AUDIT-H1: PM hard-delete of a payment file is denied (row survives)');

-- 9. Admin hard-DELETE of a payment file is allowed.
set local request.jwt.claims = '{"sub":"01100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
delete from payment_files where id = '01100000-0000-0000-0000-000000000031';
select is(
  (select count(*)::int from payment_files where id = '01100000-0000-0000-0000-000000000031'),
  0,
  'AUDIT-H1: Admin hard-delete of a payment file is allowed');

select * from finish();
rollback;
