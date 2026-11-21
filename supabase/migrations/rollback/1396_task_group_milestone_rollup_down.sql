-- Reverses 1396 (#2679): the 0145 and 1142 bodies, verbatim (task groups stop counting).

create or replace function get_project_milestones(p_project_id uuid)
  returns table (
    id uuid, project_id uuid, name text, sort_order integer, target_date date,
    weight numeric, input_pct numeric, task_count integer,
    calculated_pct numeric, effective_pct numeric
  )
  language sql stable security invoker set search_path = public as $$
  select m.id, m.project_id, m.name, m.sort_order, m.target_date, m.weight, m.input_pct,
         count(t.id)::int as task_count,
         (count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0)) as calculated_pct,
         coalesce(
           m.input_pct,
           count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
           0
         ) as effective_pct
    from project_milestones m
    left join tasks t on t.milestone_id = m.id
                     and t.parent_task_id is null   -- OD-INT-9: subtasks never move a percentage.
                     and t.archived_at is null      -- archived tasks never move a percentage.
   where m.project_id = p_project_id
   group by m.id
   order by m.sort_order, m.created_at;
$$;
revoke all     on function get_project_milestones(uuid) from public;
grant  execute on function get_project_milestones(uuid) to   authenticated;
revoke execute on function get_project_milestones(uuid) from anon;

create or replace function get_projects_delivery(p_ids uuid[])
  returns table (
    project_id    uuid,
    delivery_pct  numeric,
    committed_spend numeric,
    budget        numeric
  )
  language sql stable security invoker set search_path = public as $$
  with eff as (
    select
      m.project_id,
      m.weight,
      coalesce(
        m.input_pct,
        count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
        0
      ) as effective_pct,
      (m.input_pct is not null or count(t.id) > 0) as has_signal
    from project_milestones m
    left join tasks t on t.milestone_id = m.id
                     and t.parent_task_id is null   -- OD-INT-9: subtasks never move a percentage.
                     and t.archived_at is null      -- archived tasks never move a percentage.
    where m.project_id = any(p_ids)
    group by m.id
  ),
  -- The 0396 body selected the requested projects without an explicit org filter: under the caller's RLS that
  -- is the caller's org, and under service_role it is the requested set (the commitment figure stays NULL there,
  -- exactly as the per-project function returned). Keep that row set: rows are returned for EVERY requested
  -- project; only the commitment figure needs the four money roles, so that gate sits on its own CTE.
  proj as (
    select p.id, p.currency
      from public.projects p
     where p.id = any(p_ids)
  ),
  -- The per-project commitment position is exactly `sum(procurement_open_commitment)` over the project's
  -- committed-status purchases, in the project currency. 0723 already computes that CASE for many purchases
  -- in one set-based call (proved row for row by supabase/tests/0651_committed_spend_equivalence.test.sql),
  -- so the delivery read reuses it instead of calling the position once per project.
  cprocs as (
    select pr.id, pr.project_id, pr.currency, pr.total_value
      from public.procurements pr
      join proj on proj.id = pr.project_id
     where pr.org_id = public.auth_org_id()
       and pr.status::text = any (public.committed_procurement_statuses())
  ),
  open_commitment as materialized (
    select o.procurement_id, o.amount
      from public.procurement_open_commitments((select array_agg(id) from cprocs)) o
  ),
  commitment as (
    select proj.id as project_id,
           -- project_pmo_commitment_position: the project-currency open commitment, ignoring other currencies.
           coalesce(sum(o.amount) filter (where p.currency = proj.currency), 0) as amount,
           -- ...and complete only while every committed purchase is in the project currency and readable.
           coalesce(bool_and(coalesce(p.currency = proj.currency, false) and p.total_value is not null
                             and p.total_value::text not in ('NaN','Infinity','-Infinity')) filter (where p.id is not null), true) as complete
      from proj
      left join cprocs p on p.project_id = proj.id
      left join open_commitment o on o.procurement_id = p.id
     where public.auth_role() in ('Admin','Executive','Project Manager','Finance')
     group by proj.id
  ),
  committed as (
    select
      proj.id as project_id,
      coalesce((select sum(li.budgeted_amount)
                from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                where v.project_id = proj.id and v.status = 'Active'), 0) as budget,
      case when cm.complete then cm.amount else null end as committed_spend
    from proj
    left join commitment cm on cm.project_id = proj.id

  )
  select
    c.project_id,
    case
      when bool_or(e.has_signal) then sum(e.weight * e.effective_pct) / nullif(sum(e.weight), 0)
      else null
    end as delivery_pct,
    c.committed_spend,
    c.budget
  from committed c
  left join eff e on e.project_id = c.project_id
  group by c.project_id, c.committed_spend, c.budget;
$$;

revoke all     on function get_projects_delivery(uuid[]) from public;
grant  execute on function get_projects_delivery(uuid[]) to   authenticated;
revoke execute on function get_projects_delivery(uuid[]) from anon;
