-- Reverses 1275_work_order_revenue_plan.sql (#2671).
drop function if exists public.set_revenue_plan_settings(boolean, smallint[]);
drop table if exists public.work_order_revenue_plan;
drop table if exists public.org_revenue_plan_settings;
drop function if exists public.org_is_working_day(uuid, date);
drop function if exists public.revenue_plan_enabled(uuid);
