-- 1203 (#2709): the actor-facing seam other features consume: "does the signed-in person hold this capability / this role?".
-- Rollback: supabase/migrations/rollback/1203_role_capability_actor_helpers_down.sql
-- Real signed-in, ACTIVE member only (never the view-as role). A person with no built-in role holds no capability and sees prices
-- as today. Approval steps, notifications and document categories point at a role through actor_holds_built_in_role.

create function public.actor_built_in_role() returns text
  language sql stable security definer set search_path = pg_catalog, public as $$
  select p.built_in_role from public.profiles p where p.id = auth.uid() and p.status = 'active'
$$;

create function public.actor_has_role_capability(p_capability text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(public.role_has_capability(public.actor_built_in_role(), p_capability), false)
$$;

create function public.actor_sees_prices() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select case
    when not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active') then false
    else public.built_in_role_sees_prices(public.actor_built_in_role())
  end
$$;

create function public.actor_holds_built_in_role(p_key text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(public.actor_built_in_role() = p_key, false)
$$;

revoke all on function public.actor_built_in_role(), public.actor_has_role_capability(text),
  public.actor_sees_prices(), public.actor_holds_built_in_role(text) from public, anon;
grant execute on function public.actor_built_in_role(), public.actor_has_role_capability(text),
  public.actor_sees_prices(), public.actor_holds_built_in_role(text) to authenticated, service_role;
