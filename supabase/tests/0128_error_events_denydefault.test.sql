-- 0128_error_events_denydefault.test.sql
-- AC-OF-004: public.error_events is service-role-only — no authenticated or anon
-- role may SELECT or INSERT (append-only operator telemetry, never user-facing).
begin;
select plan(7);

select has_table('public', 'error_events', 'AC-OF-004 error_events table exists');

-- Force RLS is on: even the table owner is subject to policy (belt-and-suspenders,
-- matches agent_dispatch_watermarks' posture from ADR-0046).
select ok(
  (select relforcerowsecurity from pg_class where relname = 'error_events'),
  'AC-OF-004 error_events has FORCE ROW LEVEL SECURITY'
);

-- No policy exists for error_events at all (default-deny to every JWT role).
select is(
  (select count(*)::int from pg_policies where tablename = 'error_events'),
  0,
  'AC-OF-004 error_events has zero RLS policies (service-role-only by omission)'
);

-- Simulate an authenticated caller: SELECT returns 0 rows (not an error — RLS
-- silently empties the result set for SELECT with no policy).
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from error_events),
  0,
  'AC-OF-004 authenticated SELECT on error_events returns 0 rows'
);
reset role;

-- Simulate anon: same.
set local role anon;
select is(
  (select count(*)::int from error_events),
  0,
  'AC-OF-004 anon SELECT on error_events returns 0 rows'
);
reset role;

-- Simulate an authenticated caller: INSERT is denied (no policy → RLS blocks the write).
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ insert into error_events (fn, error_code) values ('agent-chat', 'TEST_CODE') $$,
  '42501',
  null,
  'AC-OF-004 authenticated INSERT on error_events is denied (RLS, no policy)'
);
reset role;

-- Simulate anon: same. (Note: migration 0105 revoked anon insert/update/delete on all public base
-- tables, so this 42501 is now raised at the privilege check BEFORE RLS is evaluated — strictly
-- stronger than the previous RLS default-deny. The assertion is unchanged: throws_ok 42501.)
set local role anon;
select throws_ok(
  $$ insert into error_events (fn, error_code) values ('agent-chat', 'TEST_CODE') $$,
  '42501',
  null,
  'AC-OF-004 anon INSERT on error_events is denied (0105: privilege denial precedes RLS)'
);
reset role;

select * from finish();
rollback;
