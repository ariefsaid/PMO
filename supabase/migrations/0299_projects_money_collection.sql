-- 0299_projects_money_collection.sql — one batched project-money read for the Projects collection.
-- Rollback: migrations/rollback/0299_projects_money_collection_down.sql.

create function public.get_projects_money_collection(p_project_ids uuid[])
returns table(project_id uuid, actuals jsonb, active_budget_amount text, active_budget_currency text, has_active_budget boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role := public.auth_role();
  v_project_id uuid;
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_ids is null or cardinality(p_project_ids) = 0 or cardinality(p_project_ids) > 500 then
    raise exception 'project selection is invalid' using errcode = '22023';
  end if;

  for v_project_id in
    select distinct requested.id
    from unnest(p_project_ids) requested(id)
    join public.projects p on p.id = requested.id and p.org_id = public.auth_org_id()
    order by requested.id
  loop
    return query
      select v_project_id,
             public.get_project_finances(v_project_id)->'actuals',
             case
               when not exists (
                 select 1 from public.budget_versions b
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
               ) then null
               when exists (
                 select 1 from public.budget_versions b
                 join public.budget_line_items li on li.budget_version_id = b.id and li.org_id = b.org_id
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
                   and (li.budgeted_amount is null or li.budgeted_amount::text in ('NaN','Infinity','-Infinity'))
               ) then null
               else coalesce((
                 select sum(li.budgeted_amount)
                 from public.budget_versions b
                 join public.budget_line_items li on li.budget_version_id = b.id and li.org_id = b.org_id
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
               ), 0::numeric)::text
             end,
             (select b.currency from public.budget_versions b
              where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
              order by b.version desc, b.created_at desc, b.id desc limit 1),
             exists (
               select 1 from public.budget_versions b
               where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
             );
  end loop;
end $$;

revoke all on function public.get_projects_money_collection(uuid[]) from public, anon, authenticated;
grant execute on function public.get_projects_money_collection(uuid[]) to authenticated;
