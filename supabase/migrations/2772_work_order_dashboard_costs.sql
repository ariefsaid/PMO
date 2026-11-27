-- #2826: direct cost and budget for the work-order board, in one response.
create function public.work_order_dashboard_costs(p_project_ids uuid[])
returns jsonb
language plpgsql stable security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if public.actor_is_light() or not public.is_active_member()
     or coalesce(public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager'), true) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return (
    with orders as materialized (
      select w.id, w.project_id, w.currency
        from public.work_orders w
       where w.org_id = public.auth_org_id() and w.project_id = any(p_project_ids)
    ), projects as (
      select distinct project_id from orders
    ), costs as materialized (
      select p.project_id, c.work_order_id, c.currency, c.amount
        from projects p
        cross join lateral public.work_order_cost_amounts(p.project_id) c
       where c.reason in ('counted', 'unresolved-direct') and c.work_order_id is not null
    ), direct as (
      select w.id,
             case when count(c.amount) = count(*) then sum(c.amount::numeric) end as amount
        from orders w
        join costs c on c.project_id = w.project_id and c.work_order_id = w.id and c.currency = w.currency
       group by w.id
    ), plan as (
      select w.id, sum(l.value) as amount
        from orders w
        join public.work_order_plan_lines l on l.project_id = w.project_id and l.work_order_id = w.id
       where l.kind = 'direct_budget'
       group by w.id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'workOrderId', w.id,
      'currency', w.currency,
      'direct', case when d.id is null then '0.00' else round(d.amount, 2)::text end,
      'plan', round(p.amount, 2)::text
    )), '[]'::jsonb)
      from orders w
      left join direct d on d.id = w.id
      left join plan p on p.id = w.id
  );
end
$$;

revoke all on function public.work_order_dashboard_costs(uuid[]) from public, anon;
grant execute on function public.work_order_dashboard_costs(uuid[]) to authenticated;
