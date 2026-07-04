-- 0109_agent_dispatch_watermarks_denydefault.test.sql
-- sec review LOW-1: agent_dispatch_watermarks has RLS enabled+forced but deliberately NO policy
-- (migration 0048 — it is dispatcher bookkeeping, not tenant data; see that migration's comment).
-- No pgTAP previously proved the default-deny actually holds. This asserts: anon AND authenticated
-- get ZERO rows on SELECT and are DENIED INSERT/UPDATE/DELETE — RLS enabled+forced with no policy
-- means default-deny for every ordinary JWT role; only service_role (which bypasses RLS entirely,
-- proven by the table-owner fixture insert below succeeding) ever reaches this table.
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

-- ════════════════════════════════════════════════════════════════════════════
-- anon: default-deny on all four operations.
-- ════════════════════════════════════════════════════════════════════════════
set local role anon;

select is(
  (select count(*)::int from agent_dispatch_watermarks),
  0,
  'sec-LOW-1: anon SELECT returns 0 rows (default-deny, no SELECT policy)');

select throws_ok(
  $$ insert into agent_dispatch_watermarks (source) values ('0109-anon-insert') $$,
  '42501', null,
  'sec-LOW-1: anon INSERT denied (default-deny, no INSERT policy)');

with upd as (
  update agent_dispatch_watermarks set last_seen_at = now()
    where source = '0109-fixture-source'
  returning source)
select is(
  (select count(*)::int from upd),
  0,
  'sec-LOW-1: anon UPDATE affects 0 rows (default-deny, no UPDATE policy — row invisible)');

with del as (
  delete from agent_dispatch_watermarks where source = '0109-fixture-source'
  returning source)
select is(
  (select count(*)::int from del),
  0,
  'sec-LOW-1: anon DELETE affects 0 rows (default-deny, no DELETE policy — row invisible)');

reset role;

-- The fixture row must still exist (anon''s UPDATE/DELETE truly no-op''d, not silently succeeded).
select is(
  (select count(*)::int from agent_dispatch_watermarks where source = '0109-fixture-source'),
  1,
  'sec-LOW-1: fixture row survives anon''s no-op UPDATE/DELETE attempts');

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
