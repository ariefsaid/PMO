-- Reverses 1277_work_order_revenue_plan_reads.sql (#2671).
drop function if exists public.wo_revenue_plan_vs_actual(uuid, date, date, date);
drop function if exists public.project_revenue_plan_vs_actual(uuid, date);
drop function if exists public.wrp_figures(uuid, date);
drop function if exists public.wrp_org_today(uuid);
