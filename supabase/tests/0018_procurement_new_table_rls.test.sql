-- 0018_procurement_new_table_rls.test.sql
-- AC-813: new-table RLS on procurement_receipts / procurement_invoices.
--   • Engineer SELECT in-org → allowed (returns rows).
--   • Engineer direct INSERT into procurement_receipts → 42501 (4-role gate).
--   • Finance INSERT a receipt whose procurement_id is an org-B procurement → 42501 (parent-org guard).
begin;
select plan(4);

-- Fixtures (two orgs, inserted as table owner).
insert into organizations (id, name) values
  ('00180000-0000-0000-0000-000000000001','Proc RLS Org A'),
  ('00180000-0000-0000-0000-000000000002','Proc RLS Org B');

insert into auth.users (id, email) values
  ('00180000-0000-0000-0000-0000000000a1','eng-rls@example.com'),
  ('00180000-0000-0000-0000-0000000000a2','fin-rls@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00180000-0000-0000-0000-0000000000a1','00180000-0000-0000-0000-000000000001','Eng RLS','eng-rls@example.com','Engineer'),
  ('00180000-0000-0000-0000-0000000000a2','00180000-0000-0000-0000-000000000001','Fin RLS','fin-rls@example.com','Finance');

-- Org-A procurement (belongs to org-A; parent for valid in-org writes).
insert into procurements (id, org_id, title, status) values
  ('00180000-0000-0000-0000-000000000010','00180000-0000-0000-0000-000000000001',
   'RLS Proc Org A','Ordered');

-- Org-B procurement (belongs to org-B; used for parent-org guard test).
insert into procurements (id, org_id, title, status) values
  ('00180000-0000-0000-0000-000000000011','00180000-0000-0000-0000-000000000002',
   'RLS Proc Org B','Ordered');

-- A receipt in org-A (for the Engineer read test).
insert into procurement_receipts (id, org_id, procurement_id, status) values
  ('00180000-0000-0000-0000-000000000020','00180000-0000-0000-0000-000000000001',
   '00180000-0000-0000-0000-000000000010','Partial');

-- An invoice in org-A (for the Engineer read test).
insert into procurement_invoices (id, org_id, procurement_id, status) values
  ('00180000-0000-0000-0000-000000000030','00180000-0000-0000-0000-000000000001',
   '00180000-0000-0000-0000-000000000010','Received');

-- ── T1: Engineer SELECT in-org → rows returned (read allowed) ────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00180000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-813: Engineer can SELECT procurement_receipts in org.
select is(
  (select count(*)::int from procurement_receipts),
  1,
  'AC-813: Engineer can SELECT procurement_receipts in org (read allowed)');

-- AC-813: Engineer can SELECT procurement_invoices in org.
select is(
  (select count(*)::int from procurement_invoices),
  1,
  'AC-813: Engineer can SELECT procurement_invoices in org (read allowed)');

-- AC-813: Engineer direct INSERT into procurement_receipts → 42501 (4-role write gate).
select throws_ok(
  $$ insert into procurement_receipts (org_id, procurement_id, status)
     values ('00180000-0000-0000-0000-000000000001',
             '00180000-0000-0000-0000-000000000010',
             'Complete') $$,
  '42501', null,
  'AC-813: Engineer direct INSERT into procurement_receipts blocked (4-role write gate 42501)');

reset role;

-- ── T2: Finance INSERT a receipt with org-B procurement_id → 42501 (parent-org guard) ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"00180000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- AC-813: Finance inserting a receipt whose procurement_id belongs to org-B → 42501.
-- The org_id column defaults to org-A (Finance user's org), but the parent procurement is org-B.
-- The parent-org guard in the with check policy rejects this (mirrors budget HIGH-BV-1).
select throws_ok(
  $$ insert into procurement_receipts (procurement_id, status)
     values ('00180000-0000-0000-0000-000000000011', 'Partial') $$,
  '42501', null,
  'AC-813: Finance INSERT receipt with org-B parent procurement rejected (parent-org guard 42501)');

reset role;
select * from finish();
rollback;
