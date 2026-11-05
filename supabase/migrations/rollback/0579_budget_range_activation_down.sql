-- Refuse to remove the activation fence while any cancellation or range witness could be stranded.
do $$
begin
  if exists (select 1 from public.budget_archive_cancel_intents)
     or exists (select 1 from public.budget_archive_requests where queued_by_activation)
     or exists (select 1 from public.budget_versions where budget_mode='whole_project')
     or exists (select 1 from public.budget_version_account_erp_mirror where to_fiscal_year is not null)
     or exists (select 1 from public.budget_archive_cancel_intents where to_fiscal_year is not null)
     or exists (select 1 from public.external_command_outbox where budget_range_operation is not null
       or pmo_record_id ~* '^[0-9a-f-]{36}:r:')
     or exists (select 1 from public.external_refs where domain='budget' and pmo_record_id ~* '^[0-9a-f-]{36}:r:') then
    raise exception '0579 rollback refused: range or cancellation history would be stranded';
  end if;
end $$;

-- Restores the exact activation implementation from 0577.
create or replace function public.activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_initial_project uuid;
  v_initial_org uuid;
  v_project uuid;
  v_project_org uuid;
  v_org uuid;
  v_status budget_status;
  v_drafter uuid;
  v_sole_operator boolean := false;
  v_mode text;
  v_gap text;
begin
  -- Serialize project-level activation and keep the same project -> version lock order used by
  -- save/clone. A fresh version read after both locks rejects a stale project witness.
  select project_id, org_id into v_initial_project, v_initial_org from public.budget_versions where id = version_id;
  if not found or v_initial_project is null then
    raise exception 'budget version not found' using errcode = 'P0002';
  end if;
  if v_initial_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select org_id into v_project_org from public.projects where id = v_initial_project;
  if not found or v_project_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select org_id into v_project_org from public.projects where id = v_initial_project for update;
  if not found then raise exception 'not authorized' using errcode = '42501'; end if;
  select project_id, org_id, status, created_by, budget_mode
    into v_project, v_org, v_status, v_drafter, v_mode
    from public.budget_versions where id = version_id for update;
  if not found or v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_project is distinct from v_initial_project then
    raise exception 'budget version project changed while activating' using errcode = 'P0001';
  end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_project_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
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
  if v_mode = 'whole_project' then
    select gap into v_gap
      from public.budget_distribution_gaps(version_id) as gaps(gap)
     order by gap
     limit 1;
    if v_gap is not null then
      raise exception 'budget distribution is incomplete for category %', v_gap using errcode = 'P0001';
    end if;
    raise exception 'whole-project budget activation is unavailable until range dispatch and predecessor cancellation are installed'
      using errcode = 'P0001';
  end if;
  update budget_versions set status = 'Archived'
    where project_id = v_project and status = 'Active';
  update budget_versions set status = 'Active', activated_at = now(),
    activation_basis = case when v_sole_operator then 'sole_operator' else 'standard' end where id = version_id;
end; $$;
revoke all on function public.activate_budget_version(uuid) from public, anon;
grant execute on function public.activate_budget_version(uuid) to authenticated;

drop function public.queue_budget_archive_cancel(uuid,uuid,uuid);
alter table public.budget_archive_requests drop column queued_by_activation;
