-- 0296_budget_sole_operator_activation.sql — OD-BUDGET-6 sole-operator exception.
-- Reversal: rollback/0296_budget_sole_operator_activation_down.sql.
alter table public.budget_versions
  add column activation_basis text check (activation_basis in ('standard','sole_operator'));
revoke insert (activation_basis), update (activation_basis) on public.budget_versions from authenticated, anon;

create or replace function public.budget_activation_mode(version_id uuid)
  returns text language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_drafter uuid; v_mode text; v_count integer;
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
    select count(*) into v_count from public.profiles p join auth.users u on u.id=p.id
      where p.org_id=v_org and p.status='active' and (u.banned_until is null or u.banned_until <= now());
    if v_count=1 and exists (select 1 from public.profiles p join auth.users u on u.id=p.id
                              where p.id=auth.uid() and p.org_id=v_org and p.status='active'
                                and (u.banned_until is null or u.banned_until <= now())) then
      return 'sole_operator';
    end if;
    return 'blocked_editor';
  end if;
  if v_drafter is null and auth_role() not in ('Admin','Finance') then return 'blocked_no_drafter'; end if;
  return 'allowed';
end; $$;
revoke all on function public.budget_activation_mode(uuid) from public, anon;
grant execute on function public.budget_activation_mode(uuid) to authenticated;

create or replace function public.activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status; v_drafter uuid; v_sole_operator boolean := false;
begin
  select project_id, org_id, status, created_by into v_project, v_org, v_status, v_drafter
    from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if exists (select 1 from public.budget_version_editors e
             where e.budget_version_id = version_id and e.user_id = auth.uid()) then
    select count(*)=1 and bool_or(p.id=auth.uid()) into v_sole_operator
      from public.profiles p join auth.users u on u.id=p.id where p.org_id=v_org and p.status='active'
        and (u.banned_until is null or u.banned_until <= now());
    if not coalesce(v_sole_operator,false) then
      raise exception 'separation of duties: You edited this version, so someone else must activate it.'
        using errcode = '42501';
    end if;
  end if;
  if v_drafter is not null and v_drafter = auth.uid() and not v_sole_operator then
    select count(*)=1 and bool_or(p.id=auth.uid()) into v_sole_operator
      from public.profiles p join auth.users u on u.id=p.id where p.org_id=v_org and p.status='active'
        and (u.banned_until is null or u.banned_until <= now());
    if not coalesce(v_sole_operator,false) then
      raise exception 'separation of duties: the person who drafted a budget version cannot activate it'
        using errcode = '42501';
    end if;
  end if;
  if v_drafter is null and auth_role() not in ('Admin','Finance') then
    raise exception 'a budget version with no recorded drafter can be activated by Admin or Finance only'
      using errcode = '42501';
  end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode = 'P0001'; end if;
  update budget_versions set status = 'Archived'
    where project_id = v_project and status = 'Active';
  update budget_versions set status = 'Active', activated_at = now(),
    activation_basis = case when v_sole_operator then 'sole_operator' else 'standard' end where id = version_id;
end; $$;

revoke all on function public.activate_budget_version(uuid) from public, anon;
grant execute on function public.activate_budget_version(uuid) to authenticated;
