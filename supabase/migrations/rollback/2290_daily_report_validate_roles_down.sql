-- Rollback for 2290_daily_report_validate_roles.sql

create or replace function public.actor_has_role_capability(p_capability text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(public.role_has_capability(public.actor_built_in_role(), p_capability), false)
$$;

revoke all on function public.actor_has_role_capability(text) from public, anon;
grant execute on function public.actor_has_role_capability(text) to authenticated, service_role;

drop function if exists public.set_daily_report_validate_roles(text[]);
drop trigger if exists trg_organizations_guard_daily_report_validate_roles on public.organizations;
drop function if exists public.guard_daily_report_validate_roles();
alter table public.organizations drop column if exists daily_report_validate_roles;
