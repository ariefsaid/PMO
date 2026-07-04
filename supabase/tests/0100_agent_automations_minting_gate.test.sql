-- 0100_agent_automations_minting_gate.test.sql — AC-AAN-019 (pgTAP half): the minted-JWT session
-- is denied cross-tenant data identically to interactive (ADR-0044 §3 — the load-bearing
-- Verification test). A minted JWT is, from Postgres's perspective, just a `request.jwt.claims` set
-- with the owner's sub/role — so this test simulates it exactly as the interactive tenancy tests do,
-- because that IS what a minted client sends. Fixture namespace: 00990000-….
begin;
select plan(4);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into auth.users (id, email) values
  ('00990000-0000-0000-0000-0000000000a1','mint-ann@example.com'),
  ('00990000-0000-0000-0000-0000000000a2','mint-bob@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00990000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Mint Ann','mint-ann@example.com','Engineer'),
  ('00990000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','Mint Bob','mint-bob@example.com','Engineer');

-- Ann owns an automation + an owner-scoped business-data row (agent_threads, the deputy-invariant
-- proxy also used by the interactive persistence gate test). Bob owns a different thread.
insert into agent_automations (id, owner_id, kind, prompt, schedule) values
  ('00990000-0000-0000-0000-000000000010','00990000-0000-0000-0000-0000000000a1','schedule','summarize','0 8 * * 1');

insert into agent_threads (id, owner_id, title) values
  ('00990000-0000-0000-0000-000000000020','00990000-0000-0000-0000-0000000000a1','Ann Thread'),
  ('00990000-0000-0000-0000-000000000021','00990000-0000-0000-0000-0000000000a2','Bob Thread');

-- ════════════════════════════════════════════════════════════════════════════
-- Simulate the minted A-JWT session (dispatcher mints for exactly automation.owner_id = Ann).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00990000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from agent_threads where id = '00990000-0000-0000-0000-000000000020'),
  1,
  'AC-AAN-019: minted A-JWT reads Ann''s own business-data row (same as interactive Ann)');

select is(
  (select count(*)::int from agent_threads where id = '00990000-0000-0000-0000-000000000021'),
  0,
  'AC-AAN-019: minted A-JWT is denied Bob''s business-data row — identical to interactive cross-tenant denial');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- Schema-level twin: no SELECT policy on the three new tables grants Admin cross-owner read.
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from pg_policies
     where tablename in ('agent_automations','notifications')
       and cmd = 'SELECT'
       and qual ilike '%owner_id = auth.uid()%'),
  2,
  'AC-AAN-019: every SELECT policy on agent_automations/notifications gates on owner_id = auth.uid()');

select is(
  (select count(*)::int from pg_policies
     where tablename in ('agent_automations','notifications')
       and cmd = 'SELECT'
       and qual ilike '%auth_role%'),
  0,
  'AC-AAN-019: no SELECT policy references auth_role (no Admin cross-owner read grant)');

select * from finish();
rollback;
