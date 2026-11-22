-- Reverse of 1730 (run the 1731 rollback first: the reader reads the scope column and the helper).
drop function if exists public.idle_headcount_days(uuid, uuid);
drop function if exists public.save_idle_cost_scope(text);
alter table public.idle_cost_settings drop column if exists scope;
