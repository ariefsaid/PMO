-- Rollback 0298_budget_sole_operator_activation.sql.
drop function if exists public.budget_activation_mode(uuid);
revoke all on function public.activate_budget_version(uuid) from public, anon;
create or replace function public.activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status; v_drafter uuid;
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
    raise exception 'separation of duties: You edited this version, so someone else must activate it.'
      using errcode = '42501';
  end if;
  if v_drafter is not null and v_drafter = auth.uid() then
    raise exception 'separation of duties: the person who drafted a budget version cannot activate it'
      using errcode = '42501';
  end if;
  if v_drafter is null and auth_role() not in ('Admin','Finance') then
    raise exception 'a budget version with no recorded drafter can be activated by Admin or Finance only'
      using errcode = '42501';
  end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode = 'P0001'; end if;
  update budget_versions set status = 'Archived'
    where project_id = v_project and status = 'Active';
  update budget_versions set status = 'Active', activated_at = now() where id = version_id;
end; $$;
revoke all on function public.activate_budget_version(uuid) from public, anon;
grant execute on function public.activate_budget_version(uuid) to authenticated;
-- Undo the change-history registry classification BEFORE the column drop.
update public.record_history_config
   set captured = captured - 'activation_basis'
 where entity_type = 'budget_version';

alter table public.budget_versions drop column activation_basis;
