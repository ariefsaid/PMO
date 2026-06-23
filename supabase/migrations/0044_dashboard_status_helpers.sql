-- 0044_dashboard_status_helpers.sql — DB hygiene: extract the dashboard status-set literals
-- (duplicated across the three dashboard RPCs) into shared immutable SQL helper functions, then
-- redefine the RPCs to call the helpers instead of inlining the literals.
--
-- WHY: get_executive_dashboard() / get_win_rate() / get_sales_pipeline() hand-duplicated three
-- status-set literals — the OD-BUDGET-2 committed-spend basis (Ordered..Paid), the OD-SP-1 on-hand
-- set, and the OD-SP-1 open-pipeline set — across multiple CTEs/filters. Any future taxonomy edit
-- had to be made in N places, in sync, or a dashboard number would silently drift. This migration
-- pins each set in ONE immutable helper (taxonomy single-source-of-truth, pinned by pgTAP 0087).
--
-- BEHAVIOR-PRESERVING: the helper membership is byte-for-byte the prior literals; the dashboards
-- MUST produce identical numbers. The literal `status in ('a','b',...)` over the enum column is
-- exactly equivalent to `status::text = any(helper())` for the non-null enum values involved.
--
-- AUTHORITATIVE BODIES (latest live definitions, NOT 0009 — those were superseded):
--   • get_executive_dashboard()  ← 0033_at_risk_budget_from_versions.sql (committed set ×3, on-hand
--     set ×1, pipeline set ×1). Verbatim except the five status-set literals → helper calls.
--   • get_win_rate(date,date)    ← 0009_dashboard_margin.sql (on-hand set ×2). Verbatim except those.
--   • get_sales_pipeline()       ← 0020_sales_pipeline_attention.sql (pipeline set ×1). Verbatim
--     except that one literal.
--
-- SECURITY (unchanged, ADR-0009): all three RPCs stay `security invoker`; the helpers take no org_id
-- and read no tables (pure constant arrays) so they introduce no RLS surface. `set search_path =
-- public` matches the originals' discipline. Reversible: `supabase db reset` (pre-production, ADR-0006).

-- ============================================================================
-- Shared status-set helpers — immutable, side-effect-free constant arrays.
-- `immutable` + `parallel safe` so the planner can fold them; `set search_path = ''` because the
-- body references no schema objects (constant only), matching lint-hardening discipline.
-- ============================================================================

-- OD-BUDGET-2 committed-spend basis: a procurement contributes to committed spend once it is
-- Ordered and through Paid. (Mirrors COMMITTED_STATUSES in the FE.)
create or replace function committed_procurement_statuses()
  returns text[]
  language sql
  immutable
  parallel safe
  set search_path = ''
as $$
  select array['Ordered','Received','Vendor Invoiced','Paid']::text[];
$$;

-- OD-SP-1 on-hand / won project set: projects that are won and in-or-past delivery.
create or replace function on_hand_project_statuses()
  returns text[]
  language sql
  immutable
  parallel safe
  set search_path = ''
as $$
  select array['Won, Pending KoM','Ongoing Project','On Hold','Close Out']::text[];
$$;

-- OD-SP-1 open-pipeline project set: pre-decision sales stages.
create or replace function pipeline_project_statuses()
  returns text[]
  language sql
  immutable
  parallel safe
  set search_path = ''
as $$
  select array['Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation']::text[];
$$;

revoke all     on function committed_procurement_statuses() from public;
revoke all     on function on_hand_project_statuses()       from public;
revoke all     on function pipeline_project_statuses()      from public;
grant  execute on function committed_procurement_statuses() to authenticated, anon, service_role;
grant  execute on function on_hand_project_statuses()       to authenticated, anon, service_role;
grant  execute on function pipeline_project_statuses()      to authenticated, anon, service_role;

-- ============================================================================
-- get_executive_dashboard() — re-definition from 0033, status-set literals → helper calls.
-- VERBATIM from 0033_at_risk_budget_from_versions.sql except:
--   • active_committed.committed_spend  : 'Ordered'..'Paid' literal → committed_procurement_statuses()
--   • on_hand.spent                     : 'Ordered'..'Paid' literal → committed_procurement_statuses()
--   • on_hand WHERE                     : on-hand set literal       → on_hand_project_statuses()
--   • pipeline WHERE                    : pipeline set literal      → pipeline_project_statuses()
--   • top_projects.spent                : 'Ordered'..'Paid' literal → committed_procurement_statuses()
-- security invoker / search_path / ACL unchanged.
-- ============================================================================
create or replace function get_executive_dashboard()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with active as (
    select * from projects where status = 'Ongoing Project'
  ),
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
          and pr.status::text = any(committed_procurement_statuses())
      ), 0) as committed_spend
    from projects p
    where p.status = 'Ongoing Project'
  ),
  on_hand as (
    select p.id, p.contract_value,
           coalesce((select sum(pr.total_value) from procurements pr
                     where pr.project_id = p.id
                       and pr.status::text = any(committed_procurement_statuses())), 0) as spent
    from projects p
    where p.status::text = any(on_hand_project_statuses())
  ),
  pipeline as (
    select p.id, p.contract_value, p.status,
           coalesce((select sum(li.budgeted_amount)
                     from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                     where v.project_id = p.id and v.status = 'Active'), 0) as active_budget,
           coalesce((select c.win_probability from pipeline_stage_config c where c.status = p.status), 0) as win_prob
    from projects p
    where p.status::text = any(pipeline_project_statuses())
  )
  select json_build_object(
    'active_projects', (select count(*) from active),
    'total_contract_value', coalesce((select sum(contract_value) from active), 0),
    'on_hand_value', coalesce((select sum(contract_value) from on_hand), 0),
    'on_hand_margin', coalesce((select case when sum(contract_value) > 0
                         then sum(contract_value - spent) / sum(contract_value) else 0 end from on_hand), 0),
    'pipeline_total_value', coalesce((select sum(contract_value) from pipeline), 0),
    'pipeline_weighted_value', coalesce((select sum(contract_value * win_prob) from pipeline), 0),
    'pipeline_projected_margin', coalesce((select case when sum(contract_value) > 0
                         then sum(contract_value - active_budget) / sum(contract_value) else 0 end from pipeline), 0),
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
              and pr.status::text = any(committed_procurement_statuses())
          ), 0) as spent,
          p.status
        from projects p left join companies c on c.id = p.client_id
        order by p.contract_value desc limit 5
      ) t), '[]'::json)
  );
$$;

revoke all     on function get_executive_dashboard() from public;
grant  execute on function get_executive_dashboard() to   authenticated;
revoke execute on function get_executive_dashboard() from anon;

-- ============================================================================
-- get_win_rate(p_from, p_to) — re-definition from 0009, on-hand literal → helper.
-- VERBATIM from 0009_dashboard_margin.sql except the two `status in (on-hand set)` filters in the
-- agg CTE → status::text = any(on_hand_project_statuses()). security invoker / ACL unchanged.
-- ============================================================================
create or replace function get_win_rate(p_from date default null, p_to date default null)
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with decided as (
    select status, contract_value from projects
    where decided_at is not null
      and (p_from is null or decided_at >= p_from)
      and (p_to   is null or decided_at <  (p_to + 1)::timestamptz)
  ),
  agg as (
    select
      count(*) filter (where status::text = any(on_hand_project_statuses())) as wins_count,
      count(*) filter (where status = 'Loss Tender') as losses_count,
      coalesce(sum(contract_value) filter (where status::text = any(on_hand_project_statuses())), 0) as wins_value,
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

revoke all     on function get_win_rate(date, date) from public;
grant  execute on function get_win_rate(date, date) to   authenticated;
revoke execute on function get_win_rate(date, date) from anon;

-- ============================================================================
-- get_sales_pipeline() — re-definition from 0020, pipeline literal → helper.
-- VERBATIM from 0020_sales_pipeline_attention.sql except the `pl` CTE WHERE `status in (pipeline
-- set)` → status::text = any(pipeline_project_statuses()). security invoker / ACL unchanged.
-- NOTE: 0020 did not set search_path; this re-definition adds `set search_path = public` (a strict
-- hardening, no behavior change — every object referenced is already public-schema).
-- ============================================================================
create or replace function get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with pl as (
    select
      p.id,
      p.name,
      p.client_id,
      p.status,
      p.contract_value,
      p.last_update,
      p.project_manager_id,
      coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    where p.status::text = any(pipeline_project_statuses())
  )
  select json_build_object(
    'stages', coalesce((
      select json_agg(
        json_build_object(
          'status',        s.status,
          'count',         s.cnt,
          'total_value',   s.total_value,
          'win_probability', s.win_prob,
          'weighted_value',  s.total_value * s.win_prob
        )
        order by s.status
      )
      from (
        select
          status,
          count(*)::int           as cnt,
          sum(contract_value)     as total_value,
          max(win_prob)           as win_prob
        from pl
        group by status
      ) s
    ), '[]'::json),
    'projects', coalesce((
      select json_agg(
        json_build_object(
          'id',             pl.id,
          'name',           pl.name,
          'client_name',    co.name,
          'status',         pl.status,
          'contract_value', pl.contract_value,
          'win_probability', pl.win_prob,
          'last_update',    pl.last_update,
          'pm_name',        pm.full_name
        )
        order by pl.contract_value desc
      )
      from pl
      left join companies co on co.id = pl.client_id
      left join profiles  pm on pm.id = pl.project_manager_id
    ), '[]'::json)
  );
$$;

revoke all     on function get_sales_pipeline() from public;
grant  execute on function get_sales_pipeline() to authenticated;
revoke execute on function get_sales_pipeline() from anon;
