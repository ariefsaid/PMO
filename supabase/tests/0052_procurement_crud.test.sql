-- 0052_procurement_crud.test.sql — the Procurement CRUD write contract (CRUD+RBAC program, Procurement slice).
-- Proves migration 0015 on top of the EXISTING 0002/0006/0010 procurement RLS + SoD (all unchanged):
--   AC-PROC-101  select_procurement_quote sets is_selected, syncs header total_value+vendor_id, and
--                advances Vendor Quoted → Quote Selected (the previously-missing select-quote path).
--   AC-PROC-102  selecting a SECOND quote clears the prior selection (the one-selected partial index holds).
--   AC-PROC-103  select_procurement_quote from a non-'Vendor Quoted' stage is rejected (P0001).
--   AC-PROC-104  a non-sourcing role (Engineer) cannot select a quote (42501).
--   AC-PROC-105  cross-org select is rejected — an org-B PM cannot select an org-A PR's quote (42501).
--   AC-PROC-106  the requester (an ENGINEER) CAN insert a line item on their OWN Draft PR (widening).
--   AC-PROC-107  a non-requester Engineer CANNOT insert a line item (base policy still excludes them).
--   AC-PROC-108  NO writer (even a PM write-role) can insert/update a line item once the PR leaves Draft
--                (the Draft-only restrictive freeze; USING hides → 0-row no-op / WITH CHECK denies).
--   AC-PROC-109  a write-role PM CAN still insert a line item while the PR is Draft (unchanged base path).
-- RLS/RPC is the enforcement authority; the FE gating is only a clarity projection (rbac-visibility.md §E2).
-- The 0006 procure-to-pay SoD is untouched — selecting a quote is a sourcing action, not approve/pay.
begin;
select plan(15);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into organizations (id, name) values
  ('00520000-0000-0000-0000-000000000001','Proc CRUD Org A'),
  ('00520000-0000-0000-0000-000000000002','Proc CRUD Org B');

insert into auth.users (id, email) values
  ('00520000-0000-0000-0000-0000000000a1','pc-pm@example.com'),
  ('00520000-0000-0000-0000-0000000000a2','pc-eng-req@example.com'),
  ('00520000-0000-0000-0000-0000000000a3','pc-eng-other@example.com'),
  ('00520000-0000-0000-0000-0000000000b1','pc-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00520000-0000-0000-0000-0000000000a1','00520000-0000-0000-0000-000000000001','PC PM','pc-pm@example.com','Project Manager'),
  ('00520000-0000-0000-0000-0000000000a2','00520000-0000-0000-0000-000000000001','PC Eng Req','pc-eng-req@example.com','Engineer'),
  ('00520000-0000-0000-0000-0000000000a3','00520000-0000-0000-0000-000000000001','PC Eng Other','pc-eng-other@example.com','Engineer'),
  ('00520000-0000-0000-0000-0000000000b1','00520000-0000-0000-0000-000000000002','PC PM B','pc-pm-b@example.com','Project Manager');

-- Two vendors for the quote sync assertion.
insert into companies (id, org_id, name, type) values
  ('00520000-0000-0000-0000-000000000050','00520000-0000-0000-0000-000000000001','Vendor One','Vendor'),
  ('00520000-0000-0000-0000-000000000051','00520000-0000-0000-0000-000000000001','Vendor Two','Vendor');

-- PR #1: Vendor Quoted, requested_by = Engineer-Req — for the select-quote path.
insert into procurements (id, org_id, title, status, requested_by_id, total_value) values
  ('00520000-0000-0000-0000-000000000010','00520000-0000-0000-0000-000000000001',
   'Select-Quote PR','Vendor Quoted','00520000-0000-0000-0000-0000000000a2', 0);
-- Two quotations on PR #1 (neither selected yet).
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount) values
  ('00520000-0000-0000-0000-000000000060','00520000-0000-0000-0000-000000000001',
   '00520000-0000-0000-0000-000000000010','00520000-0000-0000-0000-000000000050', 2710.00),
  ('00520000-0000-0000-0000-000000000061','00520000-0000-0000-0000-000000000001',
   '00520000-0000-0000-0000-000000000010','00520000-0000-0000-0000-000000000051', 2944.00);

-- PR #2: a DRAFT PR requested by Engineer-Req — for line-item widening + Draft freeze (insert/update).
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00520000-0000-0000-0000-000000000011','00520000-0000-0000-0000-000000000001',
   'Draft Items PR','Draft','00520000-0000-0000-0000-0000000000a2');

-- PR #3: an ORDERED (non-Draft) PR requested by Engineer-Req with one existing item — Draft-freeze tests.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00520000-0000-0000-0000-000000000012','00520000-0000-0000-0000-000000000001',
   'Ordered Items PR','Ordered','00520000-0000-0000-0000-0000000000a2');
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('00520000-0000-0000-0000-000000000070','00520000-0000-0000-0000-000000000001',
   '00520000-0000-0000-0000-000000000012','Existing item', 1, 100);

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PROC-104: a non-sourcing role (Engineer requester) cannot select a quote — run before the success.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ select select_procurement_quote('00520000-0000-0000-0000-000000000060') $$,
  '42501', null,
  'AC-PROC-104: an Engineer (non-sourcing role) cannot select a quote (42501)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PROC-105: cross-org select is rejected — org-B PM cannot select an org-A PR's quote.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select throws_ok(
  $$ select select_procurement_quote('00520000-0000-0000-0000-000000000060') $$,
  '42501', null,
  'AC-PROC-105: cross-org select_procurement_quote is rejected (parent-org guard → 42501)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PROC-101 / 102: the in-org PM (a sourcing role) selects a quote, then re-selects another.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-PROC-101: PM selects quote #1 (Vendor One @ 2710).
select lives_ok(
  $$ select select_procurement_quote('00520000-0000-0000-0000-000000000060') $$,
  'AC-PROC-101: a sourcing role (PM) can select a quote (lives_ok)');

reset role;

-- AC-PROC-101: is_selected set on quote #1, header synced, stage advanced.
select ok(
  (select is_selected from procurement_quotations where id = '00520000-0000-0000-0000-000000000060'),
  'AC-PROC-101: the selected quote has is_selected = true');
select is(
  (select status::text from procurements where id = '00520000-0000-0000-0000-000000000010'),
  'Quote Selected',
  'AC-PROC-101: the PR advanced Vendor Quoted → Quote Selected');
select is(
  (select total_value from procurements where id = '00520000-0000-0000-0000-000000000010'),
  2710.00,
  'AC-PROC-101: the header total_value synced from the selected quote');
select is(
  (select vendor_id from procurements where id = '00520000-0000-0000-0000-000000000010'),
  '00520000-0000-0000-0000-000000000050'::uuid,
  'AC-PROC-101: the header vendor_id synced from the selected quote');

-- AC-PROC-102: re-select must clear the prior selection. The stage is now 'Quote Selected', so the RPC's
-- stage guard (must be 'Vendor Quoted') would reject a re-select on this PR — which IS the contract
-- (a quote is selected once, from Vendor Quoted). Instead prove the one-selected invariant directly:
-- bump the PR back to Vendor Quoted (as owner) and select the OTHER quote, asserting the first clears.
reset role;
update procurements set status = 'Vendor Quoted' where id = '00520000-0000-0000-0000-000000000010';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select select_procurement_quote('00520000-0000-0000-0000-000000000061') $$,
  'AC-PROC-102: PM re-selects the other quote (lives_ok)');
reset role;

select ok(
  (select is_selected from procurement_quotations where id = '00520000-0000-0000-0000-000000000061'),
  'AC-PROC-102: the newly-selected quote has is_selected = true');
select ok(
  (select not is_selected from procurement_quotations where id = '00520000-0000-0000-0000-000000000060'),
  'AC-PROC-102: the previously-selected quote was cleared (one-selected invariant holds)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PROC-103: select from a non-'Vendor Quoted' stage is rejected (P0001).
-- ════════════════════════════════════════════════════════════════════════════
-- PR #2 is Draft → selecting a (manually-added) quote on it must fail the stage guard.
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount) values
  ('00520000-0000-0000-0000-000000000062','00520000-0000-0000-0000-000000000001',
   '00520000-0000-0000-0000-000000000011','00520000-0000-0000-0000-000000000050', 500);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select select_procurement_quote('00520000-0000-0000-0000-000000000062') $$,
  'P0001', null,
  'AC-PROC-103: selecting a quote from a non-Vendor-Quoted stage is rejected (P0001)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PROC-106 / 109: line-item INSERT while DRAFT — by the Engineer requester AND by a PM write-role.
-- ════════════════════════════════════════════════════════════════════════════
-- AC-PROC-106: Engineer-Req inserts an item on their OWN Draft PR (the requester widening). org_id
-- defaulted from auth_org_id(), never sent — the requester widening WITH CHECK + Draft restrictive pass.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ insert into procurement_items (procurement_id, name, quantity, rate)
       values ('00520000-0000-0000-0000-000000000011','Eng line item', 2, 50) $$,
  'AC-PROC-106: the Engineer requester can insert a line item on their own Draft PR (widening)');
reset role;

-- AC-PROC-109: PM (a base write-role) inserts an item on the same Draft PR (unchanged base path).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into procurement_items (procurement_id, name, quantity, rate)
       values ('00520000-0000-0000-0000-000000000011','PM line item', 3, 30) $$,
  'AC-PROC-109: a PM write-role can still insert a line item while the PR is Draft (base path intact)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PROC-107: a NON-requester Engineer cannot insert a line item (base policy excludes Engineers, and
-- the requester widening does not match a non-requester).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ insert into procurement_items (procurement_id, name, quantity, rate)
       values ('00520000-0000-0000-0000-000000000011','Other Eng item', 1, 10) $$,
  '42501', null,
  'AC-PROC-107: a non-requester Engineer cannot insert a line item (WITH CHECK denies → 42501)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PROC-108: NO writer may insert/update a line item once the PR leaves Draft (Draft-only freeze).
-- PR #3 is Ordered. A PM (a write-role AND a non-requester) attempting an INSERT is denied by the
-- restrictive Draft policy's WITH CHECK → 42501; an UPDATE of the existing item is hidden by the
-- restrictive USING → 0-row no-op.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into procurement_items (procurement_id, name, quantity, rate)
       values ('00520000-0000-0000-0000-000000000012','Late item', 1, 10) $$,
  '42501', null,
  'AC-PROC-108: no writer can INSERT a line item once the PR leaves Draft (Draft freeze WITH CHECK → 42501)');
select lives_ok(
  $$ update procurement_items set name = 'Renamed late'
       where id = '00520000-0000-0000-0000-000000000070' $$,
  'AC-PROC-108: updating a line item on a non-Draft PR runs without error (Draft freeze USING → 0-row no-op)');
reset role;
select is(
  (select name from procurement_items where id = '00520000-0000-0000-0000-000000000070'),
  'Existing item',
  'AC-PROC-108: the line item on the non-Draft PR was unchanged (RLS no-op)');

select * from finish();
rollback;
