-- 0221_automation_cap_on_unarchive.sql — the 25-active-automations-per-owner cap also applies when an
-- archived automation is brought back.
--
-- The cap (0059, race-hardened in 0170) ran BEFORE INSERT only, so an owner could archive, create new
-- ones, then un-archive the old ones (owners may UPDATE their own rows) and exceed 25 active. The same
-- function now also runs BEFORE UPDATE OF archived_at, and enforces the cap only on an un-archive
-- (archived_at going from a value to NULL); every other update passes straight through.
-- Proof: supabase/tests/0111_agent_automation_bounds.test.sql (AUDIT-M1 cases 6-8).
--
-- Rollback: drop trigger if exists agent_automations_owner_cap_unarchive on public.agent_automations;
--           then re-run the function body from 0170_automation_cap_race.sql.

create or replace function enforce_automation_owner_cap()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  -- On UPDATE, only an un-archive can add an active automation; anything else is not the cap's business.
  if tg_op = 'UPDATE' and not (old.archived_at is not null and new.archived_at is null) then
    return new;
  end if;

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

drop trigger if exists agent_automations_owner_cap_unarchive on public.agent_automations;
create trigger agent_automations_owner_cap_unarchive
  before update of archived_at on public.agent_automations
  for each row execute function enforce_automation_owner_cap();
