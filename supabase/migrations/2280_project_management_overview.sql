-- 2280: one org-scoped, batched milestone projection for the executive project portfolio.
-- The matching actual progress remains the existing get_projects_delivery read.
-- Reverse: rollback/2280_project_management_overview_down.sql.
begin;

create function public.project_management_overview(p_ids uuid[])
  returns table (
    project_id uuid,
    planned_pct numeric,
    done_count integer,
    late_count integer,
    total_count integer,
    today date
  )
  language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_role public.user_role := public.auth_role();
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin', 'Executive', 'Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  with scope as (
    select p.id, (now() at time zone coalesce(o.default_timezone, 'UTC'))::date as today
      from public.projects p
      join public.organizations o on o.id = p.org_id
     where p.org_id = v_org
       and p.id = any(coalesce(p_ids, '{}'::uuid[]))
       and p.archived_at is null
       and p.status::text = any(array['Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out']::text[])
  ), effective as (
    select m.id, m.project_id, m.target_date, m.weight, m.sort_order, s.today,
           count(t.id)::integer as task_count,
           coalesce(m.input_pct, count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0), 0)::numeric as effective_pct
      from public.project_milestones m
      join scope s on s.id = m.project_id
      left join public.tasks t
        on (t.milestone_id = m.id or exists (
              select 1 from public.task_groups g
               where g.id = t.task_group_id and g.milestone_id = m.id and g.archived_at is null
            ))
       and t.archived_at is null
       and not exists (
         select 1 from public.tasks child
          where child.parent_task_id = t.id and child.archived_at is null and child.tombstoned_at is null
       )
     group by m.id, s.today
  ), counts as (
    select s.id as project_id, s.today,
           count(e.id)::integer as total_count,
           count(e.id) filter (where e.effective_pct >= 100)::integer as done_count,
           count(e.id) filter (where e.target_date < s.today and e.effective_pct < 100)::integer as late_count
      from scope s
      left join effective e on e.project_id = s.id
     group by s.id, s.today
  ), weight_totals as (
    select e.project_id, sum(e.weight) as total_weight
      from effective e
     where e.weight > 0
     group by e.project_id
  ), dated as (
    select e.project_id, e.target_date, e.sort_order, e.id, wt.total_weight,
           row_number() over (partition by e.project_id order by e.target_date, e.sort_order, e.id)::integer as rn,
           sum(e.weight) over (partition by e.project_id order by e.target_date, e.sort_order, e.id rows between unbounded preceding and current row) as running_weight
      from effective e
      join weight_totals wt on wt.project_id = e.project_id
     where e.weight > 0 and e.target_date is not null
  ), points as (
    select d.project_id, d.rn, d.target_date, 100.0 * d.running_weight / nullif(d.total_weight, 0) as planned
      from dated d
    union all
    select d.project_id, 0::integer, d.target_date, 0::numeric
      from dated d
     where d.rn = 1
  ), plan_shape as (
    select p.project_id, max(s.today) as today, max(d.total_weight) as total_weight,
           min(p.target_date) as first_date, max(p.target_date) as last_date,
           max(p.planned) filter (where p.rn = d.rn) as last_planned
      from points p
      join dated d on d.project_id = p.project_id
     group by p.project_id
  ), planned as (
    select s.id as project_id,
           case
             when sh.total_weight is null or sh.total_weight = 0 then null::numeric
             when sh.today <= sh.first_date then 0::numeric
             when sh.today >= sh.last_date then sh.last_planned
             when next_point.target_date is null or previous_point.target_date is null then null::numeric
             when next_point.target_date = previous_point.target_date then next_point.planned
             else previous_point.planned
                    + (next_point.planned - previous_point.planned)
                      * ((sh.today - previous_point.target_date)::numeric
                         / nullif(next_point.target_date - previous_point.target_date, 0))
           end as planned_pct
      from scope s
      left join plan_shape sh on sh.project_id = s.id
      left join lateral (
        select p.rn, p.target_date, p.planned from points p
         where p.project_id = s.id and p.target_date >= s.today
         order by p.rn limit 1
      ) next_point on true
      left join lateral (
        select p.rn, p.target_date, p.planned from points p
         where p.project_id = s.id and p.rn = next_point.rn - 1
      ) previous_point on true
  )
  select c.project_id, p.planned_pct, c.done_count, c.late_count, c.total_count, c.today
    from counts c
    left join planned p on p.project_id = c.project_id
   order by c.project_id;
end;
$$;

comment on function public.project_management_overview(uuid[]) is
  '2280: batched, read-only milestone schedule/count projection for the management portfolio. Admin, Executive and Finance only; organization scope comes from the caller JWT.';
revoke all on function public.project_management_overview(uuid[]) from public, anon;
grant execute on function public.project_management_overview(uuid[]) to authenticated;

commit;
