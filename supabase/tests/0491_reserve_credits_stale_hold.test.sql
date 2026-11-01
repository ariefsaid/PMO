-- 0491_reserve_credits_stale_hold.test.sql
-- AC-RESERVE-STALE-001..003 [pgTAP]: a hold leaked by a killed isolate (its `finally` never ran, so
-- release_credits never fired) stops counting against `available` once it is older than 30 minutes
-- (migration 0491). A fresh hold still blocks. Org pool: 100 granted, 0 spent.
begin;
select plan(4);

insert into organizations (id, name) values ('04910000-0000-0000-0000-000000000001','AC-RESERVE-STALE Org');
insert into auth.users (id, email) values ('04910000-0000-0000-0000-0000000000a1','stale-a@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('04910000-0000-0000-0000-0000000000a1','04910000-0000-0000-0000-000000000001','Member A','stale-a@example.com','Engineer');
insert into credits (org_id, owner_id, amount, granted_by) values
  ('04910000-0000-0000-0000-000000000001', null, 100, '04910000-0000-0000-0000-0000000000a1');
-- A leaked hold of 90, 31 minutes old (never released).
insert into credit_reservations (org_id, run_id, amount, created_at) values
  ('04910000-0000-0000-0000-000000000001', '04910000-0000-0000-0000-000000000101', 90, now() - interval '31 minutes');

set local role authenticated;
set local request.jwt.claims = '{"sub":"04910000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select ok(
  public.reserve_credits('04910000-0000-0000-0000-000000000001', 50, '04910000-0000-0000-0000-000000000102') is not null,
  'AC-RESERVE-STALE-001 a 31-minute-old unreleased hold of 90 no longer blocks a reserve of 50 (pool 100)');

-- The fresh hold of 50 just placed still counts: 50 held, so a further 60 does not fit.
select throws_ok(
  $$ select public.reserve_credits('04910000-0000-0000-0000-000000000001', 60, '04910000-0000-0000-0000-000000000103') $$,
  '23514', null,
  'AC-RESERVE-STALE-002 a fresh hold still blocks: 50 held leaves 50, a reserve of 60 is refused (23514)');

-- Boundary: a 29-minute-old hold still counts (the bound is 30 minutes).
reset role;
insert into credit_reservations (org_id, run_id, amount, created_at) values
  ('04910000-0000-0000-0000-000000000001', '04910000-0000-0000-0000-000000000104', 40, now() - interval '29 minutes');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04910000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.reserve_credits('04910000-0000-0000-0000-000000000001', 20, '04910000-0000-0000-0000-000000000105') $$,
  '23514', null,
  'AC-RESERVE-STALE-003 a 29-minute-old hold still counts: 50 + 40 held leaves 10, a reserve of 20 is refused');

-- Releasing the stale hold is still harmless (idempotent no-op on an expired row).
select lives_ok(
  $$ select public.release_credits('04910000-0000-0000-0000-000000000101') $$,
  'AC-RESERVE-STALE-004 release_credits on an expired hold does not error');

reset role;
select * from finish();
rollback;
