-- 0581_budget_draft_mode_switch.sql
-- Atomic mode changes for Draft budgets. Reverse: rollback/0581_budget_draft_mode_switch_down.sql.

create or replace function public.switch_budget_draft_mode(
  p_version uuid,
  p_target_mode text,
  p_expected_lines jsonb,
  p_assignments jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_initial_project uuid;
  v_initial_org uuid;
  v_project uuid;
  v_org uuid;
  v_project_org uuid;
  v_status public.budget_status;
  v_mode text;
  v_actor uuid := auth.uid();
  v_expected jsonb;
  v_actual jsonb;
  v_line_count integer;
  v_assignment_count integer;
  v_total_before numeric;
  v_total_after numeric;
begin
  if p_target_mode is null or p_target_mode not in ('whole_project','per_year') then
    raise exception 'target budget mode is invalid' using errcode = 'P0001';
  end if;
  if p_expected_lines is null or jsonb_typeof(p_expected_lines) is distinct from 'array'
     or p_assignments is null or jsonb_typeof(p_assignments) is distinct from 'array' then
    raise exception 'budget mode witnesses must be arrays' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_expected_lines) as item(value)
     where jsonb_typeof(item.value) is distinct from 'object'
        or jsonb_typeof(item.value -> 'id') is distinct from 'string'
        or jsonb_typeof(item.value -> 'category') is distinct from 'string'
        or jsonb_typeof(item.value -> 'budgeted_amount') is distinct from 'string'
        or not (item.value ? 'fiscal_year')
        or (jsonb_typeof(item.value -> 'fiscal_year') is distinct from 'string'
            and jsonb_typeof(item.value -> 'fiscal_year') is distinct from 'null')
  ) then
    raise exception 'budget line witness has an invalid shape' using errcode = 'P0001';
  end if;

  select project_id, org_id
    into v_initial_project, v_initial_org
    from public.budget_versions
   where id = p_version;
  if not found or v_initial_project is null then
    raise exception 'budget version not found' using errcode = 'P0002';
  end if;
  if v_initial_org is distinct from public.auth_org_id()
     or public.auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select org_id into v_project_org
    from public.projects
   where id = v_initial_project;
  if not found or v_project_org is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Keep the established project -> version ordering used by budget distribution writes.
  perform 1
    from public.projects
   where id = v_initial_project
     and org_id = public.auth_org_id()
   for update;
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select project_id, org_id, status, budget_mode
    into v_project, v_org, v_status, v_mode
    from public.budget_versions
   where id = p_version
   for update;
  if not found or v_project is null then
    raise exception 'budget version not found' using errcode = 'P0002';
  end if;
  if v_project is distinct from v_initial_project then
    raise exception 'budget version project changed while changing mode' using errcode = 'P0001';
  end if;
  if v_org is distinct from public.auth_org_id()
     or v_project_org is distinct from public.auth_org_id()
     or public.auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_status is distinct from 'Draft' then
    raise exception 'only a Draft budget can change mode' using errcode = 'P0001';
  end if;
  if v_mode is not distinct from p_target_mode then
    raise exception 'budget is already in the requested mode' using errcode = 'P0001';
  end if;

  -- Serialize against source-line mutations and freeze the source witness before applying changes.
  perform 1
    from public.budget_line_items
   where budget_version_id = p_version
   order by id
   for update;
  select count(*)::integer, coalesce(sum(budgeted_amount), 0)::numeric
    into v_line_count, v_total_before
    from public.budget_line_items
   where budget_version_id = p_version;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           'category', category::text,
           'budgeted_amount', budgeted_amount::text,
           'fiscal_year', fiscal_year
         ) order by id), '[]'::jsonb)
    into v_actual
    from public.budget_line_items
   where budget_version_id = p_version;
  select coalesce(jsonb_agg(item.value order by item.value ->> 'id'), '[]'::jsonb)
    into v_expected
    from jsonb_array_elements(p_expected_lines) as item(value);
  if v_actual is distinct from v_expected
     or (select count(*) from jsonb_array_elements(p_expected_lines)) <>
        (select count(distinct item.value ->> 'id') from jsonb_array_elements(p_expected_lines) as item(value)) then
    raise exception 'budget lines changed; refresh and review the mode change again' using errcode = '40001';
  end if;

  select count(*)::integer into v_assignment_count
    from jsonb_array_elements(p_assignments);
  if p_target_mode = 'whole_project' then
    if v_assignment_count <> 0 then
      raise exception 'whole-project mode does not accept fiscal-year assignments' using errcode = 'P0001';
    end if;
    -- Clear source phases first so assert_budget_mode_immutable can verify the invariant.
    update public.budget_line_items
       set fiscal_year = null
     where budget_version_id = p_version
       and fiscal_year is not null;
    update public.budget_versions
       set budget_mode = 'whole_project'
     where id = p_version;
  else
    if v_assignment_count <> v_line_count then
      raise exception 'every budget line needs an explicit fiscal-year assignment' using errcode = 'P0001';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_assignments) as item(value)
       where jsonb_typeof(item.value) is distinct from 'object'
          or jsonb_typeof(item.value -> 'id') is distinct from 'string'
          or jsonb_typeof(item.value -> 'fiscal_year') is distinct from 'string'
          or btrim(item.value ->> 'fiscal_year') = ''
    ) or exists (
      select 1
        from jsonb_array_elements(p_assignments) as item(value)
       group by item.value ->> 'id'
      having count(*) > 1
    ) or exists (
      select 1
        from jsonb_array_elements(p_assignments) as item(value)
        left join public.budget_line_items li
          on li.id::text = item.value ->> 'id'
         and li.budget_version_id = p_version
       where li.id is null
    ) then
      raise exception 'fiscal-year assignments must name every line exactly once' using errcode = 'P0001';
    end if;
    update public.budget_versions
       set budget_mode = 'per_year'
     where id = p_version;
    update public.budget_line_items li
       set fiscal_year = assignment.value ->> 'fiscal_year'
      from jsonb_array_elements(p_assignments) as assignment(value)
     where li.id::text = assignment.value ->> 'id'
       and li.budget_version_id = p_version;
  end if;

  -- Mode-specific allocations cannot be carried across the boundary; amounts on source lines stay put.
  delete from public.budget_year_distributions where budget_version_id = p_version;
  delete from public.budget_distribution_plans where budget_version_id = p_version;

  select coalesce(sum(budgeted_amount), 0)::numeric
    into v_total_after
    from public.budget_line_items
   where budget_version_id = p_version;
  if v_total_after is distinct from v_total_before then
    raise exception 'budget line totals changed during mode switch' using errcode = 'P0001';
  end if;

  insert into public.budget_version_editors (org_id, budget_version_id, user_id)
  values (v_org, p_version, v_actor)
  on conflict (budget_version_id, user_id) do nothing;
end;
$$;

revoke all on function public.switch_budget_draft_mode(uuid,text,jsonb,jsonb) from public, anon;
grant execute on function public.switch_budget_draft_mode(uuid,text,jsonb,jsonb) to authenticated;

comment on function public.switch_budget_draft_mode(uuid,text,jsonb,jsonb) is
  'Atomically changes the mode of a Draft budget after matching an exact line witness; preserves source amounts and stamps the editor for activation SoD.';
