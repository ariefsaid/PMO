-- 0170_automation_cap_race.sql — FR-HRD-041.
-- 0059's trigger counted active automations with no lock, so two concurrent inserts for the same
-- owner could both observe a count below the cap and both succeed. 0059's own comment names this:
-- "count-then-insert trigger is not serialization-proof ... row-lock the owner's profile row here if
-- an exact cap ever matters."
--
-- Fix: take a ROW lock on the owner's profiles row before counting. Per-owner, not the table-wide
-- SHARE ROW EXCLUSIVE of the 0065 exemplar -- this runs on every automation INSERT, and a table lock
-- there would serialize unrelated owners' writes for no benefit.
--
-- SECURITY DEFINER is required, not cosmetic: profiles carries RLS, and a non-definer trigger could
-- find zero rows for a legitimate owner, take NO lock, and silently reinstate the race. The explicit
-- NOT FOUND check turns that failure mode into an error instead of a silent no-op.
--
-- READ COMMITTED-specific: the fix relies on Postgres's default isolation level re-evaluating the
-- count() against the newly-committed/locked state once the row lock is acquired (a REPEATABLE READ
-- or SERIALIZABLE session would see a snapshot taken before the lock and would need a different
-- treatment). Supabase's default session isolation is READ COMMITTED, which this fix assumes.
--
-- PROOF: supabase/tests/0163_automation_cap_race.test.sql drives a genuine second session via
-- dblink (available on this stack — `create extension if not exists dblink` succeeds locally, and
-- 0151_timesheet_fence_concurrency.test.sql already exercises this exact pattern) that holds the
-- owner's profiles row FOR UPDATE in an open transaction, then asserts a concurrent automation
-- INSERT blocks and times out (55P03) rather than sailing through — the actual race this migration
-- closes, not just the lock's presence.
--
-- SECURITY (security-auditor MEDIUM-1, 2026-07-28): making this trigger SECURITY DEFINER (above) runs
-- it as `postgres`, which has rolbypassrls — so the body bypasses agent_automations' AND profiles'
-- FORCE RLS. For INSERT, Postgres runs BEFORE ROW triggers BEFORE the RLS WITH CHECK is evaluated, so
-- an attacker-chosen `owner_id` reaches this body before agent_automations_insert's
-- `owner_id = auth.uid()` policy would have rejected it — turning the trigger into a cross-org
-- existence oracle (23503 "unknown owner" vs P0001 "at cap" vs the eventual RLS 42501 distinguish
-- three states for an owner_id the caller does not own). The invoker-mode trigger this replaces could
-- not do this (RLS was in force for its own reads). Guard explicitly rather than rely on the RLS
-- policy firing after: `auth.uid() is null` is let through for service_role / pg_cron (which have no
-- JWT and are trusted callers).
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback = re-apply 0059's function body.

create or replace function enforce_automation_owner_cap()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if auth.uid() is not null and new.owner_id <> auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select id into v_owner from public.profiles where id = new.owner_id for update;
  if v_owner is null then
    raise exception 'unknown automation owner' using errcode = '23503';
  end if;

  if (select count(*) from public.agent_automations
        where owner_id = new.owner_id and archived_at is null) >= 25 then
    raise exception 'automation limit reached (25 active per owner)' using errcode = 'P0001';
  end if;
  return new;
end; $$;

revoke all on function public.enforce_automation_owner_cap() from public;

-- Supporting index: the count() above (now inside the row lock, on every automation INSERT) was a
-- seq scan; this predicate also backs the owner-only RLS SELECT policy on agent_automations.
create index if not exists agent_automations_owner_active_idx
  on public.agent_automations (owner_id) where archived_at is null;
