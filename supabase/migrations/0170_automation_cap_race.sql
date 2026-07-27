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
-- HONESTY NOTE (see supabase/tests/0163_automation_cap_race.test.sql): this closes the observed
-- window under a single-session serialized workload and proves the lock + security-definer posture
-- are present. It does NOT have a two-session pgTAP proof that the race is closed under true
-- concurrency -- this stack has no dblink/pg_background to drive two genuinely concurrent sessions
-- from one test. 0059 already treats the cap as a soft limit, which is why this gap is accepted.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback = re-apply 0059's function body.

create or replace function enforce_automation_owner_cap()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
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
