-- 0027_dashboard_at_risk_boundary.sql — reconcile the server projects_at_risk count to `>=`.
--
-- The canonical at-risk rule (src/lib/dashboardConstants.ts) is: an ACTIVE project with
-- budget > 0 AND spend/budget >= AT_RISK_THRESHOLD (0.9) — at-or-above 90%, INCLUSIVE.
-- get_executive_dashboard() (0009_dashboard_margin.sql) computed projects_at_risk with
-- `spent / budget > 0.9` (strict), so a project at EXACTLY 90% was undercounted relative to
-- the FE. This migration CREATE OR REPLACEs the function to use `>= 0.9`, matching the FE.
--
-- IMMUTABILITY: 0009 is already applied to prod and MUST NOT be edited in place (db-push is
-- migration-id-based and will not re-apply an edited 0009). This is a NEW, forward-only,
-- additive migration that supersedes the 0009 definition. Reversibility = `supabase db reset`
-- (pre-production discipline, ADR-0006).
--
-- This is the ONLY behavior change: `> 0.9` → `>= 0.9` on projects_at_risk. Every other clause
-- (the `active` set = Ongoing Project, the budget>0 guard, all other KPIs, the margin formulas)
-- is copied verbatim from 0009 and is unchanged.
--
-- SECURITY (NFR-SPD-SEC-001 / ADR-0009): preserved verbatim from 0009 — `security invoker`
-- (the DEFAULT; every base-table read runs under the CALLER's RLS so aggregates are org-scoped),
-- NO org_id argument, and the public/anon EXECUTE revokes below. DO NOT switch to `security
-- definer` without re-adding an explicit `org_id = auth_org_id()` filter on every table read.
-- search_path is pinned to public inline here (CREATE OR REPLACE resets the function config that
-- 0021_lint_hardening.sql set via ALTER FUNCTION, so we must re-pin it — AC-DBLINT-001).

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
    -- Reconciled to `>= 0.9` (canonical AT_RISK_THRESHOLD, at-or-above 90%) — the ONLY change vs 0009.
    'projects_at_risk', (select count(*) from active where budget > 0 and spent / budget >= 0.9),
    'projects_by_status', coalesce((
      select json_agg(json_build_object('status', status, 'count', c) order by status)
      from (select status, count(*) c from projects group by status) s), '[]'::json),
    'procurements_by_status', coalesce((
      select json_agg(json_build_object('status', status, 'count', c) order by status)
      from (select status, count(*) c from procurements group by status) s), '[]'::json),
    'top_projects', coalesce((
      select json_agg(t order by t.contract_value desc) from (
        select p.id, p.name, c.name as client_name, p.contract_value, p.budget, p.spent, p.status
        from projects p left join companies c on c.id = p.client_id
        order by p.contract_value desc limit 5
      ) t), '[]'::json)
  );
$$;

revoke all on function get_executive_dashboard() from public;
grant execute on function get_executive_dashboard() to authenticated;
-- Supabase default ACL stamps a per-role EXECUTE grant on `anon` even after the public revoke above.
-- Explicitly revoke it to close the unauthenticated heavy-query / DoS surface (ADR-0009 Security LOW-1).
revoke execute on function get_executive_dashboard() from anon;
