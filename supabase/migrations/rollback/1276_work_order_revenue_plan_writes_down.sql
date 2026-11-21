-- Reverses 1276_work_order_revenue_plan_writes.sql (#2671).
drop function if exists public.wo_revenue_plan_set_day(uuid, date, numeric);
drop function if exists public.wo_revenue_plan_set_month(uuid, date, numeric, boolean);
drop function if exists public.wo_revenue_plan_clear(uuid, date, date);
drop function if exists public.wrp_audit(public.work_orders, text, jsonb);
drop function if exists public.wrp_check_amount(numeric);
drop function if exists public.wrp_writable_work_order(uuid);
