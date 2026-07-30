-- 0102_procurement_requester_self_stamp.test.sql
-- RED-3 (HIGH, live prod) — procurement requester mass-assignment => SoD bypass.
-- Migration 0051_procurement_requester_self_stamp.sql restores requester != approver SoD by pinning
-- procurements.requested_by_id = auth.uid() on INSERT (restrictive policy + column default) and removing
-- requested_by_id from the client-writable UPDATE grant.
--
-- Proofs:
--   1. A non-admin CANNOT insert a procurement with requested_by_id != self (rejected 42501).
--   2. The column default self-stamps requested_by_id when the client omits it.
--   3. The full SoD chain (create-as-other => self-approve) is now BLOCKED at the insert step.
--   4. A non-admin cannot RE-POINT requested_by_id to another user via direct UPDATE (grant revoked).
begin;
select plan(5);

-- Fixtures (inserted as table owner; RLS not enforced for the owner).
insert into organizations (id, name) values
  ('01020000-0000-0000-0000-000000000001','Requester SoD Org');

insert into auth.users (id, email) values
  ('01020000-0000-0000-0000-0000000000a1','pm-attacker@example.com'),   -- attacker (PM)
  ('01020000-0000-0000-0000-0000000000a2','victim@example.com');        -- the impersonated requester

insert into profiles (id, org_id, full_name, email, role) values
  ('01020000-0000-0000-0000-0000000000a1','01020000-0000-0000-0000-000000000001','PM Attacker','pm-attacker@example.com','Project Manager'),
  ('01020000-0000-0000-0000-0000000000a2','01020000-0000-0000-0000-000000000001','Victim','victim@example.com','Engineer');

-- Act as the attacker PM (a legitimate non-admin write role).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01020000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ⚑ None of the three inserts below names `status` any more (0174/FR-CPS-011 withholds INSERT on it
--    from `authenticated`, so naming it would raise 42501 at the PRIVILEGE check and proof 1 would
--    pass for the wrong reason — the trap this suite has hit twice). The column default is 'Draft';
--    the status was always incidental here, the requester is what is under test. Proof 1's message is
--    now asserted verbatim for the same reason: a bare '42501' cannot tell an RLS denial from a
--    permission denial.
--
-- 1. Mass-assignment attempt: insert a PR claiming the VICTIM as requester => must be REJECTED (42501).
--    Pre-fix (bypass) this insert SUCCEEDS; the restrictive procurements_insert_self_requester blocks it.
select throws_ok(
  $$ insert into procurements (org_id, title, requested_by_id)
     values ('01020000-0000-0000-0000-000000000001','Impersonated PR',
             '01020000-0000-0000-0000-0000000000a2') $$,
  '42501',
  'new row violates row-level security policy "procurements_insert_self_requester" for table "procurements"',
  'RED-3: non-admin cannot insert a procurement with requested_by_id != self (RLS, not a grant)');

-- 2. Omitting requested_by_id => the column DEFAULT auth.uid() self-stamps the attacker as requester.
insert into procurements (id, org_id, title)
  values ('01020000-0000-0000-0000-000000000010','01020000-0000-0000-0000-000000000001','My Own PR');
select is(
  (select requested_by_id from procurements where id = '01020000-0000-0000-0000-000000000010'),
  '01020000-0000-0000-0000-0000000000a1'::uuid,
  'RED-3: omitted requested_by_id is server-stamped to auth.uid() (self)');

-- 3. Supplying requested_by_id = self is explicitly allowed (no false positive on the legit path).
select lives_ok(
  $$ insert into procurements (id, org_id, title, requested_by_id)
     values ('01020000-0000-0000-0000-000000000011','01020000-0000-0000-0000-000000000001','Explicit-self PR',
             '01020000-0000-0000-0000-0000000000a1') $$,
  'RED-3: supplying requested_by_id = self is allowed (legit path preserved)');

-- 4. SoD chain broken at the root: with the impersonated INSERT blocked (proof 1), the attacker cannot
--    create a PR whose requester is someone else, so create-as-other => self-approve is unreachable.
--    Confirm the ONLY procurements the attacker managed to create are self-requested (no foreign requester
--    row exists), i.e. any later self-approval would (correctly) trip the requester==approver SoD guard.
select is(
  (select count(*)::int from procurements
     where org_id = '01020000-0000-0000-0000-000000000001'
       and requested_by_id <> '01020000-0000-0000-0000-0000000000a1'),
  0,
  'RED-3: no foreign-requester procurement exists => create-as-other/self-approve chain is blocked');

-- 5. Re-point attempt via direct UPDATE => the requested_by_id column UPDATE grant is revoked (0051), so
--    a SET on that column is rejected outright with 42501 (permission denied). This closes the edit-path
--    bypass at least as hard as the insert path (a hard denial, not a silent no-op).
select throws_ok(
  $$ update procurements set requested_by_id = '01020000-0000-0000-0000-0000000000a2'
     where id = '01020000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'RED-3: direct UPDATE cannot re-point requested_by_id to another user (column grant revoked, 42501)');

reset role;
select * from finish();
rollback;
