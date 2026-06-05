-- 0009_dashboard_margin.sql — Dual-lens dashboard margin re-formula + companion win-rate RPC
-- (sales-pipeline-dashboard.spec / OD-MARGIN-1, OD-SP-1/2/3, OD-BUDGET-1/2; ADR-0014).
--
-- Re-formulates get_executive_dashboard() to replace the mislabeled avg_gross_margin (OBS-SPD-002:
-- budget-burn headroom, NOT gross margin) with the OD-MARGIN-1 value-weighted dual-lens metrics, and
-- adds the companion get_win_rate(p_from,p_to) RPC (DD-1: decoupled so a period toggle does not bust
-- the heavy dashboard cache). Forward-only, additive; reversibility = `supabase db reset`
-- (pre-production, ADR-0006). Mirrors ADR-0009 / 0003_dashboard_views.sql discipline:
--   • security invoker (the DEFAULT — do NOT add security definer)
--   • no org_id argument (org seam = auth_org_id() inside RLS, never client-supplied)
--   • revoke all from public; grant execute to authenticated; revoke execute from anon.

-- ============================================================================
-- get_executive_dashboard() — re-formula (FR-SPD-001/002/003/004/005).
--
-- SECURITY (NFR-SPD-SEC-001 / ADR-0009): this function stays `security invoker`. Every base-table read
-- below (projects / procurements / companies / budget_versions / budget_line_items /
-- pipeline_stage_config) runs under the CALLER'S RLS policies (… = org_id = auth_org_id()), so every
-- aggregate is org-scoped automatically. It takes NO org_id argument.
-- DO NOT switch this to `security definer` without re-adding an explicit `org_id = auth_org_id()`
-- filter on every table read here; doing so would bypass RLS and leak cross-org aggregates (audit R1).
-- ============================================================================
create or replace function get_executive_dashboard()
  returns json
  language sql
  stable
  security invoker
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
    'projects_at_risk', (select count(*) from active where budget > 0 and spent / budget > 0.9),
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

-- ============================================================================
-- get_win_rate(p_from, p_to) — companion dual win-rate over a decided_at range
-- (FR-SPD-006/007/008, OD-SP-3; DD-1).
--
-- SECURITY (NFR-SPD-SEC-001 / ADR-0009): security invoker, no org_id argument — the projects read runs
-- under projects_select (org_id = auth_org_id()), so wins/losses are org-scoped automatically.
-- DO NOT switch to `security definer` without re-adding an explicit `org_id = auth_org_id()` filter.
--
-- Wins = OD-SP-1 On-hand set; losses = {Loss Tender}; undecided (decided_at null) excluded entirely.
-- Range is inclusive on both ends; p_to matches the whole of its day via `< (p_to + 1)` so an intraday
-- decided_at timestamp on p_to still counts (the DAL passes a plain date; spec §3.7). Null bound = open.
-- Divide-by-zero guarded: zero count- or value-denominator ⇒ rate 0.
-- ============================================================================
create or replace function get_win_rate(p_from date default null, p_to date default null)
  returns json
  language sql
  stable
  security invoker
as $$
  with decided as (
    select status, contract_value from projects
    where decided_at is not null
      and (p_from is null or decided_at >= p_from)
      and (p_to   is null or decided_at <  (p_to + 1)::timestamptz)
  ),
  agg as (
    select
      count(*) filter (where status in ('Won, Pending KoM','Ongoing Project','On Hold','Close Out')) as wins_count,
      count(*) filter (where status = 'Loss Tender') as losses_count,
      coalesce(sum(contract_value) filter (where status in ('Won, Pending KoM','Ongoing Project','On Hold','Close Out')), 0) as wins_value,
      coalesce(sum(contract_value) filter (where status = 'Loss Tender'), 0) as losses_value
    from decided
  )
  select json_build_object(
    'wins_count', wins_count,
    'losses_count', losses_count,
    'wins_value', wins_value,
    'losses_value', losses_value,
    'win_rate_count', case when wins_count + losses_count > 0
        then wins_count::numeric / (wins_count + losses_count) else 0 end,
    'win_rate_value', case when wins_value + losses_value > 0
        then wins_value / (wins_value + losses_value) else 0 end
  ) from agg;
$$;

revoke all on function get_win_rate(date, date) from public;
grant execute on function get_win_rate(date, date) to authenticated;
revoke execute on function get_win_rate(date, date) from anon;
