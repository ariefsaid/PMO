-- 0145_task_archive_rollup_exclusion.sql — OD-INT-9 subtask + archive rollup rule (binding).
--
-- Only tasks with parent_task_id IS NULL and archived_at IS NULL participate in milestone counts (task_count,
-- calculated_pct), project delivery_pct, and (by extension — they consume these same RPCs)
-- the S-curve and Gantt derivations. Subtasks render nested under their parent and never
-- independently move a percentage. Without this rule a parent and its children double-count
-- and delivery reporting silently inflates (proven RED by 0141_subtask_rollup_exclusion.test.sql).
--
-- Mechanism: both read-aggregation RPCs are versioned by RE-CREATION in a later migration
-- (get_projects_delivery has been re-created in 0026 and 0033). This migration follows that
-- existing convention — re-create both here with ONE change vs their current authoritative
-- bodies: the LEFT JOIN tasks adds `AND t.parent_task_id IS NULL and t.archived_at IS NULL`.
--
-- Sources re-created verbatim (modulo the one filter line):
--   get_project_milestones(uuid)   — authoritative body in 0023_delivery_milestones.sql §4.
--   get_projects_delivery(uuid[])  — authoritative body in 0033_at_risk_budget_from_versions.sql
--                                    (the committed_spend + Active-version-budget version;
--                                     0023's and 0026's earlier bodies are superseded).
--
-- Reversibility: pre-prod via `supabase db reset`. The reverse is to re-create the two RPCs
-- from 0023/0033 (drop the parent_task_id filter); both are security-invoker stable SQL funcs.

-- §1 — get_project_milestones(p_project_id): exclude subtasks from task_count + calculated_pct.
-- Calculated % is now Done-top-level / total-top-level; null when the milestone has no
-- top-level tasks (nullif on the denominator). effective_pct unchanged (coalesce input/calc/0).
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

-- §2 — get_projects_delivery(p_ids): exclude subtasks from the per-milestone effective_pct
-- (the `eff` CTE mirrors get_project_milestones' derivation, so the same filter applies).
-- committed_spend / Active-version budget derivation is byte-for-byte 0033's authoritative body.
drop function if exists get_projects_delivery(uuid[]);

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
  committed as (
    select
      p.id as project_id,
      coalesce((select sum(li.budgeted_amount)
                from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                where v.project_id = p.id and v.status = 'Active'), 0) as budget,
      coalesce(sum(pr.total_value), 0) as committed_spend
    from projects p
    left join procurements pr
      on pr.project_id = p.id
     and pr.status in ('Ordered', 'Received', 'Vendor Invoiced', 'Paid')
    where p.id = any(p_ids)
    group by p.id
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
