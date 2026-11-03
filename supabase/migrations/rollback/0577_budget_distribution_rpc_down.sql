-- Reverse 0577 only when no whole-project version or saved distribution would be stranded.
do $$
begin
  if exists (select 1 from public.budget_versions where budget_mode = 'whole_project')
     or exists (select 1 from public.budget_distribution_plans)
     or exists (select 1 from public.budget_year_distributions) then
    raise exception 'rollback refused: whole-project budget data must be removed or migrated first'
      using errcode = 'P0001';
  end if;
end;
$$;

drop function if exists public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb,jsonb);
drop function if exists public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb);
drop function public.budget_distribution_gaps(uuid);

-- Restore the 0180 clone definition; all remaining versions are per_year by the guard above.
create or replace function public.clone_budget_version(version_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $function$
declare v_project uuid; v_org uuid; v_next int; v_new uuid;
begin
  perform public.assert_is_active_member();
  select project_id, org_id into v_project, v_org from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  select coalesce(max(version),0)+1 into v_next from budget_versions where project_id = v_project;
  insert into budget_versions (org_id, project_id, version, name, status)
    select v_org, v_project, v_next, name || ' (copy)', 'Draft'
    from budget_versions where id = version_id
    returning id into v_new;
  insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year)
    select v_org, v_new, category, description, budgeted_amount, 0, fiscal_year
    from budget_line_items where budget_version_id = version_id;
  return v_new;
end; $function$;
revoke all on function public.clone_budget_version(uuid) from public, anon;
grant execute on function public.clone_budget_version(uuid) to authenticated;

-- Restore the exact 0366 activation behavior; no whole-project version remains.
create or replace function public.activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $function$
declare v_project uuid; v_org uuid; v_status budget_status; v_drafter uuid; v_sole_operator boolean := false;
begin
  select project_id, org_id, status, created_by into v_project, v_org, v_status, v_drafter
    from budget_versions where id = version_id
    for update;
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
      from public.profiles p where p.org_id = v_org and public.is_active_member(p.id);
    if not coalesce(v_sole_operator,false) then
      raise exception 'separation of duties: You edited this version, so someone else must activate it.'
        using errcode = '42501';
    end if;
  end if;
  if v_drafter is not null and v_drafter = auth.uid() and not v_sole_operator then
    select count(*)=1 and bool_or(p.id=auth.uid()) into v_sole_operator
      from public.profiles p where p.org_id = v_org and public.is_active_member(p.id);
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
end; $function$;
revoke all on function public.activate_budget_version(uuid) from public, anon;
grant execute on function public.activate_budget_version(uuid) to authenticated;
