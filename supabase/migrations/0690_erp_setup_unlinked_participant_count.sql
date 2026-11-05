-- ERP setup readiness counts, in the database, the active members with recorded time who have no confirmed ERP employee link.
-- Replaces reading every positive time entry into the edge function to build the distinct set.
-- Rollback: supabase/migrations/rollback/0690_erp_setup_unlinked_participant_count_down.sql
create function public.erp_setup_unlinked_participant_count(p_org_id uuid)
returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return (
    select count(*)::int from public.profiles p
     where p.org_id = p_org_id and p.status = 'active'
       and exists (
         select 1 from public.timesheets t
           join public.timesheet_entries e on e.timesheet_id = t.id and e.org_id = p_org_id
          where t.user_id = p.id and t.org_id = p_org_id and e.hours > 0)
       and not exists (
         select 1 from public.erp_employees ee
          where ee.org_id = p_org_id and ee.profile_id = p.id and ee.link_state = 'confirmed'));
end $$;
revoke all on function public.erp_setup_unlinked_participant_count(uuid) from public, anon, authenticated;
grant execute on function public.erp_setup_unlinked_participant_count(uuid) to service_role;
