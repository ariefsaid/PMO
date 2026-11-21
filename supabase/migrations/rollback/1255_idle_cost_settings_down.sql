-- Reverse of 1255 (run the 1256 rollback first).
drop function if exists public.save_idle_cost_setting(boolean);
drop function if exists public.idle_cost_enabled(uuid);
drop table if exists public.idle_cost_settings;
