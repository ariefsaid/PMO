-- Reverses 1281_work_order_daily_target_reads.sql (#2672).
drop function if exists public.wo_daily_target_vs_actual(uuid, date);
drop function if exists public.wdt_month_summary(uuid, date);
