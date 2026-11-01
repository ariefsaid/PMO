-- Restore the preceding read projection.
create or replace function public.budget_activation_mode(version_id uuid)
  returns text language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_drafter uuid; v_count integer;
begin
  select org_id, created_by into v_org, v_drafter from public.budget_versions where id = version_id;
  if not found or v_org is distinct from public.auth_org_id() or not public.is_active_member() then
    return 'blocked';
  end if;
  if auth_role() not in ('Admin','Executive','Project Manager','Finance') then return 'blocked'; end if;
  if (select org_id from public.projects where id = (select project_id from public.budget_versions where id=version_id))
      is distinct from public.auth_org_id() then return 'blocked'; end if;
  if exists (select 1 from public.budget_version_editors e where e.budget_version_id=version_id and e.user_id=auth.uid())
     or v_drafter=auth.uid() then
    select count(*) into v_count from public.profiles p
      where p.org_id = v_org and public.is_active_member(p.id);
    if v_count=1 and exists (select 1 from public.profiles p
                              where p.id = auth.uid() and p.org_id = v_org
                                and public.is_active_member(p.id)) then
      return 'sole_operator';
    end if;
    return 'blocked_editor';
  end if;
  if v_drafter is null and auth_role() not in ('Admin','Finance') then return 'blocked_no_drafter'; end if;
  return 'allowed';
end; $$;
revoke all on function public.budget_activation_mode(uuid) from public, anon;
grant execute on function public.budget_activation_mode(uuid) to authenticated;

drop function if exists public.project_win_eligibility(uuid);
drop function if exists public.procurement_amount_eligibility(uuid,numeric);
drop function if exists public.work_order_issue_eligibility(uuid[]);
