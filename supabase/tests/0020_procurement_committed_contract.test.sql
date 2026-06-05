-- 0020_procurement_committed_contract.test.sql
-- AC-815: committed-status data contract (OD-BUDGET-2).
--   • A procurement transitioned to Ordered is in the Committed set
--     {Ordered, Received, Vendor Invoiced, Paid}.
--   • A procurement at Quote Selected is NOT in the Committed set.
begin;
select plan(5);

-- Fixtures (inserted as table owner).
insert into organizations (id, name) values
  ('00200000-0000-0000-0000-000000000001','Proc Committed Org');

insert into auth.users (id, email) values
  ('00200000-0000-0000-0000-0000000000a1','pm-comm@example.com'),
  ('00200000-0000-0000-0000-0000000000a2','fin-comm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00200000-0000-0000-0000-0000000000a1','00200000-0000-0000-0000-000000000001','PM Comm','pm-comm@example.com','Project Manager'),
  ('00200000-0000-0000-0000-0000000000a2','00200000-0000-0000-0000-000000000001','Fin Comm','fin-comm@example.com','Finance');

-- Procurement to be driven to Ordered (will land in the Committed set).
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00200000-0000-0000-0000-000000000010','00200000-0000-0000-0000-000000000001',
   'Committed Proc','Draft','00200000-0000-0000-0000-0000000000a1');

-- Procurement directly inserted at Quote Selected (NOT in the Committed set).
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00200000-0000-0000-0000-000000000011','00200000-0000-0000-0000-000000000001',
   'NonCommitted Proc','Quote Selected','00200000-0000-0000-0000-0000000000a1');

-- ── Drive proc to Ordered via the RPC ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00200000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select transition_procurement('00200000-0000-0000-0000-000000000010','Requested') $$,
  'AC-815: Draft→Requested (setup)');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00200000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select transition_procurement('00200000-0000-0000-0000-000000000010','Approved') $$,
  'AC-815: Requested→Approved (setup)');

select lives_ok(
  $$ select transition_procurement('00200000-0000-0000-0000-000000000010','Ordered') $$,
  'AC-815: Approved→Ordered (drives proc into Committed set)');

reset role;

-- ── Assertions: Ordered is in Committed set; Quote Selected is NOT ────────────
-- Read as table owner (superuser context) — no RLS filtering needed for the contract check.
-- AC-815: Ordered procurement is in the Committed set.
select ok(
  (select status in ('Ordered','Received','Vendor Invoiced','Paid')
     from procurements where id = '00200000-0000-0000-0000-000000000010'),
  'AC-815: Ordered status is in the Committed set {Ordered,Received,Vendor Invoiced,Paid} (OD-BUDGET-2)');

-- AC-815: Quote Selected is NOT in the Committed set.
select ok(
  (select status not in ('Ordered','Received','Vendor Invoiced','Paid')
     from procurements where id = '00200000-0000-0000-0000-000000000011'),
  'AC-815: Quote Selected is NOT in the Committed set (non-committed status contract)');

select * from finish();
rollback;
