-- Reverses 0998_project_shared_cost_splits.sql (#2519).
drop function if exists public.clear_shared_cost_split(uuid);
drop function if exists public.set_shared_cost_split(uuid, jsonb);
drop table if exists public.project_shared_cost_splits;
