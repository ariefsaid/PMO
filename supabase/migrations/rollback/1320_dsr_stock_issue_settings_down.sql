-- 1320_dsr_stock_issue_settings_down.sql — reverse 1320 (run after 1321..1324 are reversed).
alter table public.dsr_consumables drop column if exists work_order_line_id;
drop trigger if exists work_orders_zzzzz_site_location on public.work_orders;
drop function if exists public.guard_work_order_site_location();
update public.record_history_config set captured = captured - 'site_warehouse_id' where table_name = 'work_orders';
drop function if exists public.set_work_order_site_location(uuid, uuid);
drop index if exists public.work_orders_site_warehouse_idx;
alter table public.work_orders drop column if exists site_warehouse_id;
alter table public.stock_items drop column if exists consumable;
drop function if exists public.set_dsr_stock_issue(boolean, text);
drop function if exists public.dsr_stock_issue_on(uuid);
alter table public.organizations drop column if exists dsr_stock_issue_items, drop column if exists dsr_stock_issue;
