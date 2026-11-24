-- The existing masked readers share this single price gate. Receipt blindness also hides stock valuation.
create or replace function public.actor_may_see_prices_now() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select case
    when public.order_receiving_blind() then false
    when not public.org_hide_prices_enabled(public.auth_org_id()) then true
    when not public.is_active_member() then false
    else public.actor_sees_prices()
         and not (public.actor_built_in_role() is null and public.auth_role() = 'Engineer')
  end
$$;
