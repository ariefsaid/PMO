-- Reverse of 1250 (run 1252, 1251 rollbacks first).
drop function if exists public.archive_labour_cost_rate(uuid);
drop function if exists public.end_labour_cost_rate(uuid, date);
drop function if exists public.save_labour_cost_rate(jsonb);
drop function if exists public.save_labour_cost_settings(boolean);
drop function if exists public.labour_cost_gate();
drop function if exists public.labour_rate_locked(uuid, uuid, text, uuid, text, date);
drop function if exists public.labour_rate_for(uuid, uuid, date);
drop function if exists public.labour_cost_enabled(uuid);
drop table if exists public.labour_cost_rates;
drop table if exists public.labour_cost_classes;
drop table if exists public.labour_cost_settings;
