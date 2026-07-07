-- 0134_reserve_credits.test.sql
-- AC-RESERVE-001..006 [pgTAP, SINGLE ORG]: reserve_credits() closes the TOCTOU credit-overspend race
-- (audit CRITICAL) by an atomic check-and-hold under a per-org advisory txn lock that counts UNRELEASED
-- reservations against `available`. The read-only org_credit_balance guard (0067) reads balance BEFORE
-- the model call and writes the cost row AFTER — so N concurrent turns for one org all read the SAME
-- balance, all pass, all spend → the org goes negative (unbounded overspend). reserve_credits holds a
-- per-turn amount; a concurrent second reserve blocks on the per-org advisory lock, then sees the
-- first's hold in `available` and is rejected (23514 → the existing out-of-credits UX). release_credits
-- drops the hold once the real agent_usage.cost row has landed (so the spend is counted exactly once).
--
-- CONCURRENCY NOTE: these are SEQUENTIAL holds in ONE pgTAP transaction — which is the SAME worst case
-- the advisory lock reduces true concurrency to. The lock guarantees two concurrent reserve_credits
-- calls for one org SERIALIZE (the second blocks until the first's transaction commits its reservation
-- row); within a serialized order, the second sees the first's hold in `available` and is rejected —
-- EXACTLY what these sequential assertions prove (the accounting is correct, and the lock makes
-- concurrent == sequential). A two-connection live concurrency test would assert the same outcome;
-- pgTAP cannot open a second connection, so the sequential proof + the lock's design is the owner.
--
-- Reservation accounting (the money-path formula, migration 0077):
--   available(org) = Σ credits.amount − Σ agent_usage.cost − Σ credit_reservations.amount(released_at IS NULL)
begin;
select plan(10);

-- ── Fixtures (inserted as the test superuser, bypassing RLS): org X + cross-org Y, one active member,
--    a 100-credit grant, no usage. ───────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01340000-0000-0000-0000-000000000001','AC-RESERVE Org X'),
  ('01340000-0000-0000-0000-000000000002','AC-RESERVE Org Y (cross-org guard)');
insert into auth.users (id, email) values
  ('01340000-0000-0000-0000-0000000000a1','reserve-a@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01340000-0000-0000-0000-0000000000a1','01340000-0000-0000-0000-000000000001','Member A','reserve-a@example.com','Engineer');
-- A 100-credit org-pool grant (owner_id NULL — FR-CRE-001). Inserted as the test superuser (before
-- `set local role`), bypassing credits_insert's Operator-only policy — same fixture posture as 0118.
insert into credits (org_id, owner_id, amount, granted_by) values
  ('01340000-0000-0000-0000-000000000001', null, 100, '01340000-0000-0000-0000-0000000000a1');

-- Act as Member A (org X) for every RPC below (reserve_credits/org_credit_balance assert p_org_id =
-- auth_org_id() + is_active_member() at entry, so they MUST run under the caller JWT, not the superuser).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01340000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- (0) Baseline: 100 granted, 0 spent, 0 held → available 100 (proves the sums reserve_credits reuses).
select is(public.org_credit_balance('01340000-0000-0000-0000-000000000001'), 100::numeric,
  'AC-RESERVE-000 baseline: 100 granted, 0 spent, 0 held → available 100');

-- (1) reserve 80 (run1) succeeds + a held reservation now exists.
select ok(
  public.reserve_credits('01340000-0000-0000-0000-000000000001', 80, '01340000-0000-0000-0000-000000000101') IS NOT NULL,
  'AC-RESERVE-001 reserve 80 (run1) succeeds and returns a reservation id');
reset role;
select is(
  (select count(*) from public.credit_reservations
     where org_id = '01340000-0000-0000-0000-000000000001' and released_at is null),
  1::bigint,
  'AC-RESERVE-001 a single unreleased hold now exists for org X (80 held)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"01340000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- (2) THE OVERSPEND THAT USED TO SLIP THROUGH: a SECOND reserve of 30 (run2) is REJECTED — 80 is
--     already held, so 80+30=110 would exceed the 100 balance. Under the old read-only guard, both
--     turns read balance 100 and both proceeded; reserve_credits' hold accounting blocks the second.
select throws_ok(
  $$ select public.reserve_credits('01340000-0000-0000-0000-000000000001', 30, '01340000-0000-0000-0000-000000000102') $$,
  '23514', null,
  'AC-RESERVE-002 second reserve of 30 (run2) is rejected (23514) — 80 held would total 110 > 100');

-- (3) reserve 20 (run2) succeeds — 80+20 = 100, EXACTLY the balance (boundary: available >= amount).
select ok(
  public.reserve_credits('01340000-0000-0000-0000-000000000001', 20, '01340000-0000-0000-0000-000000000102') IS NOT NULL,
  'AC-RESERVE-003 reserve 20 (run2) succeeds — 80+20 = 100 exactly (available >= amount, boundary)');

-- (4) release run1, then reserve 50 (run3) succeeds — the released 80 hold freed up the pool
--     (run2's 20 is still held; available = 100 − 20 = 80 ≥ 50).
select lives_ok(
  $$ select public.release_credits('01340000-0000-0000-0000-000000000101') $$,
  'AC-RESERVE-004 release_credits(run1) succeeds');
select ok(
  public.reserve_credits('01340000-0000-0000-0000-000000000001', 50, '01340000-0000-0000-0000-000000000103') IS NOT NULL,
  'AC-RESERVE-004 after release(run1), reserve 50 (run3) succeeds — the 80 hold was released');

-- (5) release_credits is IDEMPOTENT: re-releasing run1 is a 0-row no-op (already released), no throw.
select lives_ok(
  $$ select public.release_credits('01340000-0000-0000-0000-000000000101') $$,
  'AC-RESERVE-005 release_credits(run1) again is a no-op (idempotent — WHERE released_at IS NULL)');

-- (6) GUARD-STYLE ERRORS (mirror org_credit_balance, 0067):
--     (6a) reserving for a DIFFERENT org (p_org_id <> auth_org_id()) → 42501 (org_mismatch).
select throws_ok(
  $$ select public.reserve_credits('01340000-0000-0000-0000-000000000002', 10, '01340000-0000-0000-0000-000000000104') $$,
  '42501', null,
  'AC-RESERVE-006a reserve for a DIFFERENT org → 42501 (org_mismatch — a member reserves own-org only)');

--     (6b) p_amount <= 0 → 23514 (amount_positive — the SAME errcode insufficient_credits uses, so the
--          guard classifies both as out_of_credits without a special case).
select throws_ok(
  $$ select public.reserve_credits('01340000-0000-0000-0000-000000000001', 0, '01340000-0000-0000-0000-000000000105') $$,
  '23514', null,
  'AC-RESERVE-006b reserve amount <= 0 → 23514 (amount_positive — guard-error parity with 0067)');

reset role;
select * from finish();
rollback;
