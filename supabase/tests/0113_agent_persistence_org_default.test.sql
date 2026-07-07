-- 0113_agent_persistence_org_default.test.sql — agent persistence org-stamp proof (Defect 1).
--
-- ROOT CAUSE this test pins: agent_threads/agent_runs/agent_events originally carried a CONSTANT
-- seed-org column default ('00000000-…-0001'). RLS INSERT WITH CHECK requires
-- `org_id = auth_org_id()`. For any user NOT in the seed org, an insert that sends NO org_id (the
-- deputy's "never send org_id" pattern) stamps the seed-org default → WITH CHECK fails → 42501,
-- silently swallowed by persistence.ts → 0 runs persist (production defect). The fix makes the
-- three column DEFAULTs resolve to the caller's real org via auth_org_id(), so the no-org_id insert
-- path succeeds for EVERY org while RLS remains the sole enforcement authority.
--
-- This test owns the proof at the SQL/RLS layer (ADR-0010): a NON-seed-org caller's no-org_id
-- insert into all three tables SUCCEEDS and is stamped with that caller's real org; cross-org read
-- still returns zero; the seed-org caller still works (regression). Mirrors the 0092 tenancy shape.
-- Fixture namespace: 01130000-…. Org B = '01130000-…-0002' (deliberately NOT the seed org).
begin;
select plan(14);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into organizations (id, name) values
  ('01130000-0000-0000-0000-000000000002','Agent Org-Default Org B');

insert into auth.users (id, email) values
  ('01130000-0000-0000-0000-0000000000b1','agp-org-b@example.com'),
  ('01130000-0000-0000-0000-0000000000a1','agp-org-a@example.com');

-- Carol is in Org B (a REAL non-seed org); Ann is in the seed org.
insert into profiles (id, org_id, full_name, email, role) values
  ('01130000-0000-0000-0000-0000000000b1','01130000-0000-0000-0000-000000000002','Carol','agp-org-b@example.com','Project Manager'),
  ('01130000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Ann','agp-org-a@example.com','Project Manager');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-ORG-001: a NON-seed-org caller's no-org_id persistence insert SUCCEEDS.
-- This is the exact path persistence.ts createThreadAndRun/insertEvent take (they send no org_id).
-- BEFORE the fix this threw 42501 (seed-org default ≠ caller org) — the production defect.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select lives_ok(
  $$ insert into agent_threads (id, title) values ('01130000-0000-0000-0000-000000000010','Carol Thread') $$,
  'AC-AGP-ORG-001: non-seed-org caller (Carol) inserts agent_threads with NO org_id — succeeds (was 42501)');

-- The thread row exists and is stamped with Carol's REAL org (auth_org_id), not the seed org.
select is(
  (select org_id::text from agent_threads where id = '01130000-0000-0000-0000-000000000010'),
  '01130000-0000-0000-0000-000000000002',
  'AC-AGP-ORG-001: agent_threads org_id is stamped to the caller''s real org (auth_org_id)');

-- agent_runs under that thread — also no org_id sent.
select lives_ok(
  $$ insert into agent_runs (id, thread_id, title, status)
       values ('01130000-0000-0000-0000-000000000020','01130000-0000-0000-0000-000000000010','Carol Run','running') $$,
  'AC-AGP-ORG-001: non-seed-org caller inserts agent_runs with NO org_id — succeeds');

select is(
  (select org_id::text from agent_runs where id = '01130000-0000-0000-0000-000000000020'),
  '01130000-0000-0000-0000-000000000002',
  'AC-AGP-ORG-001: agent_runs org_id is stamped to the caller''s real org');

-- agent_events under that run — also no org_id sent (the full persistence sequence mirrors
-- persistence.ts: a user event, an assistant event, then a terminal status event).
select lives_ok(
  $$ insert into agent_events (id, run_id, seq, type, text)
       values ('01130000-0000-0000-0000-000000000031','01130000-0000-0000-0000-000000000020', 0, 'user', 'hello') $$,
  'AC-AGP-ORG-001: non-seed-org caller inserts a user agent_events row with NO org_id — succeeds');
select lives_ok(
  $$ insert into agent_events (id, run_id, seq, type, text)
       values ('01130000-0000-0000-0000-000000000032','01130000-0000-0000-0000-000000000020', 1, 'assistant', 'You have 3 projects.') $$,
  'AC-AGP-ORG-001: non-seed-org caller inserts an assistant agent_events row — succeeds');
select is(
  (select org_id::text from agent_events where id = '01130000-0000-0000-0000-000000000031'),
  '01130000-0000-0000-0000-000000000002',
  'AC-AGP-ORG-001: agent_events org_id is stamped to the caller''s real org');

-- AC-AGP-ORG-001b: the terminal lifecycle persists — drive the run to 'completed' via the SAME
-- owner-RLS UPDATE path persistence.ts setRunStatus uses, then assert the durable end state:
-- one completed run carrying its full event transcript, all stamped to the caller's org. This is
-- the literal Defect-1 proof — a completed run persists an agent_runs row + its events.
select lives_ok(
  $$ update agent_runs set status = 'completed' where id = '01130000-0000-0000-0000-000000000020' $$,
  'AC-AGP-ORG-001b: non-seed-org caller drives the run to terminal completed (setRunStatus path)');

reset role;

-- Read the durable end state AS the table owner (bypassing RLS) to assert what persisted.
select is(
  (select status from agent_runs where id = '01130000-0000-0000-0000-000000000020'),
  'completed',
  'AC-AGP-ORG-001b: the completed run is durably persisted with status=completed');
select is(
  (select count(*)::int from agent_events where run_id = '01130000-0000-0000-0000-000000000020'
     and org_id = '01130000-0000-0000-0000-000000000002'),
  2,
  'AC-AGP-ORG-001b: the completed run''s event transcript (2 events) persisted, all org-stamped to the caller');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-ORG-002: cross-org wall is intact — a seed-org caller reads ZERO of Carol's org-B rows.
-- RLS remains the enforcement authority; the org-stamp fix widened nothing.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from agent_threads where id = '01130000-0000-0000-0000-000000000010'),
  0,
  'AC-AGP-ORG-002: cross-org — seed-org caller reads zero of org-B threads');

select is(
  (select count(*)::int from agent_runs where id = '01130000-0000-0000-0000-000000000020'),
  0,
  'AC-AGP-ORG-002: cross-org — seed-org caller reads zero of org-B runs');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-ORG-003: regression — a SEED-org caller's no-org_id insert still works + stamps the seed org.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into agent_threads (id, title) values ('01130000-0000-0000-0000-000000000011','Ann Thread') $$,
  'AC-AGP-ORG-003: seed-org caller (Ann) no-org_id insert still succeeds');

select is(
  (select org_id::text from agent_threads where id = '01130000-0000-0000-0000-000000000011'),
  '00000000-0000-0000-0000-000000000001',
  'AC-AGP-ORG-003: seed-org caller stamps the seed org (unchanged behaviour)');

reset role;

select * from finish();
rollback;
