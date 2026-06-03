-- 0003_dashboard_views.sql — Executive Dashboard SQL aggregation (target-arch §8.4 / FR-API-003).
-- Replaces the prototype's in-memory KPI/chart aggregation (OBS-DASH-*). Forward-only, additive;
-- reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- SECURITY (NFR-DASH-SEC-001): this function is `security invoker` (the default — do NOT add
-- `security definer`). Invoker means every base-table read below runs under the CALLER'S RLS policies
-- (projects_select / procurements_select / companies_select = org_id = auth_org_id()), so the aggregates
-- are scoped to the caller's org automatically. It takes NO org_id argument — the org seam comes from
-- auth_org_id() inside those policies, never from the client.
-- DO NOT switch this to `security definer` without re-adding an explicit `org_id = auth_org_id()` filter
-- on every table read here; doing so would bypass RLS and leak cross-org aggregates (audit R1).
create or replace function get_executive_dashboard()
  returns json
  language sql
  stable
  security invoker
as $$
  with active as (
    select * from projects where status = 'Ongoing Project'
  )
  select json_build_object(
    'active_projects', (select count(*) from active),
    'total_contract_value', coalesce((select sum(contract_value) from active), 0),
    -- [OWNER-DECISION] avg_gross_margin is currently an UNWEIGHTED average of per-project margins
    -- (budget-spent)/budget. Confirm whether PORTFOLIO margin sum(budget-spent)/sum(budget)
    -- (size-weighted) is intended — the two differ when project budgets vary significantly.
    -- Note: projects_at_risk (spent/budget>0.9) and this metric use different bases by design;
    -- revisit if a future role RPC copies this logic.
    'avg_gross_margin', coalesce(
      (select avg((budget - spent) / budget) from active where budget > 0), 0),
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
-- Explicitly revoke it to close the unauthenticated heavy-query / DoS surface (Security LOW-1).
-- The function is security invoker so anon already gets empty results, but the callable surface
-- should not exist at all for unauthenticated callers.
revoke execute on function get_executive_dashboard() from anon;
