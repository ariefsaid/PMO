-- 0101_agent_transcript_append_only.test.sql — the append-only-violation fix (gpt-5.5 audit #6,
-- migration 0049). Proves the agent transcript + mint-audit trail cannot be destroyed:
--   AC-AAN-030  the owner DELETE policy on agent_events is GONE — an owner cannot delete a
--               transcript/audit event (append-only: no DELETE at all under RLS).
--   AC-AAN-031  the owner DELETE policy on agent_runs is GONE — a run (carrying its audit events)
--               cannot be hard-deleted by the owner (which would cascade-nuke the events).
--   AC-AAN-032  the owner DELETE policy on agent_threads is GONE — a thread cannot be hard-deleted
--               (cascade → runs → events); soft-archive (archived_at) is the retirement path.
--   AC-AAN-033  a thread SOFT-ARCHIVE (set archived_at) STILL succeeds for the owner — the retention
--               model is soft-archive, not hard-delete.
--   AC-AAN-034  notifications DELETE is RETAINED (owner clearing their own inbox is defensible,
--               Director decision) — the owner can still delete their own notification.
-- Fixtures inserted as the table owner (bypassing RLS), then `set local role authenticated` +
-- `set local request.jwt.claims`. Fixture namespace: 01010000-….
begin;
select plan(9);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into auth.users (id, email) values
  ('01010000-0000-0000-0000-0000000000a1','ao-ann@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01010000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AO Ann','ao-ann@example.com','Engineer');

-- Ann owns a thread + run + one system (mint-audit) event.
insert into agent_threads (id, owner_id, title) values
  ('01010000-0000-0000-0000-000000000010','01010000-0000-0000-0000-0000000000a1','Ann Automation Thread');
insert into agent_runs (id, thread_id, owner_id, status) values
  ('01010000-0000-0000-0000-000000000020','01010000-0000-0000-0000-000000000010','01010000-0000-0000-0000-0000000000a1','running');
insert into agent_events (id, run_id, owner_id, seq, type, payload) values
  ('01010000-0000-0000-0000-000000000030','01010000-0000-0000-0000-000000000020','01010000-0000-0000-0000-0000000000a1', 0, 'system',
   '{"kind":"automation_mint","automation_id":"auto-1"}'::jsonb);

-- A notification addressed to Ann (for the retained-delete check).
insert into notifications (id, owner_id, title, severity) values
  ('01010000-0000-0000-0000-000000000040','01010000-0000-0000-0000-0000000000a1','Automation fired','info');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-030/031/032: the owner DELETE policies on the transcript tables are GONE.
-- Two independent barriers now stand: no DELETE policy under FORCE RLS, AND (since 0193) no DELETE
-- grant to `authenticated` at all, so the statement is refused at the privilege check. We assert
-- all of it: the policy is absent, the DELETE is refused, and the row is not deleted.
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from pg_policies where tablename = 'agent_events' and cmd = 'DELETE'),
  0,
  'AC-AAN-030: no DELETE policy exists on agent_events (append-only)');

select is(
  (select count(*)::int from pg_policies where tablename = 'agent_runs' and cmd = 'DELETE'),
  0,
  'AC-AAN-031: no DELETE policy exists on agent_runs (no hard-delete of audit-bearing runs)');

select is(
  (select count(*)::int from pg_policies where tablename = 'agent_threads' and cmd = 'DELETE'),
  0,
  'AC-AAN-032: no DELETE policy exists on agent_threads (soft-archive only)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01010000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- The owner's DELETE of their own audit-bearing row cannot destroy it.
--
-- ⚑ MECHANISM CHANGE (migration 0193_dead_authenticated_write_grants.sql, #511) — a STRENGTHENING,
-- not a weakening-to-pass; the same move 0105 made on 0109's anon assertions. The GOAL-ORACLE of
-- AC-AAN-030/031/032 is untouched: the owner cannot destroy a transcript/audit row, and the
-- mint-audit event still exists afterwards (that survival assertion, below, is the oracle and is
-- unedited). What changed is WHY the DELETE fails. Before 0193 these statements were EXECUTABLE —
-- `authenticated` held table-level DELETE on all three tables from 0075's blanket grant — and RLS
-- denied them at the row level, so each ran as a silent 0-row DELETE: lives_ok. 0193 revoked those
-- dead grants (none of the three has, or should have, a DELETE policy), so the privilege check now
-- rejects the statement at 42501 BEFORE RLS is reached. A delete that cannot be attempted is
-- strictly stronger than one that is attempted and matches nothing.
select throws_ok(
  $$ delete from agent_events where id = '01010000-0000-0000-0000-000000000030' $$,
  '42501', null,
  'AC-AAN-030: owner DELETE on their own agent_events row is denied at the privilege check (0193 revoked the dead DELETE grant; no DELETE policy either)');

select throws_ok(
  $$ delete from agent_runs where id = '01010000-0000-0000-0000-000000000020' $$,
  '42501', null,
  'AC-AAN-031: owner DELETE on their own agent_runs row is denied at the privilege check (0193 revoked the dead DELETE grant; no DELETE policy either)');

select throws_ok(
  $$ delete from agent_threads where id = '01010000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'AC-AAN-032: owner DELETE on their own agent_threads row is denied at the privilege check (0193 revoked the dead DELETE grant; no DELETE policy either)');

reset role;

-- The mint-audit event still exists after all three attempted deletes (nothing was destroyed).
select is(
  (select count(*)::int from agent_events where id = '01010000-0000-0000-0000-000000000030'),
  1,
  'AC-AAN-030: the mint-audit event survives the owner delete attempts (append-only holds)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-033: a thread SOFT-ARCHIVE (archived_at) still succeeds for the owner.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01010000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ update agent_threads set archived_at = now() where id = '01010000-0000-0000-0000-000000000010' $$,
  'AC-AAN-033: owner soft-archive (set archived_at) on their own thread succeeds (retention model)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-034: notifications DELETE is RETAINED — the owner can clear their own inbox.
-- ════════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$ delete from notifications where id = '01010000-0000-0000-0000-000000000040' $$,
  'AC-AAN-034: owner can still DELETE their own notification (inbox clear retained)');

reset role;

select * from finish();
rollback;
