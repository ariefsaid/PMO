-- 0059_agent_automation_bounds.sql
-- AUDIT-M1 (2026-07-04 seven-dimension audit, Adversarial MED-2) — automation cost-amplification
-- bounds. agent_automations.prompt was unbounded text, timeout_s was unbounded, and one owner
-- could accumulate unlimited active automations — each fired run bills model calls, so an insider
-- (or a compromised session) could amplify agent spend arbitrarily.
--
-- FIX (DB is the enforcement authority; the create_automation action's validate mirrors it as UX):
--   1. prompt length ≤ 4000 chars (generous for a task brief; blocks megabyte prompt bombs).
--   2. timeout_s in [10, 900] — default 120 stays; 900 caps the minted-JWT deputy window a single
--      automation run can hold (ADR-0044 §6 TTL work tracks separately).
--   3. Max 25 ACTIVE (non-archived) automations per owner, enforced by a BEFORE INSERT trigger.
--      ponytail: count-then-insert trigger is not serialization-proof under concurrent inserts —
--      it is a soft cap against amplification, not an exact invariant; row-lock the owner's
--      profile row here if an exact cap ever matters.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual rollback:
--   drop trigger agent_automations_owner_cap on agent_automations;
--   drop function enforce_automation_owner_cap();
--   alter table agent_automations drop constraint agent_automations_prompt_len;
--   alter table agent_automations drop constraint agent_automations_timeout_bounds;

alter table agent_automations
  add constraint agent_automations_prompt_len check (length(prompt) <= 4000);

alter table agent_automations
  add constraint agent_automations_timeout_bounds check (timeout_s between 10 and 900);

create or replace function enforce_automation_owner_cap()
  returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.agent_automations
        where owner_id = new.owner_id and archived_at is null) >= 25 then
    raise exception 'automation limit reached (25 active per owner)' using errcode = 'P0001';
  end if;
  return new;
end; $$;

create trigger agent_automations_owner_cap
  before insert on agent_automations
  for each row execute function enforce_automation_owner_cap();
