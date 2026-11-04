-- 0586_pullback_keeps_system_dated.sql — system pull-backs must not look like person redates.
-- 0585 reuses stage_entries_pull_back when an editor backdates a later stage. Keep its person-date guard
-- while leaving redated_at reserved for person-dated entries.
-- Rollback: supabase/migrations/rollback/0586_pullback_keeps_system_dated_down.sql.

create or replace function public.stage_entries_pull_back(p_project_id uuid, p_before numeric, p_on date)
  returns void language plpgsql security definer set search_path = public as $$
begin
  -- Signed always equals the contract date (FR-PSH-004), so a win is never moved by a later, earlier-dated entry.
  if exists (select 1 from public.project_stage_entries e
              where e.project_id = p_project_id and e.position < p_before and e.entered_on > p_on
                and e.stage = 'Won, Pending KoM') then                                      -- mut:pullback_signed
    raise exception 'the contract date is after %; correct it first', p_on using errcode = '23514';
  end if;
  if exists (select 1 from public.project_stage_entries e
              where e.project_id = p_project_id and e.position < p_before and e.entered_on > p_on
                and (e.redated_at is not null or e.source in ('added','import'))) then   -- mut:pullback_person
    raise exception 'an earlier stage date set by a person is after %; change that stage date first', p_on
      using errcode = '23514';
  end if;
  update public.project_stage_entries e set entered_on = p_on
   where e.project_id = p_project_id and e.position < p_before and e.entered_on > p_on;
end; $$;
revoke all on function public.stage_entries_pull_back(uuid, numeric, date) from public, anon, authenticated, service_role;
