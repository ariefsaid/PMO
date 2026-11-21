-- rollback/1203_role_capability_actor_helpers_down.sql
drop function if exists public.actor_holds_built_in_role(text);
drop function if exists public.actor_sees_prices();
drop function if exists public.actor_has_role_capability(text);
drop function if exists public.actor_built_in_role();
