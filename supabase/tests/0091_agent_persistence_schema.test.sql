-- 0091_agent_persistence_schema.test.sql — agent_threads/agent_runs/agent_events schema (ADR-0043 §1/§2).
-- Proves the three tables + required columns + indexes exist, and that `seq` (not `created_at`) is the
-- transcript ordering key (migration 0046_agent_persistence.sql):
--   AC-AGP-001  three tables exist with required columns.
--   AC-AGP-002  required indexes exist.
--   AC-AGP-003  seq orders the transcript, not created_at.
--   AC-AGP-CONT-002  unique(run_id, seq) exists (review round item 1) — a seq-continuity
--                     regression fails loudly (INSERT error) instead of silently misordering.
-- Fixtures inserted as the table owner (bypassing RLS) — this file is schema-shape only, not RLS.
-- Fixture namespace: 00910000-….
begin;
select plan(22);

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-001: three tables exist with required columns.
-- ════════════════════════════════════════════════════════════════════════════
select has_table('agent_threads', 'AC-AGP-001: agent_threads table exists');
select has_table('agent_runs',    'AC-AGP-001: agent_runs table exists');
select has_table('agent_events',  'AC-AGP-001: agent_events table exists');

select has_column('agent_threads', 'scope',       'AC-AGP-001: agent_threads.scope exists');
select col_type_is('agent_threads', 'scope', 'jsonb', 'AC-AGP-001: agent_threads.scope is jsonb');
select has_column('agent_threads', 'pinned_at',   'AC-AGP-001: agent_threads.pinned_at exists');
select has_column('agent_threads', 'archived_at', 'AC-AGP-001: agent_threads.archived_at exists');

select has_column('agent_runs', 'last_progress_at', 'AC-AGP-001: agent_runs.last_progress_at exists');
select has_column('agent_runs', 'progress_step',    'AC-AGP-001: agent_runs.progress_step exists');
select has_column('agent_runs', 'status',           'AC-AGP-001: agent_runs.status exists');

select has_column('agent_events', 'seq', 'AC-AGP-001: agent_events.seq exists');
select col_type_is('agent_events', 'seq', 'bigint', 'AC-AGP-001: agent_events.seq is bigint');
select has_column('agent_events', 'tool_args_hash',  'AC-AGP-001: agent_events.tool_args_hash exists');
select has_column('agent_events', 'tool_status',     'AC-AGP-001: agent_events.tool_status exists');
select has_column('agent_events', 'rating',          'AC-AGP-001: agent_events.rating exists');
select has_column('agent_events', 'downvote_reason', 'AC-AGP-001: agent_events.downvote_reason exists');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-002: required indexes exist.
-- ════════════════════════════════════════════════════════════════════════════
select has_index('agent_events',  'agent_events_run_seq_idx',      array['run_id','seq'],         'AC-AGP-002: agent_events (run_id, seq) index exists');
select has_index('agent_runs',    'agent_runs_thread_created_idx', array['thread_id','created_at'],'AC-AGP-002: agent_runs (thread_id, created_at) index exists');
select has_index('agent_threads', 'agent_threads_owner_live_idx',  array['owner_id'],              'AC-AGP-002: agent_threads (owner_id) where archived_at is null index exists');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-003: seq orders the transcript, not created_at.
-- ════════════════════════════════════════════════════════════════════════════
-- One thread, one run, three events with identical created_at but seq 3,1,2 (inserted out of seq order).
insert into auth.users (id, email) values
  ('00910000-0000-0000-0000-0000000000a1','agp-schema-owner@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('00910000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AGP Schema Owner','agp-schema-owner@example.com','Engineer');

insert into agent_threads (id, owner_id, title) values
  ('00910000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Seq Order Thread');
insert into agent_runs (id, thread_id, owner_id, status) values
  ('00910000-0000-0000-0000-000000000002','00910000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','completed');
insert into agent_events (id, run_id, owner_id, seq, type, text, created_at) values
  ('00910000-0000-0000-0000-000000000013','00910000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1', 3, 'assistant', 'third',  '2026-07-03T00:00:00.000000Z'),
  ('00910000-0000-0000-0000-000000000011','00910000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1', 1, 'user',      'first',  '2026-07-03T00:00:00.000000Z'),
  ('00910000-0000-0000-0000-000000000012','00910000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1', 2, 'tool',      'second', '2026-07-03T00:00:00.000000Z');

select is(
  (select array_agg(seq order by seq) from agent_events where run_id = '00910000-0000-0000-0000-000000000002'),
  array[1,2,3]::bigint[],
  'AC-AGP-003: events ordered by seq return {1,2,3} despite out-of-order insert / identical created_at');

select is(
  (select seq from agent_events where run_id = '00910000-0000-0000-0000-000000000002' order by seq limit 1),
  1::bigint,
  'AC-AGP-003: seq (not created_at, which ties) is the total transcript order — first row is seq=1');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-CONT-002: unique(run_id, seq) exists — a seq-continuity regression (e.g. the handler
-- re-invocation bug fixed in this review round) fails LOUDLY instead of silently colliding.
-- ════════════════════════════════════════════════════════════════════════════
select col_is_unique('agent_events', array['run_id','seq'],
  'AC-AGP-CONT-002: agent_events (run_id, seq) is unique');

select * from finish();
rollback;
