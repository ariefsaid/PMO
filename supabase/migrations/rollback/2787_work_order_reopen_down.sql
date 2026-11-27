-- Rollback 2787_work_order_reopen.sql (#3024).
drop function if exists public.reopen_work_order(uuid, text);
