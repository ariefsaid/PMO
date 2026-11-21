-- 1218 (#2699): masked read functions for the derived amounts the request screens show. The originals (procurement_open_commitment,
-- procurement_open_commitments, project_committed_spend) are NOT touched: money and approval logic keeps reading the real values.
-- Each new function is SECURITY INVOKER, calls the original, and returns NULL money when actor_may_see_prices_now() (1215) is false.
-- The screens call these only while the organisation hides prices. Rollback: rollback/1218_hide_prices_derived_amounts_down.sql
-- The approval-panel figures (spend_approval_project_figures and the routes built on it) already return none below approval rank,
-- and every person this setting hides is below approval rank, so they need no change.

create function public.procurement_open_commitments_masked(p_ids uuid[]) returns table (procurement_id uuid, amount numeric)
  language sql stable security invoker set search_path = public, pg_catalog as $$
  select u.procurement_id, case when (select public.actor_may_see_prices_now()) then u.amount end
    from public.procurement_open_commitments(p_ids) u
$$;

create function public.project_committed_spend_masked(p_project_id uuid) returns table (currency text, amount numeric, is_project_currency boolean)
  language sql stable security invoker set search_path = public, pg_catalog as $$
  select u.currency, case when (select public.actor_may_see_prices_now()) then u.amount end, u.is_project_currency
    from public.project_committed_spend(p_project_id) u
$$;

-- The computed column on the masked procurements view (it takes the view's row, reads the table row under the caller's RLS).
create function public.procurement_open_commitment_masked(p public.procurements_masked) returns numeric
  language sql stable security invoker set search_path = public, pg_catalog as $$
  select case when (select public.actor_may_see_prices_now())
              then (select public.procurement_open_commitment(x) from public.procurements x where x.id = p.id) end
$$;

revoke all on function public.procurement_open_commitments_masked(uuid[]), public.project_committed_spend_masked(uuid),
  public.procurement_open_commitment_masked(public.procurements_masked) from public, anon;
grant execute on function public.procurement_open_commitments_masked(uuid[]), public.project_committed_spend_masked(uuid),
  public.procurement_open_commitment_masked(public.procurements_masked) to authenticated, service_role;
