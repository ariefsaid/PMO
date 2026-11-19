-- Reverses 0999_work_order_cost_amounts.sql (#2519).
drop function if exists public.work_order_cost_amounts(uuid);
drop function if exists public.work_order_cost_amounts_unpriced(uuid);
