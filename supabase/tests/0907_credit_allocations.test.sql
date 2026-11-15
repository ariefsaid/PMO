-- 0907_credit_allocations.test.sql
-- AC-ALLOC-001..009 + AC-ALLOC-012 [pgTAP]: splitting the org's AI credit pool among users (#564, layer 2 of the
-- credit model) is a REDISTRIBUTION. It never changes the pool's total, and the sum of user
-- allocations never exceeds it — on the success paths AND the refusal paths.
--
-- The oracle is the invariant, not any screen:
--   pool total        = Σ credits.amount for the org (only an Operator grant raises it; ADR-0049 §3)
--   Σ allocations     ≤ pool total, always
--   unallocated       = pool total − Σ allocations
-- Every case below re-reads the pool total, org_credit_balance and Σ allocations and asserts they
-- are what they were (total, balance) or what the move implies (allocations).
--
-- Concurrency: two re-splits racing for the same unallocated credit are proven by the two-session
-- probe scripts/credit-allocation-race.test.mjs (pgTAP runs in one transaction and cannot race).
begin;
select plan(29);

-- ── Fixtures (as the test superuser): org X (pool 100) + org Y; an Admin, two Engineers in X; one
--    Engineer in Y.
insert into organizations (id, name) values
  ('09070000-0000-0000-0000-000000000001','AC-ALLOC Org X'),
  ('09070000-0000-0000-0000-000000000002','AC-ALLOC Org Y');
insert into auth.users (id, email) values
  ('09070000-0000-0000-0000-0000000000a1','alloc-admin@example.com'),
  ('09070000-0000-0000-0000-0000000000b1','alloc-b@example.com'),
  ('09070000-0000-0000-0000-0000000000c1','alloc-c@example.com'),
  ('09070000-0000-0000-0000-0000000000d1','alloc-y@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('09070000-0000-0000-0000-0000000000a1','09070000-0000-0000-0000-000000000001','Alloc Admin','alloc-admin@example.com','Admin'),
  ('09070000-0000-0000-0000-0000000000b1','09070000-0000-0000-0000-000000000001','Alloc B','alloc-b@example.com','Engineer'),
  ('09070000-0000-0000-0000-0000000000c1','09070000-0000-0000-0000-000000000001','Alloc C','alloc-c@example.com','Engineer'),
  ('09070000-0000-0000-0000-0000000000d1','09070000-0000-0000-0000-000000000002','Alloc Y','alloc-y@example.com','Engineer');
insert into credits (org_id, owner_id, amount, granted_by) values
  ('09070000-0000-0000-0000-000000000001', null, 60, '09070000-0000-0000-0000-0000000000a1'),
  ('09070000-0000-0000-0000-000000000001', null, 40, '09070000-0000-0000-0000-0000000000a1');

-- Invariant readers (run as superuser so RLS never hides a row from the oracle).
create temp table _x as select '09070000-0000-0000-0000-000000000001'::uuid as org;
grant select on _x to authenticated;
create or replace function pg_temp.pool() returns numeric language sql as
  $$ select coalesce(sum(amount),0) from public.credits where org_id = (select org from _x) $$;
create or replace function pg_temp.allocated() returns numeric language sql as
  $$ select coalesce(sum(amount),0) from public.credit_allocations where org_id = (select org from _x) $$;
create or replace function pg_temp.alloc(u uuid) returns numeric language sql as
  $$ select coalesce((select amount from public.credit_allocations where user_id = u),0) $$;

-- ── AC-ALLOC-001: an Admin moves 70 from the unallocated pool to B, then 20 to C.
set local role authenticated;
set local request.jwt.claims = '{"sub":"09070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select public.admin_move_credit_allocation(null, '09070000-0000-0000-0000-0000000000b1', 70) $$,
  'AC-ALLOC-001 Admin allocates 70 of the pool to B');
select lives_ok(
  $$ select public.admin_move_credit_allocation(null, '09070000-0000-0000-0000-0000000000c1', 20) $$,
  'AC-ALLOC-001 Admin allocates 20 of the pool to C');
select is(public.org_credit_balance('09070000-0000-0000-0000-000000000001'), 100::numeric,
  'AC-ALLOC-001 the org balance is unchanged by allocating (still 100)');
reset role;
select is(pg_temp.pool(), 100::numeric, 'AC-ALLOC-001 the pool total is unchanged (100)');
select is(pg_temp.allocated(), 90::numeric, 'AC-ALLOC-001 Σ allocations = 90 (70 + 20), within the pool');

-- ── AC-ALLOC-002: over-allocating the pool is refused and changes nothing (the failure path).
set local role authenticated;
set local request.jwt.claims = '{"sub":"09070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_move_credit_allocation(null, '09070000-0000-0000-0000-0000000000c1', 11) $$,
  '23514', 'insufficient_unallocated',
  'AC-ALLOC-002 allocating 11 when only 10 is unallocated is refused');
reset role;
select is(pg_temp.allocated(), 90::numeric, 'AC-ALLOC-002 the refused move left Σ allocations at 90');
select is(pg_temp.alloc('09070000-0000-0000-0000-0000000000c1'), 20::numeric,
  'AC-ALLOC-002 the refused move did not credit C (no partial allocation)');

-- ── AC-ALLOC-003: a user-to-user re-split moves credit without changing the sum.
set local role authenticated;
set local request.jwt.claims = '{"sub":"09070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select public.admin_move_credit_allocation('09070000-0000-0000-0000-0000000000b1', '09070000-0000-0000-0000-0000000000c1', 30) $$,
  'AC-ALLOC-003 Admin re-splits 30 from B to C');
reset role;
select is(pg_temp.alloc('09070000-0000-0000-0000-0000000000b1'), 40::numeric, 'AC-ALLOC-003 B is debited to 40');
select is(pg_temp.alloc('09070000-0000-0000-0000-0000000000c1'), 50::numeric, 'AC-ALLOC-003 C is credited to 50');
select is(pg_temp.allocated(), 90::numeric, 'AC-ALLOC-003 Σ allocations is unchanged by the re-split (90)');

-- ── AC-ALLOC-004: moving more than the source user holds is refused; neither side changes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"09070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_move_credit_allocation('09070000-0000-0000-0000-0000000000b1', '09070000-0000-0000-0000-0000000000c1', 41) $$,
  '23514', 'insufficient_allocation',
  'AC-ALLOC-004 moving 41 from B (holds 40) is refused');
reset role;
select ok(pg_temp.alloc('09070000-0000-0000-0000-0000000000b1') = 40
      and pg_temp.alloc('09070000-0000-0000-0000-0000000000c1') = 50,
  'AC-ALLOC-004 the refused move debited neither B nor credited C');

-- ── AC-ALLOC-005: removing a user's allocation returns it to the pool; removing the user does too.
set local role authenticated;
set local request.jwt.claims = '{"sub":"09070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select public.admin_move_credit_allocation('09070000-0000-0000-0000-0000000000b1', null, 40) $$,
  'AC-ALLOC-005 Admin returns all of B''s 40 to the pool');
reset role;
select is((select count(*) from public.credit_allocations where user_id = '09070000-0000-0000-0000-0000000000b1'),
  0::bigint, 'AC-ALLOC-005 an emptied allocation leaves no row');
delete from profiles where id = '09070000-0000-0000-0000-0000000000c1';
select ok(pg_temp.allocated() = 0 and pg_temp.pool() = 100,
  'AC-ALLOC-005 deleting user C returns their 50 to the pool; the total stays 100');

-- ── AC-ALLOC-006: only an Admin of the org can move credit; never across orgs; amount > 0.
set local role authenticated;
set local request.jwt.claims = '{"sub":"09070000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_move_credit_allocation(null, '09070000-0000-0000-0000-0000000000b1', 5) $$,
  '42501', 'admin_only', 'AC-ALLOC-006 an Engineer cannot allocate credit (not even to themself)');
set local request.jwt.claims = '{"sub":"09070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_move_credit_allocation(null, '09070000-0000-0000-0000-0000000000d1', 5) $$,
  '42501', 'user_not_in_org', 'AC-ALLOC-006 an Admin cannot allocate to a user in another org');
select throws_ok(
  $$ select public.admin_move_credit_allocation(null, '09070000-0000-0000-0000-0000000000b1', 0) $$,
  '23514', 'amount_positive', 'AC-ALLOC-006 a zero move is refused');
select throws_ok(
  $$ select public.admin_move_credit_allocation(null, null, 5) $$,
  '22023', 'same_bucket', 'AC-ALLOC-006 a move from the pool to the pool is refused');

-- ── AC-ALLOC-007: no client role writes the table directly — the RPC is the only writer.
select throws_ok(
  $$ insert into public.credit_allocations (org_id, user_id, amount)
       values ('09070000-0000-0000-0000-000000000001','09070000-0000-0000-0000-0000000000a1', 1000) $$,
  '42501', null, 'AC-ALLOC-007 an Admin cannot INSERT an allocation directly (no write grant)');
reset role;
select ok(not has_table_privilege('authenticated', 'public.credit_allocations', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.credit_allocations', 'DELETE')
      and not has_table_privilege('anon', 'public.credit_allocations', 'SELECT'),
  'AC-ALLOC-007 authenticated has no UPDATE/DELETE and anon has no access');

-- ── AC-ALLOC-008: the database refuses an over-allocation on ANY write path (the backstop), even a
--    privileged direct write that skips the RPC.
set constraints all immediate;
select throws_ok(
  $$ insert into public.credit_allocations (org_id, user_id, amount)
       values ('09070000-0000-0000-0000-000000000001','09070000-0000-0000-0000-0000000000a1', 101) $$,
  '23514', 'allocation_exceeds_pool',
  'AC-ALLOC-008 a direct write that allocates past the pool total is refused by the database');
select throws_ok(
  $$ insert into public.credit_allocations (org_id, user_id, amount)
       values ('09070000-0000-0000-0000-000000000001','09070000-0000-0000-0000-0000000000d1', 1) $$,
  '23514', 'allocation_user_not_in_org',
  'AC-ALLOC-008 a direct write that allocates to another org''s user is refused by the database');

-- ── AC-ALLOC-009: who can read allocations — Admin sees the org, a user sees only their own.
insert into public.credit_allocations (org_id, user_id, amount) values
  ('09070000-0000-0000-0000-000000000001','09070000-0000-0000-0000-0000000000a1', 10),
  ('09070000-0000-0000-0000-000000000001','09070000-0000-0000-0000-0000000000b1', 15);
set local role authenticated;
set local request.jwt.claims = '{"sub":"09070000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*) from public.credit_allocations), 1::bigint,
  'AC-ALLOC-009 an Engineer reads only their own allocation');
set local request.jwt.claims = '{"sub":"09070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from public.credit_allocations), 2::bigint,
  'AC-ALLOC-009 an Admin reads every allocation in their org');
reset role;

-- ── AC-ALLOC-012: allocation rows are readable by active members only — a disabled member of the
--    org (here B, who holds a row) reads none, not even their own.
update profiles set status = 'disabled' where id = '09070000-0000-0000-0000-0000000000b1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"09070000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*) from public.credit_allocations), 0::bigint,
  'AC-ALLOC-012 a disabled member of the org reads no allocation rows');
reset role;
select is(pg_temp.pool(), 100::numeric, 'AC-ALLOC-009 after every move and refusal the pool total is still 100');

select * from finish();
rollback;
