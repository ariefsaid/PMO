-- 1851: restates actor_may_see_prices_now() without the legacy-Engineer clause (spec price-visibility-roles, FR-002).
-- Body from 1215_hide_prices_setting.sql (the latest definition) minus `and not (actor_built_in_role() is null and auth_role() = 'Engineer')`.
-- A person with no job role sees prices at every base level; who is hidden is decided only by the sees_prices rows (FR-004).
-- drops: the legacy-Engineer clause (a person with no job role at the Engineer level no longer loses prices); the sees_prices rows alone decide who is hidden.
-- Rollback: supabase/migrations/rollback/1851_price_right_no_legacy_exception_down.sql
create or replace function public.actor_may_see_prices_now() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select case
    when not public.org_hide_prices_enabled(public.auth_org_id()) then true
    when not public.is_active_member() then false
    else public.actor_sees_prices()
  end
$$;

revoke all on function public.actor_may_see_prices_now() from public, anon;
grant execute on function public.actor_may_see_prices_now() to authenticated;
