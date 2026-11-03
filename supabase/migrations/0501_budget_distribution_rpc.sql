-- 0501_budget_distribution_rpc.sql
-- Atomic distribution persistence, clone preservation, activation validation and pre-range fence.
-- Reverse: rollback/0501_budget_distribution_rpc_down.sql.

create or replace function public.budget_distribution_gaps(p_version uuid)
returns setof text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with visible_version as (
    select v.id
      from public.budget_versions v
      join public.projects project on project.id = v.project_id
     where v.id = p_version
       and v.org_id = public.auth_org_id()
       and project.org_id = public.auth_org_id()
       and public.is_active_member()
  ),
  distribution_plan as (
    select p.budget_version_id, p.method, p.basis
      from public.budget_distribution_plans p
      join visible_version v on v.id = p.budget_version_id
     where p.budget_version_id = p_version
  ),
  basis_years as (
    select y.value ->> 'name' as fiscal_year, (y.ordinality - 1)::integer as ordinal
      from distribution_plan p
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(p.basis -> 'years') = 'array' then p.basis -> 'years' else '[]'::jsonb end
      ) with ordinality as y(value, ordinality)
     where nullif(y.value ->> 'name', '') is not null
  ),
  source_totals as (
    select li.category::text as category, sum(li.budgeted_amount)::numeric as amount_total
      from public.budget_line_items li
      join visible_version v on v.id = li.budget_version_id
     where li.budget_version_id = p_version
     group by li.category
  ),
  row_totals as (
    select d.category::text as category,
           count(*)::integer as row_count,
           count(distinct d.fiscal_year)::integer as year_count,
           sum(d.amount)::numeric as amount_total
      from public.budget_year_distributions d
      join visible_version v on v.id = d.budget_version_id
     where d.budget_version_id = p_version
     group by d.category
  ),
  invalid_rows as (
    select distinct d.category::text as category
      from public.budget_year_distributions d
      left join basis_years y
        on y.fiscal_year = d.fiscal_year and y.ordinal = d.ordinal
      left join distribution_plan p on p.budget_version_id = d.budget_version_id
     where d.budget_version_id = p_version
       and (y.fiscal_year is null or p.method is null or d.method is distinct from p.method)
  ),
  gaps as (
    select s.category
      from source_totals s
      left join row_totals r on r.category = s.category
      cross join (select count(*)::integer as year_count from basis_years) y
      left join distribution_plan p on true
     where p.budget_version_id is null
        or y.year_count = 0
        or coalesce(r.row_count, 0) <> y.year_count
        or coalesce(r.year_count, 0) <> y.year_count
        or coalesce(r.amount_total, 0) <> s.amount_total
    union
    select category from invalid_rows
    union
    select r.category
      from row_totals r
      left join source_totals s on s.category = r.category
     where s.category is null
    union
    select 'budget distribution'
     where not exists (select 1 from distribution_plan)
       and exists (select 1 from visible_version)
       and not exists (select 1 from source_totals)
  )
  select distinct category from gaps order by category;
$$;
revoke all on function public.budget_distribution_gaps(uuid) from public, anon;
grant execute on function public.budget_distribution_gaps(uuid) to authenticated;

create or replace function public.save_budget_distribution(
  p_version uuid,
  p_method text,
  p_inputs jsonb,
  p_basis jsonb,
  p_rows jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_org uuid;
  v_status public.budget_status;
  v_mode text;
  v_project_start date;
  v_project_end date;
  v_year jsonb;
  v_year_start date;
  v_year_end date;
  v_first_year_start date;
  v_first_year_end date;
  v_last_year_end date;
  v_previous_year_end date;
  v_year_name text;
  v_year_count integer := 0;
  v_row jsonb;
  v_category text;
  v_fiscal_year text;
  v_ordinal integer;
  v_expected_ordinal integer;
  v_amount numeric;
  v_expected_amount numeric;
  v_actual_amount numeric;
  v_row_count integer;
  v_distinct_year_count integer;
begin
  select project_id, org_id, status, budget_mode
    into v_project, v_org, v_status, v_mode
    from public.budget_versions
   where id = p_version
   for update;
  if v_project is null then
    raise exception 'budget version not found' using errcode = 'P0002';
  end if;
  if v_org is distinct from public.auth_org_id()
     or public.auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (select org_id from public.projects where id = v_project) is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_status is distinct from 'Draft' or v_mode is distinct from 'whole_project' then
    raise exception 'only a whole-project Draft can save a distribution' using errcode = 'P0001';
  end if;

  if p_method is null or p_method not in ('by_days','percent_by_year','amount_by_year') then
    raise exception 'budget distribution method is invalid' using errcode = 'P0001';
  end if;
  if p_inputs is null or jsonb_typeof(p_inputs) is distinct from 'object' then
    raise exception 'budget distribution inputs must be an object' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_each(p_inputs) as input(key, value) where jsonb_typeof(input.value) is distinct from 'string') then
    raise exception 'budget distribution inputs must contain text values' using errcode = 'P0001';
  end if;
  if p_basis is null or jsonb_typeof(p_basis) is distinct from 'object'
     or jsonb_typeof(p_basis -> 'years') is distinct from 'array' then
    raise exception 'budget distribution basis must include a fiscal-year array' using errcode = 'P0001';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'budget distribution rows must be an array' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_basis -> 'years') < 1 or jsonb_array_length(p_basis -> 'years') > 100 then
    raise exception 'budget distribution basis must contain between one and 100 fiscal years' using errcode = 'P0001';
  end if;

  if coalesce(p_basis ->> 'projectStart', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or (p_basis ->> 'projectEnd') is not null
        and (p_basis ->> 'projectEnd') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'budget distribution basis contains an invalid project date' using errcode = 'P0001';
  end if;
  begin
    v_project_start := (p_basis ->> 'projectStart')::date;
    v_project_end := case when p_basis ->> 'projectEnd' is null then null else (p_basis ->> 'projectEnd')::date end;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'budget distribution basis contains an invalid project date' using errcode = 'P0001';
  end;
  if to_char(v_project_start, 'YYYY-MM-DD') is distinct from p_basis ->> 'projectStart'
     or (v_project_end is not null and to_char(v_project_end, 'YYYY-MM-DD') is distinct from p_basis ->> 'projectEnd') then
    raise exception 'budget distribution basis contains an invalid project date' using errcode = 'P0001';
  end if;
  if v_project_end is not null and v_project_end < v_project_start then
    raise exception 'budget distribution basis has reversed project dates' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_basis -> 'years') as y(value)
     where jsonb_typeof(y.value) is distinct from 'object'
        or nullif(y.value ->> 'name', '') is null
        or coalesce(y.value ->> 'start', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or coalesce(y.value ->> 'end', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ) then
    raise exception 'budget distribution basis contains an invalid fiscal year' using errcode = 'P0001';
  end if;
  if exists (
    select y.value ->> 'name'
      from jsonb_array_elements(p_basis -> 'years') as y(value)
     group by y.value ->> 'name'
    having count(*) > 1
  ) then
    raise exception 'budget distribution basis repeats a fiscal year name' using errcode = 'P0001';
  end if;

  for v_year in select value from jsonb_array_elements(p_basis -> 'years') as years(value)
  loop
    v_year_name := v_year ->> 'name';
    begin
      v_year_start := (v_year ->> 'start')::date;
      v_year_end := (v_year ->> 'end')::date;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception 'budget distribution basis contains an invalid fiscal year' using errcode = 'P0001';
    end;
    if to_char(v_year_start, 'YYYY-MM-DD') is distinct from v_year ->> 'start'
       or to_char(v_year_end, 'YYYY-MM-DD') is distinct from v_year ->> 'end'
       or v_year_end < v_year_start then
      raise exception 'budget distribution basis contains an invalid fiscal year' using errcode = 'P0001';
    end if;
    if v_year_count = 0 then
      v_first_year_start := v_year_start;
      v_first_year_end := v_year_end;
    elsif v_year_start <> v_previous_year_end + 1 then
      raise exception 'budget distribution basis has overlapping or incomplete fiscal-year coverage' using errcode = 'P0001';
    end if;
    v_year_count := v_year_count + 1;
    v_previous_year_end := v_year_end;
    v_last_year_end := v_year_end;
  end loop;

  if v_project_start < v_first_year_start or v_project_start > v_first_year_end
     or (v_project_end is null and v_year_count <> 1)
     or (v_project_end is not null and (v_project_end < v_project_start or v_project_end > v_last_year_end)) then
    raise exception 'budget distribution basis does not cover the project dates' using errcode = 'P0001';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as rows(value)
  loop
    v_category := v_row ->> 'category';
    v_fiscal_year := v_row ->> 'fiscal_year';
    if jsonb_typeof(v_row) is distinct from 'object'
       or nullif(v_category, '') is null
       or nullif(v_fiscal_year, '') is null
       or coalesce(v_row ->> 'ordinal', '') !~ '^(0|[1-9][0-9]?)$'
       or jsonb_typeof(v_row -> 'amount') is distinct from 'string'
       or coalesce(v_row ->> 'amount', '') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$'
       or jsonb_typeof(v_row -> 'method') is distinct from 'string'
       or (v_row ->> 'method') is distinct from p_method
       or jsonb_typeof(v_row -> 'is_override') is distinct from 'boolean' then
      raise exception 'budget distribution row for category % is invalid', coalesce(v_category, '(unknown)')
        using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from pg_enum e
       where e.enumtypid = 'public.budget_category'::regtype
         and e.enumlabel = v_category
    ) then
      raise exception 'budget distribution row for category % is invalid', v_category using errcode = 'P0001';
    end if;
    v_amount := (v_row ->> 'amount')::numeric;
    if v_amount < 0 then
      raise exception 'budget distribution row for category % cannot be negative', v_category using errcode = 'P0001';
    end if;
    v_ordinal := (v_row ->> 'ordinal')::integer;
    select (year.value_ordinality - 1)::integer
      into v_expected_ordinal
      from jsonb_array_elements(p_basis -> 'years') with ordinality as year(value, value_ordinality)
     where year.value ->> 'name' = v_fiscal_year;
    if not found then
      raise exception 'budget distribution for % contains a year outside its basis', v_category using errcode = 'P0001';
    end if;
    if v_ordinal is distinct from v_expected_ordinal then
      raise exception 'budget distribution for % has an invalid year order', v_category using errcode = 'P0001';
    end if;
  end loop;

  select d.category into v_category
    from (
      select value ->> 'category' as category, value ->> 'fiscal_year' as fiscal_year
        from jsonb_array_elements(p_rows) as rows(value)
       group by value ->> 'category', value ->> 'fiscal_year'
      having count(*) > 1
    ) d
   order by d.category
   limit 1;
  if v_category is not null then
    raise exception 'budget distribution for % contains duplicate fiscal-year rows', v_category using errcode = 'P0001';
  end if;

  select distinct r.value ->> 'category' into v_category
    from jsonb_array_elements(p_rows) as r(value)
   where not exists (
     select 1 from public.budget_line_items li
      where li.budget_version_id = p_version
        and li.category::text = r.value ->> 'category'
   )
   order by r.value ->> 'category'
   limit 1;
  if v_category is not null then
    raise exception 'budget distribution has no source lines for category %', v_category using errcode = 'P0001';
  end if;

  for v_category in
    select distinct li.category::text
      from public.budget_line_items li
     where li.budget_version_id = p_version
     order by li.category::text
  loop
    select count(*)::integer,
           count(distinct r.value ->> 'fiscal_year')::integer,
           coalesce(sum((r.value ->> 'amount')::numeric), 0)::numeric
      into v_row_count, v_distinct_year_count, v_actual_amount
      from jsonb_array_elements(p_rows) as r(value)
     where r.value ->> 'category' = v_category;
    if v_row_count <> v_year_count or v_distinct_year_count <> v_year_count then
      raise exception 'budget distribution for % must include every basis year', v_category using errcode = 'P0001';
    end if;
    select coalesce(sum(li.budgeted_amount), 0)::numeric
      into v_expected_amount
      from public.budget_line_items li
     where li.budget_version_id = p_version
       and li.category::text = v_category;
    if v_actual_amount <> v_expected_amount then
      raise exception 'budget distribution for % must reconcile to its source lines', v_category using errcode = 'P0001';
    end if;
  end loop;

  delete from public.budget_year_distributions where budget_version_id = p_version;
  delete from public.budget_distribution_plans where budget_version_id = p_version;
  insert into public.budget_distribution_plans
    (org_id, budget_version_id, method, inputs, basis, updated_by, updated_at)
  values
    (v_org, p_version, p_method, p_inputs, p_basis, auth.uid(), now());

  insert into public.budget_year_distributions
    (org_id, budget_version_id, category, fiscal_year, ordinal, amount, method, is_override)
  select v_org, p_version,
         (item.value ->> 'category')::public.budget_category,
         item.value ->> 'fiscal_year',
         (item.value ->> 'ordinal')::integer,
         (item.value ->> 'amount')::numeric,
         p_method,
         (item.value ->> 'is_override')::boolean
    from jsonb_array_elements(p_rows) as item(value);

  insert into public.budget_version_editors (org_id, budget_version_id, user_id)
  values (v_org, p_version, auth.uid())
  on conflict (budget_version_id, user_id) do nothing;
end;
$$;
revoke all on function public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.clone_budget_version(version_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_next int; v_new uuid; v_mode text;
begin
  perform public.assert_is_active_member();
  select project_id, org_id, budget_mode into v_project, v_org, v_mode
    from public.budget_versions where id = version_id for update;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from public.auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if (select org_id from public.projects where id = v_project) is distinct from public.auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  select coalesce(max(version),0)+1 into v_next from public.budget_versions where project_id = v_project;
  insert into public.budget_versions (org_id, project_id, version, name, status, budget_mode)
    select v_org, v_project, v_next, name || ' (copy)', 'Draft', budget_mode
      from public.budget_versions where id = version_id
    returning id into v_new;
  insert into public.budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year)
    select v_org, v_new, category, description, budgeted_amount, 0, fiscal_year
      from public.budget_line_items where budget_version_id = version_id;

  if exists (select 1 from public.budget_distribution_plans where budget_version_id = version_id) then
    insert into public.budget_distribution_plans
      (org_id, budget_version_id, method, inputs, basis, updated_by, updated_at)
    select v_org, v_new, method, inputs, basis, auth.uid(), now()
      from public.budget_distribution_plans
     where budget_version_id = version_id;
    insert into public.budget_year_distributions
      (org_id, budget_version_id, category, fiscal_year, ordinal, amount, method, is_override)
    select v_org, v_new, category, fiscal_year, ordinal, amount, method, is_override
      from public.budget_year_distributions
     where budget_version_id = version_id;
  end if;
  return v_new;
end; $$;
revoke all on function public.clone_budget_version(uuid) from public, anon;
grant execute on function public.clone_budget_version(uuid) to authenticated;

create or replace function public.activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_org uuid;
  v_status budget_status;
  v_drafter uuid;
  v_sole_operator boolean := false;
  v_mode text;
  v_gap text;
begin
  select project_id, org_id, status, created_by, budget_mode
    into v_project, v_org, v_status, v_drafter, v_mode
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

comment on function public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb) is
  'Atomically replaces the approved whole-project distribution for a Draft and attributes the writer for SoD.';
comment on function public.budget_distribution_gaps(uuid) is
  'Returns the categories whose saved year rows do not exactly reconcile to source budget lines.';
