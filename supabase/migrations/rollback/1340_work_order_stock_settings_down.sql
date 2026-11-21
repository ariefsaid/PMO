-- Reverses 1340_work_order_stock_settings.sql (1341 first).
drop function if exists public.set_work_order_issue_threshold(numeric);
drop table if exists public.work_order_stock_settings;
