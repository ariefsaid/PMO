-- rollback/1215_hide_prices_setting_down.sql
drop function if exists public.get_may_see_prices();
drop function if exists public.actor_may_see_prices();
drop function if exists public.actor_may_see_prices_now();
drop function if exists public.set_hide_prices_enabled(boolean);
drop function if exists public.get_hide_prices_enabled();
drop function if exists public.org_hide_prices_enabled(uuid);
alter table public.organizations drop column if exists hide_prices_from_requesters;
