-- 1311_stock_wo_transfer_available_down.sql — reverse 1311.
drop function if exists public.get_work_order_returnable(uuid);
drop function if exists public.stock_wo_issue_sources(uuid, uuid, uuid);
