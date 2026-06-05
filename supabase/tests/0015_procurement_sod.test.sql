-- 0015_procurement_sod.test.sql
-- AC-809: SoD-a — requester cannot Approve their own procurement.
-- AC-810: SoD-b — approver cannot Pay a procurement they approved.
begin;
select plan(5);

-- Fixtures (inserted as table owner).
insert into organizations (id, name) values
  ('00150000-0000-0000-0000-000000000001','Proc SoD Org');

insert into auth.users (id, email) values
  ('00150000-0000-0000-0000-0000000000a1','pm-sod@example.com'),
  ('00150000-0000-0000-0000-0000000000a2','fin-sod-y@example.com'),
  ('00150000-0000-0000-0000-0000000000a3','fin-sod-z@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00150000-0000-0000-0000-0000000000a1','00150000-0000-0000-0000-000000000001','PM SoD','pm-sod@example.com','Project Manager'),
  ('00150000-0000-0000-0000-0000000000a2','00150000-0000-0000-0000-000000000001','Finance Y','fin-sod-y@example.com','Finance'),
  ('00150000-0000-0000-0000-0000000000a3','00150000-0000-0000-0000-000000000001','Finance Z','fin-sod-z@example.com','Finance');

-- Procurement #1: Requested, requested_by = PM (X) — for SoD-a tests.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00150000-0000-0000-0000-000000000010','00150000-0000-0000-0000-000000000001',
   'SoD-a Proc','Requested','00150000-0000-0000-0000-0000000000a1');

-- Procurement #2: Vendor Invoiced, requested_by = PM, approved_by = Finance-Y — for SoD-b tests.
-- Force-insert with approved_by_id set directly (as table owner, bypassing the RPC for setup).
insert into procurements (id, org_id, title, status, requested_by_id, approved_by_id) values
  ('00150000-0000-0000-0000-000000000011','00150000-0000-0000-0000-000000000001',
   'SoD-b Proc','Vendor Invoiced',
   '00150000-0000-0000-0000-0000000000a1',
   '00150000-0000-0000-0000-0000000000a2');

-- ── SoD-a: requester (PM X) cannot Approve their own Requested procurement ───
set local role authenticated;
set local request.jwt.claims = '{"sub":"00150000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-809: PM X (the requester) calling Approve → 42501.
select throws_ok(
  $$ select transition_procurement('00150000-0000-0000-0000-000000000010','Approved') $$,
  '42501', null,
  'AC-809: SoD-a — requester cannot Approve their own procurement (42501)');

reset role;

-- ── SoD-a: different authorized user (Finance-Y) CAN Approve ─────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00150000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select transition_procurement('00150000-0000-0000-0000-000000000010','Approved') $$,
  'AC-809: Finance-Y (non-requester) can Approve the procurement (lives_ok)');

-- Confirm approved_by_id is set to Finance-Y.
select is(
  (select approved_by_id from procurements where id = '00150000-0000-0000-0000-000000000010'),
  '00150000-0000-0000-0000-0000000000a2'::uuid,
  'AC-809: approved_by_id set to Finance-Y after Approve');

reset role;

-- ── SoD-b: Finance-Y (the approver) cannot Pay the Vendor Invoiced procurement ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"00150000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- AC-810: Finance-Y (the approver) calling Vendor Invoiced→Paid → 42501.
select throws_ok(
  $$ select transition_procurement('00150000-0000-0000-0000-000000000011','Paid') $$,
  '42501', null,
  'AC-810: SoD-b — approver cannot Pay their own approved procurement (42501)');

reset role;

-- ── SoD-b: Finance-Z (different Finance, not the approver) CAN Pay ────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00150000-0000-0000-0000-0000000000a3","role":"authenticated"}';

-- AC-810: Finance-Z (not the approver) calling Vendor Invoiced→Paid → succeeds.
select lives_ok(
  $$ select transition_procurement('00150000-0000-0000-0000-000000000011','Paid') $$,
  'AC-810: Finance-Z (non-approver) can Pay the procurement (lives_ok)');

reset role;
select * from finish();
rollback;
