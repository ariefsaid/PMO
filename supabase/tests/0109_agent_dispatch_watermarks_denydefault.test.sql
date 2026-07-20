-- 0109_agent_dispatch_watermarks_denydefault.test.sql
-- sec review LOW-1: agent_dispatch_watermarks has RLS enabled+forced but deliberately NO policy
-- (migration 0048 — it is dispatcher bookkeeping, not tenant data; see that migration's comment).
-- No pgTAP previously proved the default-deny actually holds. This asserts: anon AND authenticated
-- get ZERO rows on SELECT and are DENIED INSERT/UPDATE/DELETE — RLS enabled+forced with no policy
-- means default-deny for every ordinary JWT role; only service_role (which bypasses RLS entirely,
-- proven by the table-owner fixture insert below succeeding) ever reaches this table.
--
-- MECHANISM CHANGE (migration 0105_revoke_anon_write_dml.sql, Director-approved Tier-2 hardening):
-- the GOAL-ORACLE here — "anon cannot mutate agent_dispatch_watermarks" — is UNCHANGED; only the
-- MECHANISM proving it changed. Pre-0105 the anon UPDATE/DELETE assertions counted 0 rows affected
-- (RLS row-denial), which DEPENDED on anon holding the UPDATE/DELETE grants so the statement was
-- executable and RLS was what denied. 0105 revoked anon insert/update/delete on all public base
-- tables, so those same statements now raise 42501 at the privilege check BEFORE RLS is evaluated.
-- The assertions therefore switched from "affects 0 rows" to throws_ok 42501 — strictly STRONGER
-- (anon can no longer even attempt the statement). This is a test STRENGTHENING, not a weakening-
-- to-pass. (The authenticated assertions are unchanged: authenticated keeps full RLS-gated DML, so
-- its UPDATE still reaches RLS and affects 0 rows.)
begin;
select plan(9);

-- Fixture (inserted as table owner — bypasses RLS; this IS the "service_role reaches it" proof:
-- an unprivileged role could not have done this insert, as proven below).
insert into agent_dispatch_watermarks (source, last_seen_id, last_seen_at) values
  ('0109-fixture-source', gen_random_uuid(), now());

select is(
  (select count(*)::int from agent_dispatch_watermarks where source = '0109-fixture-source'),
  1,
  'sec-LOW-1: table owner (service_role-equivalent, RLS bypass) sees the fixture row');

-- ═══════════════════════════════════════════════════════════════════════════
-- anon: denied on all four operations (SELECT → RLS default-deny, 0 rows; INSERT/UPDATE/DELETE →
-- 42501 privilege denial per 0105 — see header).
-- ════════════════════════════════════════════════════════════════════════════
set local role anon;

select is(
  (select count(*)::int from agent_dispatch_watermarks),
  0,
  'sec-LOW-1: anon SELECT returns 0 rows (default-deny, no SELECT policy)');

select throws_ok(
  $$ insert into agent_dispatch_watermarks (source) values ('0109-anon-insert') $$,
  '42501', null,
  'sec-LOW-1: anon INSERT denied (0105 revoked anon INSERT grant → 42501 privilege denial precedes RLS)');

select throws_ok(
  $$ update agent_dispatch_watermarks set last_seen_at = now() where source = '0109-fixture-source' $$,
  '42501', null,
  'sec-LOW-1: anon UPDATE denied (0105 revoked anon UPDATE grant → 42501 privilege denial precedes RLS)');

select throws_ok(
  $$ delete from agent_dispatch_watermarks where source = '0109-fixture-source' $$,
  '42501', null,
  'sec-LOW-1: anon DELETE denied (0105 revoked anon DELETE grant → 42501 privilege denial precedes RLS)');

reset role;

-- The fixture row must still exist (anon''s UPDATE/DELETE were DENIED — 42501 — so they never ran).
select is(
  (select count(*)::int from agent_dispatch_watermarks where source = '0109-fixture-source'),
  1,
  'sec-LOW-1: fixture row survives anon''s denied UPDATE/DELETE attempts');

-- ════════════════════════════════════════════════════════════════════════════
-- authenticated (an ordinary logged-in user, no special role): same default-deny.
-- ════════════════════════════════════════════════════════════════════════════
insert into organizations (id, name) values
  ('01090000-0000-0000-0000-000000000001','Watermark Denydefault Org');
insert into auth.users (id, email) values
  ('01090000-0000-0000-0000-0000000000a1','wm-deny-user@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01090000-0000-0000-0000-0000000000a1','01090000-0000-0000-0000-000000000001','WM Deny User','wm-deny-user@example.com','Admin');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01090000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from agent_dispatch_watermarks),
  0,
  'sec-LOW-1: authenticated (even Admin) SELECT returns 0 rows (default-deny, no SELECT policy)');

select throws_ok(
  $$ insert into agent_dispatch_watermarks (source) values ('0109-auth-insert') $$,
  '42501', null,
  'sec-LOW-1: authenticated (even Admin) INSERT denied (default-deny, no INSERT policy)');

with upd as (
  update agent_dispatch_watermarks set last_seen_at = now()
    where source = '0109-fixture-source'
  returning source)
select is(
  (select count(*)::int from upd),
  0,
  'sec-LOW-1: authenticated (even Admin) UPDATE affects 0 rows (default-deny — row invisible)');

reset role;

select * from finish();
rollback;
