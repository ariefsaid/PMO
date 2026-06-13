-- 0026_delivery_rpc_v2_committed_spend.sql — Extend get_projects_delivery to return
-- committed_spend and budget alongside delivery_pct.
-- This migration fixes the immutability bug from PR #79 (migration 0023 was edited in-place
-- after it had already been pushed to prod in PR #74). Supabase db-push is migration-id-based
-- and will not re-apply 0023, so the committed_spend/budget columns were missing in prod.
-- This migration applies the change as a NEW migration that supersedes the 0023 function.
-- OD-BUDGET-2: committed basis = sum(procurements.total_value) for statuses Ordered, Received,
-- Vendor Invoiced, Paid only (excludes Draft/Requested/Approved/Vendor Quoted/Quote Selected/
-- Rejected/Cancelled).
-- Security: same as 0023 original — security invoker, search_path public, anon revoked.

drop function if exists get_projects_delivery(uuid[]);

create or replace function get_projects_delivery(p_ids uuid[])
  returns table (
    project_id uuid,
    delivery_pct numeric,
    committed_spend numeric,
    budget numeric
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
    where m.project_id = any(p_ids)
    group by m.id
  ),
  committed as (
    select
      p.id as project_id,
      p.budget,
      coalesce(sum(pr.total_value), 0) as committed_spend
    from projects p
    left join procurements pr
      on pr.project_id = p.id
     and pr.status in ('Ordered', 'Received', 'Vendor Invoiced', 'Paid')
    where p.id = any(p_ids)
    group by p.id, p.budget
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
