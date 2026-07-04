-- 0049_agent_transcript_append_only.sql — close the append-only violation on the agent transcript +
-- mint-audit trail (gpt-5.5 cross-family audit finding #6, HIGH).
--
-- THE BUG (0046_agent_persistence.sql): agent_events/agent_runs/agent_threads each shipped an owner
-- DELETE policy, AND agent_runs.thread_id / agent_events.run_id are `on delete cascade`. So an owner
-- deleting a thread cascade-nuked its runs AND its events — including the type='system' automation
-- MINT-AUDIT events written by auditMint (ADR-0044 §3, AC-AAN-017/019). An audit trail an actor can
-- destroy is not an audit trail. The 0046 append-only story only covered UPDATE (the feedback trigger);
-- DELETE was left wide open, both directly and via cascade.
--
-- THE FIX (append-only + soft-archive retirement, aligned with ADR-0018 soft-archive-over-hard-delete):
--   1. DROP the owner DELETE policy on agent_events — transcript/audit events are IMMUTABLE and
--      un-deletable under RLS (the feedback UPDATE remains the ONLY owner mutation).
--   2. DROP the owner DELETE policy on agent_runs — a run carries its audit events; hard-deleting it
--      would cascade-nuke them. No owner hard-delete of runs.
--   3. DROP the owner DELETE policy on agent_threads — a thread's cascade reaches runs → events.
--      Retirement is SOFT-ARCHIVE (archived_at, already supported by agent_threads_update); there is
--      no owner hard-delete path, so the cascade-delete vector is closed entirely.
--
-- After this migration none of the three tables has a DELETE policy; with FORCE RLS enabled, a DELETE
-- by any JWT role affects zero rows (default-deny). Operational hard-delete for retention/GDPR remains
-- available to the table owner / service_role (which bypasses RLS) — a deliberate, audited admin action,
-- never an in-band user affordance.
--
-- notifications_delete is DELIBERATELY RETAINED (Director decision): a notification is an ephemeral
-- inbox item, not an audit record, and an owner clearing their own inbox is an expected, defensible
-- affordance (FR-AAN-008). It carries no immutable-trail obligation, so its DELETE policy stays.
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback re-creates the three
-- dropped policies verbatim from 0046 (owner + org match):
--   create policy agent_events_delete  on agent_events  for delete using (owner_id = auth.uid() and org_id = auth_org_id());
--   create policy agent_runs_delete    on agent_runs    for delete using (owner_id = auth.uid() and org_id = auth_org_id());
--   create policy agent_threads_delete on agent_threads for delete using (owner_id = auth.uid() and org_id = auth_org_id());

drop policy if exists agent_events_delete  on agent_events;
drop policy if exists agent_runs_delete    on agent_runs;
drop policy if exists agent_threads_delete on agent_threads;

-- notifications_delete: intentionally NOT dropped (see header). Owner inbox-clear stays.
