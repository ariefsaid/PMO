-- rollback/1200_builtin_role_catalogue_down.sql
drop function if exists public.built_in_role_sees_prices(text);
drop function if exists public.role_has_capability(text, text);
drop function if exists public.built_in_role_may_stand_in(text, text);
drop function if exists public.built_in_role_may_prepare(text);
drop function if exists public.built_in_role_may_approve(text);
drop function if exists public.built_in_role_tier(text);
drop function if exists public.built_in_role_base(text);
drop table if exists public.built_in_role_capabilities;
drop table if exists public.built_in_roles;
