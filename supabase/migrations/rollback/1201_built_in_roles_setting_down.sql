-- rollback/1201_built_in_roles_setting_down.sql
drop function if exists public.set_built_in_roles_enabled(boolean);
drop function if exists public.get_built_in_roles_enabled();
drop function if exists public.org_built_in_roles_enabled(uuid);
alter table public.organizations drop column if exists built_in_roles_enabled;
