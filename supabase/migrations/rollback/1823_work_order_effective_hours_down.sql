-- 1823_work_order_effective_hours_down.sql — reverse 1823.
drop function if exists public.get_work_order_effective_hours(uuid, date, date);
