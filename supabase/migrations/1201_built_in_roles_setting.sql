-- 1201 (#2709): the organization setting that turns the built-in role set on. Default false: an existing organization
-- sees and does exactly what it did before. While false, no profile in the organization may be given a built-in role key (1202).
-- Rollback: supabase/migrations/rollback/1201_built_in_roles_setting_down.sql

alter table public.organizations add column built_in_roles_enabled boolean not null default false;

comment on column public.organizations.built_in_roles_enabled is
  '#2709 When true the organization may assign the 28 built-in roles to people (profiles.built_in_role). Default false = unchanged behaviour. Written only by set_built_in_roles_enabled (Admin).';

create function public.org_built_in_roles_enabled(p_org uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select o.built_in_roles_enabled from public.organizations o where o.id = p_org), false)
$$;

create function public.get_built_in_roles_enabled() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select public.is_active_member() and public.org_built_in_roles_enabled(public.auth_org_id())
$$;

create function public.set_built_in_roles_enabled(p_enabled boolean) returns boolean
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin can change the built-in roles setting' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'the built-in roles setting must be true or false' using errcode = '22023';
  end if;
  update public.organizations set built_in_roles_enabled = p_enabled where id = v_org;
  return p_enabled;
end
$$;

revoke all on function public.org_built_in_roles_enabled(uuid), public.get_built_in_roles_enabled(),
  public.set_built_in_roles_enabled(boolean) from public, anon;
grant execute on function public.get_built_in_roles_enabled(), public.set_built_in_roles_enabled(boolean) to authenticated;
grant execute on function public.org_built_in_roles_enabled(uuid) to service_role;
