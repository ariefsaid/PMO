-- 0032_fix_top_projects_spent.sql
-- AC-MONEY-01: Fix get_executive_dashboard() — derive top_projects.spent and
-- projects_at_risk from procurements instead of the dead projects.spent stored
-- column (0001_init_schema.sql:79 "DEFERRED: stored vs derived").
--
-- Root cause: projects.spent is a numeric(14,2) column seeded to 0 with no trigger
-- ever populating it. The Exec/Finance/BvA dashboard reads top_projects.spent and
-- projects_at_risk from this column → spend always shows $0 and at-risk count is
-- wrong even when projects have large Paid POs.
--
-- The canonical committed-spend basis (OD-BUDGET-2) is already used by:
--   • on_hand.spent CTE in this same function (0009_dashboard_margin.sql lines 36-39)
--   • get_finance_budget_review() (0022_finance_budget_debt.sql)
--   • get_projects_delivery_summary() (0026_delivery_rpc_v2_committed_spend.sql)
-- Statuses: Ordered, Received, Vendor Invoiced, Paid (matches COMMITTED_STATUSES in
-- pmo-portal/src/lib/db/procurements.ts and all existing pgTAP oracle tests).
--
-- Reversible: supabase db reset (pre-production, ADR-0006).
-- Security: security invoker unchanged (ADR-0009); no org_id argument; RLS scopes every
-- base-table read. DO NOT add security definer without explicit org_id filter on every
-- table read inside the function.

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
  -- AC-MONEY-01: committed-spend per active project — used for projects_at_risk.
  active_committed as (
    select
      p.id,
      p.contract_value,
      p.budget,
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
    -- AC-MONEY-01: projects_at_risk now uses committed_spend (Ordered..Paid) not the dead
    -- projects.spent stored column so the count is accurate when POs exist.
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
    -- AC-MONEY-01: top_projects.spent now derived from procurements (Ordered..Paid) not
    -- the dead projects.spent stored column, so BvACard + Finance dashboard show real spend.
    'top_projects', coalesce((
      select json_agg(t order by t.contract_value desc) from (
        select
          p.id,
          p.name,
          c.name as client_name,
          p.contract_value,
          p.budget,
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

-- ACL unchanged: no new grants/revokes needed (the function already has authenticated
-- EXECUTE and explicit anon EXECUTE revoke from 0009).
