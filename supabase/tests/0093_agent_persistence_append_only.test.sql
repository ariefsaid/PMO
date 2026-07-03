-- 0093_agent_persistence_append_only.test.sql — agent_events append-only + feedback UPDATE
-- (ADR-0043 §2/§3/§5, FR-AGP-009). Proves: a non-owner cannot insert into another user's run; a plain
-- UPDATE touching payload/text/type/tool_* is rejected even for the owner; the narrow feedback UPDATE
-- (rating/downvote_reason only) succeeds for the owner on an assistant row and leaves everything else
-- unchanged; the same feedback UPDATE is denied for a non-owner. Fixtures inserted as the table owner
-- (bypassing RLS), then `set local role authenticated` + `set local request.jwt.claims`.
-- Fixture namespace: 00930000-….
begin;
select plan(14);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into auth.users (id, email) values
  ('00930000-0000-0000-0000-0000000000a1','agp-ao-ann@example.com'),
  ('00930000-0000-0000-0000-0000000000a2','agp-ao-bob@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00930000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AGP AO Ann','agp-ao-ann@example.com','Engineer'),
  ('00930000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','AGP AO Bob','agp-ao-bob@example.com','Engineer');

-- Ann owns a thread + run + one assistant event.
insert into agent_threads (id, owner_id, title) values
  ('00930000-0000-0000-0000-000000000010','00930000-0000-0000-0000-0000000000a1','Ann AO Thread');
insert into agent_runs (id, thread_id, owner_id, status) values
  ('00930000-0000-0000-0000-000000000020','00930000-0000-0000-0000-000000000010','00930000-0000-0000-0000-0000000000a1','completed');
insert into agent_events (id, run_id, owner_id, seq, type, text, payload) values
  ('00930000-0000-0000-0000-000000000030','00930000-0000-0000-0000-000000000020','00930000-0000-0000-0000-0000000000a1', 1, 'assistant', 'Original reply', '{"orig":true}'::jsonb);

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-009: a non-owner cannot insert into another user's run/thread.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00930000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ insert into agent_events (run_id, seq, type, text)
       values ('00930000-0000-0000-0000-000000000020', 2, 'user', 'Hijack attempt') $$,
  '42501', null,
  'AC-AGP-009: non-owner (Bob) insert under Ann''s run_id is denied (WITH CHECK)');

reset role;

select is(
  (select count(*)::int from agent_events where run_id = '00930000-0000-0000-0000-000000000020'),
  1,
  'AC-AGP-009: no row was actually inserted by the denied attempt');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-010: a plain UPDATE touching payload/text/type/tool_* is rejected — append-only holds
-- even for the owner.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00930000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update agent_events set payload = '{"x":1}'::jsonb where id = '00930000-0000-0000-0000-000000000030' $$,
  '42501', null,
  'AC-AGP-010: owner UPDATE touching payload is rejected (append-only trigger)');

select throws_ok(
  $$ update agent_events set text = 'Rewritten' where id = '00930000-0000-0000-0000-000000000030' $$,
  '42501', null,
  'AC-AGP-010: owner UPDATE touching text is rejected (append-only trigger)');

select throws_ok(
  $$ update agent_events set type = 'system' where id = '00930000-0000-0000-0000-000000000030' $$,
  '42501', null,
  'AC-AGP-010: owner UPDATE touching type is rejected (append-only trigger)');

select throws_ok(
  $$ update agent_events set tool_name = 'sneaky_tool' where id = '00930000-0000-0000-0000-000000000030' $$,
  '42501', null,
  'AC-AGP-010: owner UPDATE touching tool_name is rejected (append-only trigger)');

select throws_ok(
  $$ update agent_events set tool_args_hash = 'deadbeef' where id = '00930000-0000-0000-0000-000000000030' $$,
  '42501', null,
  'AC-AGP-010: owner UPDATE touching tool_args_hash is rejected (append-only trigger)');

select throws_ok(
  $$ update agent_events set tool_status = 'errored' where id = '00930000-0000-0000-0000-000000000030' $$,
  '42501', null,
  'AC-AGP-010: owner UPDATE touching tool_status is rejected (append-only trigger)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-011: the feedback UPDATE succeeds for the owner on an assistant row, touching only
-- rating/downvote_reason — payload/text/type unchanged.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00930000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ update agent_events set rating = 'down', downvote_reason = 'inaccurate'
       where id = '00930000-0000-0000-0000-000000000030' $$,
  'AC-AGP-011: owner feedback UPDATE (rating + downvote_reason) on own assistant row succeeds');

reset role;

select is(
  (select payload from agent_events where id = '00930000-0000-0000-0000-000000000030'),
  '{"orig":true}'::jsonb,
  'AC-AGP-011: payload is unchanged after the feedback UPDATE');
select is(
  (select text from agent_events where id = '00930000-0000-0000-0000-000000000030'),
  'Original reply',
  'AC-AGP-011: text is unchanged after the feedback UPDATE');
select is(
  (select type from agent_events where id = '00930000-0000-0000-0000-000000000030'),
  'assistant',
  'AC-AGP-011: type is unchanged after the feedback UPDATE');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-012: the feedback UPDATE is denied for a non-owner (zero rows affected).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00930000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ update agent_events set rating = 'up' where id = '00930000-0000-0000-0000-000000000030' $$,
  'AC-AGP-012: non-owner (Bob) feedback UPDATE on Ann''s assistant row is a 0-row no-op (USING hides it)');

reset role;

select is(
  (select rating from agent_events where id = '00930000-0000-0000-0000-000000000030'),
  'down',
  'AC-AGP-012: rating unchanged after the non-owner''s denied feedback UPDATE (still Ann''s ''down'')');

select * from finish();
rollback;
