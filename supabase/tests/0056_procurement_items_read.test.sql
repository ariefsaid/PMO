-- 0056_procurement_items_read.test.sql — line items are READABLE to approvers at any status (Wave-5 C2).
-- Proves migration 0019 on top of 0002/0015 (procurement_items RLS, unchanged elsewhere):
--   AC-IXD-PROC-W5-2-RLS-a  a non-requester approver (Finance, PM) CAN SELECT items on a REQUESTED PR
--                           (regression: was 0 rows under the 0015 `for all` Draft restrictive read gate).
--   AC-IXD-PROC-W5-2-RLS-b  a non-requester write-role CANNOT INSERT/UPDATE/DELETE items on a non-Draft
--                           PR (writes still frozen post-Draft — the 0015 intent preserved).
--   AC-IXD-PROC-W5-2-RLS-c  the requester CANNOT write items once the PR is past Draft (freeze binds the
--                           requester widening too — AND-gated by the Draft restrictive policy).
--   AC-IXD-PROC-W5-2-RLS-d  cross-org read is still blocked — an org-B user sees 0 items on an org-A PR.
-- RLS is the enforcement authority; the FE DecisionSupportPanel only PROJECTS this (it reads p.items).
-- The 0006 procure-to-pay SoD and the Draft write-freeze (0015) are untouched by 0019.
begin;
select plan(12);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into organizations (id, name) values
  ('00560000-0000-0000-0000-000000000001','Items Read Org A'),
  ('00560000-0000-0000-0000-000000000002','Items Read Org B');

insert into auth.users (id, email) values
  ('00560000-0000-0000-0000-0000000000a1','ir-pm@example.com'),
  ('00560000-0000-0000-0000-0000000000a2','ir-fin@example.com'),
  ('00560000-0000-0000-0000-0000000000a3','ir-eng-req@example.com'),
  ('00560000-0000-0000-0000-0000000000b1','ir-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00560000-0000-0000-0000-0000000000a1','00560000-0000-0000-0000-000000000001','IR PM','ir-pm@example.com','Project Manager'),
  ('00560000-0000-0000-0000-0000000000a2','00560000-0000-0000-0000-000000000001','IR Finance','ir-fin@example.com','Finance'),
  ('00560000-0000-0000-0000-0000000000a3','00560000-0000-0000-0000-000000000001','IR Eng Req','ir-eng-req@example.com','Engineer'),
  ('00560000-0000-0000-0000-0000000000b1','00560000-0000-0000-0000-000000000002','IR PM B','ir-pm-b@example.com','Project Manager');

-- PR #1: a REQUESTED (non-Draft) PR requested by the Engineer, with 3 line items already on it.
-- This is the C2 scenario: an approver reviewing a submitted request must SEE its line items.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00560000-0000-0000-0000-000000000010','00560000-0000-0000-0000-000000000001',
   'Requested PR with items','Requested','00560000-0000-0000-0000-0000000000a3');
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('00560000-0000-0000-0000-000000000070','00560000-0000-0000-0000-000000000001',
   '00560000-0000-0000-0000-000000000010','Item one', 1, 100),
  ('00560000-0000-0000-0000-000000000071','00560000-0000-0000-0000-000000000001',
   '00560000-0000-0000-0000-000000000010','Item two', 2, 50),
  ('00560000-0000-0000-0000-000000000072','00560000-0000-0000-0000-000000000001',
   '00560000-0000-0000-0000-000000000010','Item three', 3, 25);

-- ════════════════════════════════════════════════════════════════════════════
-- AC-IXD-PROC-W5-2-RLS-a: a non-requester approver CAN read items on a Requested PR.
-- A Finance approver and a PM approver each see all 3 items (the C2 regression: was 0).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00560000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select count(*)::int from procurement_items where procurement_id = '00560000-0000-0000-0000-000000000010'),
  3,
  'AC-IXD-PROC-W5-2-RLS-a: a non-requester Finance approver reads all 3 items on a Requested PR (was 0)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00560000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  (select count(*)::int from procurement_items where procurement_id = '00560000-0000-0000-0000-000000000010'),
  3,
  'AC-IXD-PROC-W5-2-RLS-a: a non-requester PM approver reads all 3 items on a Requested PR');
reset role;

-- The requester themselves also still reads their items on a non-Draft PR.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00560000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(
  (select count(*)::int from procurement_items where procurement_id = '00560000-0000-0000-0000-000000000010'),
  3,
  'AC-IXD-PROC-W5-2-RLS-a: the Engineer requester reads all 3 items on their Requested PR');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-IXD-PROC-W5-2-RLS-b: a non-requester write-role CANNOT write items on a non-Draft PR.
-- The Draft freeze (0019 re-scoped to insert/update/delete) still binds. PM is a base write-role.
-- INSERT/DELETE → WITH CHECK / restrictive denies (42501); UPDATE → restrictive USING hides (0-row no-op).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00560000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into procurement_items (procurement_id, name, quantity, rate)
       values ('00560000-0000-0000-0000-000000000010','Late PM item', 1, 10) $$,
  '42501', null,
  'AC-IXD-PROC-W5-2-RLS-b: a PM write-role cannot INSERT an item once the PR leaves Draft (42501)');
select lives_ok(
  $$ update procurement_items set name = 'Renamed by PM'
       where id = '00560000-0000-0000-0000-000000000070' $$,
  'AC-IXD-PROC-W5-2-RLS-b: UPDATE on a non-Draft PR runs without error (restrictive USING → 0-row no-op)');
select lives_ok(
  $$ delete from procurement_items where id = '00560000-0000-0000-0000-000000000071' $$,
  'AC-IXD-PROC-W5-2-RLS-b: DELETE on a non-Draft PR runs without error (restrictive USING → 0-row no-op)');
reset role;
select is(
  (select name from procurement_items where id = '00560000-0000-0000-0000-000000000070'),
  'Item one',
  'AC-IXD-PROC-W5-2-RLS-b: the item was unchanged after the no-op UPDATE (write freeze holds)');
select is(
  (select count(*)::int from procurement_items where id = '00560000-0000-0000-0000-000000000071'),
  1,
  'AC-IXD-PROC-W5-2-RLS-b: the DELETE was a no-op — the item still exists (delete freeze holds)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-IXD-PROC-W5-2-RLS-c: the requester CANNOT write items once the PR is past Draft.
-- The requester widening (0019) is AND-gated by the Draft restrictive policy, so a non-Draft INSERT
-- by the requester is denied; an UPDATE is a 0-row no-op.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00560000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ insert into procurement_items (procurement_id, name, quantity, rate)
       values ('00560000-0000-0000-0000-000000000010','Late requester item', 1, 10) $$,
  '42501', null,
  'AC-IXD-PROC-W5-2-RLS-c: the requester cannot INSERT an item once their PR is past Draft (42501)');
select lives_ok(
  $$ update procurement_items set name = 'Renamed by requester'
       where id = '00560000-0000-0000-0000-000000000072' $$,
  'AC-IXD-PROC-W5-2-RLS-c: requester UPDATE on a non-Draft PR is a 0-row no-op (lives_ok)');
reset role;
select is(
  (select name from procurement_items where id = '00560000-0000-0000-0000-000000000072'),
  'Item three',
  'AC-IXD-PROC-W5-2-RLS-c: the requester item was unchanged (write freeze binds the requester too)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-IXD-PROC-W5-2-RLS-d: cross-org read is still blocked — an org-B PM sees 0 items on an org-A PR.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00560000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  (select count(*)::int from procurement_items where procurement_id = '00560000-0000-0000-0000-000000000010'),
  0,
  'AC-IXD-PROC-W5-2-RLS-d: an org-B user reads 0 items on an org-A PR (cross-org read still blocked)');
reset role;

select * from finish();
rollback;
