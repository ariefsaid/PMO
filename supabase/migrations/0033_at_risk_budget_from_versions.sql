-- 0033_at_risk_budget_from_versions.sql
-- AC-W2-1-RPC-01/02/03: Fix get_executive_dashboard() and get_projects_delivery() — derive
-- the budget basis from the Active budget-version line-item total instead of the dead stored
-- projects.budget column (same class of bug as the projects.spent fix in migration 0032).
--
-- Root cause: projects.budget is a numeric(14,2) column that no trigger or RPC ever syncs to
-- the Σ of Active budget-version line-items. Any project whose budget lives in budget-version
-- line-items but whose stored projects.budget is still 0 is:
--   • EXCLUDED from projects_at_risk (the `budget > 0` filter eliminates it)
--   • shown as "$X of $0 budget" in the UI (div-by-zero → 0% utilization)
--   • NOT surfaced in top_projects.budget (appears as 0)
--
-- The canonical derived basis (OD-BUDGET-1) already used by the pipeline lens:
--   coalesce((select sum(li.budgeted_amount)
--             from budget_versions v join budget_line_items li on li.budget_version_id = v.id
--             where v.project_id = p.id and v.status = 'Active'), 0)
--
-- This migration applies that subquery everywhere budget is consumed as money or at-risk:
--   1. get_executive_dashboard() — active_committed CTE (feeds projects_at_risk) + top_projects
--   2. get_projects_delivery()   — committed CTE's budget column
--
-- Reversible: supabase db reset (pre-production, ADR-0006).
-- Security: security invoker unchanged (ADR-0009); no org_id argument; RLS scopes every
-- base-table read. DO NOT add security definer without explicit org_id filter on every
-- table read inside the function.

-- ============================================================================
-- 1. get_executive_dashboard()
--    Source: 0032_fix_top_projects_spent.sql (authoritative body).
--    Changes: two reads of stored p.budget replaced with the derived Σ subquery:
--      a) active_committed CTE → feeds the projects_at_risk count
--      b) top_projects inner select → feeds the BvA card + Finance dashboard
--    Everything else (security invoker, search_path, on_hand CTE, pipeline CTE,
--    spent subqueries from 0032, ACL block) is verbatim from 0032.
-- ============================================================================
create or replace function get_executive_dashboard()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with active as (
    -- Retained KPIs use the existing header scalars over Ongoing Project (unchanged from 0003).
    select * from projects where status = 'Ongoing Project'
  ),
  -- AC-W2-1-RPC-01: committed-spend per active project — budget now DERIVED from Active version.
  -- Pre-0033: p.budget here was the dead stored column (silently 0 for line-item-budgeted projects),
  -- causing the budget>0 guard to exclude them from projects_at_risk.
  active_committed as (
    select
      p.id,
      p.contract_value,
      coalesce((select sum(li.budgeted_amount)
                from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                where v.project_id = p.id and v.status = 'Active'), 0) as budget,
      coalesce((
        select sum(pr.total_value) from procurements pr
        where pr.project_id = p.id
          and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')
      ), 0) as committed_spend
    from projects p
    where p.status = 'Ongoing Project'
  ),
  on_hand as (
    -- OD-SP-1 On-hand set. spent = OD-BUDGET-2 committed basis (Ordered..Paid), derived in SQL.
    select p.id, p.contract_value,
           coalesce((select sum(pr.total_value) from procurements pr
                     where pr.project_id = p.id
                       and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')), 0) as spent
    from projects p
    where p.status in ('Won, Pending KoM','Ongoing Project','On Hold','Close Out')
  ),
  pipeline as (
    -- OD-SP-1 Pipeline set. active_budget = OD-BUDGET-1 Σ-Active-version line-items (same SQL as
    -- get_project_budget). win_prob = pipeline_stage_config (OD-SP-2); unconfigured status ⇒ 0.
    select p.id, p.contract_value, p.status,
           coalesce((select sum(li.budgeted_amount)
                     from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                     where v.project_id = p.id and v.status = 'Active'), 0) as active_budget,
           coalesce((select c.win_probability from pipeline_stage_config c where c.status = p.status), 0) as win_prob
    from projects p
    where p.status in ('Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation')
  )
  select json_build_object(
    'active_projects', (select count(*) from active),
    'total_contract_value', coalesce((select sum(contract_value) from active), 0),
    -- OD-MARGIN-1 On-hand lens (FR-SPD-001): actual value-weighted margin + total contract value.
    'on_hand_value', coalesce((select sum(contract_value) from on_hand), 0),
    'on_hand_margin', coalesce((select case when sum(contract_value) > 0
                         then sum(contract_value - spent) / sum(contract_value) else 0 end from on_hand), 0),
    -- OD-MARGIN-1 Pipeline lens (FR-SPD-002/003): weighted value, total value, projected margin.
    'pipeline_total_value', coalesce((select sum(contract_value) from pipeline), 0),
    'pipeline_weighted_value', coalesce((select sum(contract_value * win_prob) from pipeline), 0),
    'pipeline_projected_margin', coalesce((select case when sum(contract_value) > 0
                         then sum(contract_value - active_budget) / sum(contract_value) else 0 end from pipeline), 0),
    -- AC-W2-1-RPC-01: projects_at_risk now uses the DERIVED budget (Active-version Σ), not the
    -- dead stored p.budget column, so line-item-budgeted projects are correctly counted.
    'projects_at_risk', (
      select count(*) from active_committed
      where budget > 0 and committed_spend / budget >= 0.9
    ),
    'projects_by_status', coalesce((
      select json_agg(json_build_object('status', status, 'count', c) order by status)
      from (select status, count(*) c from projects group by status) s), '[]'::json),
    'procurements_by_status', coalesce((
      select json_agg(json_build_object('status', status, 'count', c) order by status)
      from (select status, count(*) c from procurements group by status) s), '[]'::json),
    -- AC-W2-1-RPC-02: top_projects.budget now DERIVED from Active-version Σ (not stored column).
    -- AC-MONEY-01 (0032): top_projects.spent still derived from procurements (Ordered..Paid).
    'top_projects', coalesce((
      select json_agg(t order by t.contract_value desc) from (
        select
          p.id,
          p.name,
          c.name as client_name,
          p.contract_value,
          coalesce((select sum(li.budgeted_amount)
                    from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                    where v.project_id = p.id and v.status = 'Active'), 0) as budget,
          coalesce((
            select sum(pr.total_value) from procurements pr
            where pr.project_id = p.id
              and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')
          ), 0) as spent,
          p.status
        from projects p left join companies c on c.id = p.client_id
        order by p.contract_value desc limit 5
      ) t), '[]'::json)
  );
$$;

-- ACL: unchanged from 0009/0032 — authenticated can EXECUTE, anon explicitly revoked.
revoke all     on function get_executive_dashboard() from public;
grant  execute on function get_executive_dashboard() to   authenticated;
revoke execute on function get_executive_dashboard() from anon;

-- ============================================================================
-- 2. get_projects_delivery(uuid[])
--    Source: 0026_delivery_rpc_v2_committed_spend.sql (authoritative body).
--    Change: committed CTE's budget — previously `p.budget` (stored) now uses the
--    derived Σ-Active-version-line_items scalar subquery.  Because budget is now a
--    scalar correlated subquery (not a grouped column), it is removed from GROUP BY.
--    Everything else (eff CTE, delivery_pct calc, committed_spend, ACL) verbatim.
-- ============================================================================
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
    where m.project_id = any(p_ids)
    group by m.id
  ),
  -- AC-W2-1-RPC-03: budget is now DERIVED from the Active budget-version line-items.
  -- Pre-0033: p.budget was the stored column (silently 0 for line-item-budgeted projects).
  -- budget is a scalar correlated subquery → removed from GROUP BY (only p.id remains).
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
