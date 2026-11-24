-- 2282: bounded project progress whose measured quantity exceeds confirmed client acceptance.
-- Batches assessment and latest confirmed acceptance quantities; it creates no claim or allocation.
-- Reverse: rollback/2282_billing_unaccepted_progress_down.sql.
begin;
create function public.billing_unaccepted_progress(p_project uuid default null)
  returns table (
    project_id uuid, project_name text, boq_item_id uuid, item_code text, description text,
    unit text, quantity text, today date)
  language sql stable security invoker set search_path = public as $$
  with tz as (
    select coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC') as name
  ), local_period as (
    select public.org_current_month(tz.name, now()) as month,
           (now() at time zone tz.name)::date as today
      from tz
  ), projects_in_scope as (
    select p.id, p.name
      from public.projects p
     where p.org_id = public.auth_org_id()
       and public.is_active_member()
       and public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance')
       and p.archived_at is null
       and (p_project is null or p.id = p_project)
  ), latest_progress as (
    select distinct on (e.project_id) e.project_id, e.id
      from public.project_progress_entries e
      join projects_in_scope p on p.id = e.project_id
      cross join local_period lp
     where e.month <= lp.month
     order by e.project_id, e.month desc
  ), assessed as (
    select lp.project_id, q.boq_item_id, q.quantity_to_date
      from latest_progress lp
      join public.progress_assessment_quantities q on q.entry_id = lp.id
  ), latest_acceptance as (
    select distinct on (a.work_order_id) a.work_order_id, a.id
      from public.work_order_acceptances a
      join projects_in_scope p on p.id = a.project_id
     where a.status = 'Confirmed'
     order by a.work_order_id, a.confirmed_at desc, a.id desc
  ), allocations as (
    select wo.project_id, wl.boq_item_id, al.quantity
      from projects_in_scope p
      join public.work_orders wo on wo.project_id = p.id
      join public.work_order_lines wl on wl.work_order_id = wo.id
        and wl.org_id = public.auth_org_id()
      left join latest_acceptance la on la.work_order_id = wo.id
      left join public.work_order_acceptance_lines al
        on al.acceptance_id = la.id and al.boq_item_id = wl.boq_item_id
     where wo.status <> 'Cancelled'
  ), accepted as (
    select project_id, boq_item_id, sum(quantity) as quantity
      from allocations
     where quantity is not null
     group by project_id, boq_item_id
  )
  select p.id,
         p.name,
         b.id,
         b.item_code,
         b.description,
         b.unit,
         (a.quantity_to_date - coalesce(ac.quantity, 0))::text,
         lp.today
    from assessed a
    join projects_in_scope p on p.id = a.project_id
    join public.boq_items b on b.id = a.boq_item_id
      and b.project_id = a.project_id and b.org_id = public.auth_org_id()
    left join accepted ac on ac.project_id = a.project_id and ac.boq_item_id = a.boq_item_id
    cross join local_period lp
   where a.quantity_to_date > coalesce(ac.quantity, 0)
   order by (a.quantity_to_date - coalesce(ac.quantity, 0)) desc,
            p.name, b.line_no nulls last, b.created_at, b.id
   limit 501
$$;
revoke all on function public.billing_unaccepted_progress(uuid) from public, anon;
grant execute on function public.billing_unaccepted_progress(uuid) to authenticated, service_role;
commit;
