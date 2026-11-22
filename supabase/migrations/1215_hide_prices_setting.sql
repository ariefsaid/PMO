-- 1215 (#2699): the organization setting that hides unit prices and amounts from requesters, and the one rule that decides it.
-- Default false: every organization sees exactly what it saw before. Rollback: rollback/1215_hide_prices_setting_down.sql
-- Requester = a person with no purchasing or finance authority: a built-in officer/field role without price right (#2709 FR-008),
-- or a legacy Engineer holding no built-in role. Per person, real role (never view-as). Reads built_in_role_sees_prices via actor_sees_prices().

alter table public.organizations add column hide_prices_from_requesters boolean not null default false;
comment on column public.organizations.hide_prices_from_requesters is
  '#2699 When true, requesters (see actor_may_see_prices) read unit prices and amounts as NULL through the masked views. Default false = unchanged. Written only by set_hide_prices_enabled (Admin).';

create function public.org_hide_prices_enabled(p_org uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select o.hide_prices_from_requesters from public.organizations o where o.id = p_org), false)
$$;

create function public.get_hide_prices_enabled() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select public.is_active_member() and public.org_hide_prices_enabled(public.auth_org_id())
$$;

create function public.set_hide_prices_enabled(p_enabled boolean) returns boolean
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin can change the hide prices setting' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'the hide prices setting must be true or false' using errcode = '22023';
  end if;
  update public.organizations set hide_prices_from_requesters = p_enabled where id = v_org;
  return p_enabled;
end
$$;

-- The one rule. NOT security definer: it only calls definer helpers, so it stays cheap inside a view's per-query initplan.
create function public.actor_may_see_prices_now() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select case
    when not public.org_hide_prices_enabled(public.auth_org_id()) then true
    when not public.is_active_member() then false
    else public.actor_sees_prices()
         and not (public.actor_built_in_role() is null and public.auth_role() = 'Engineer')
  end
$$;
create function public.actor_may_see_prices() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select public.actor_may_see_prices_now()
$$;
create function public.get_may_see_prices() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select public.actor_may_see_prices_now()
$$;

revoke all on function public.org_hide_prices_enabled(uuid), public.get_hide_prices_enabled(), public.set_hide_prices_enabled(boolean),
  public.actor_may_see_prices_now(), public.actor_may_see_prices(), public.get_may_see_prices() from public, anon;
grant execute on function public.get_hide_prices_enabled(), public.set_hide_prices_enabled(boolean), public.get_may_see_prices(),
  public.actor_may_see_prices_now(), public.actor_may_see_prices() to authenticated;
grant execute on function public.org_hide_prices_enabled(uuid) to service_role;
