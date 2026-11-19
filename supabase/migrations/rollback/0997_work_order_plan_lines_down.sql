-- Reverses 0997_work_order_plan_lines.sql (#2519).
drop table if exists public.work_order_plan_lines;
drop function if exists public.check_work_order_plan_line();
drop function if exists public.audit_work_order_plan_line();
