-- 1218 (#2699): the derived-amount reads return NULL money for a person who may not see prices (actor_may_see_prices_now, 1215).
-- Same approach as stock_can_see_cost: the existing function bodies are untouched (renamed *_unmasked); each public name becomes a thin
-- wrapper that only masks the money field. Rows, ids, currencies and flags stay. Rollback: rollback/1218_hide_prices_derived_amounts_down.sql
-- The approval-panel figures (spend_approval_project_figures and the routes built on it) already return no figures below approval
-- rank, and every person this setting hides is below approval rank, so they need no change.

alter function public.procurement_open_commitment(public.procurements) rename to procurement_open_commitment_unmasked;
create function public.procurement_open_commitment(p public.procurements) returns numeric
  language sql stable security invoker set search_path = public, pg_catalog as $$
  select case when (select public.actor_may_see_prices_now()) then public.procurement_open_commitment_unmasked(p) end
$$;

alter function public.procurement_open_commitments(uuid[]) rename to procurement_open_commitments_unmasked;
create function public.procurement_open_commitments(p_ids uuid[]) returns table (procurement_id uuid, amount numeric)
  language sql stable security invoker set search_path = public, pg_catalog as $$
  select u.procurement_id, case when (select public.actor_may_see_prices_now()) then u.amount end
    from public.procurement_open_commitments_unmasked(p_ids) u
$$;
revoke all on function public.procurement_open_commitments(uuid[]) from public, anon;
grant execute on function public.procurement_open_commitments(uuid[]) to authenticated, service_role;

alter function public.project_committed_spend(uuid) rename to project_committed_spend_unmasked;
create function public.project_committed_spend(p_project_id uuid) returns table (currency text, amount numeric, is_project_currency boolean)
  language sql stable security invoker set search_path = public, pg_catalog as $$
  select u.currency, case when (select public.actor_may_see_prices_now()) then u.amount end, u.is_project_currency
    from public.project_committed_spend_unmasked(p_project_id) u
$$;
