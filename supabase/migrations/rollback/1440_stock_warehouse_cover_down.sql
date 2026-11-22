-- rollback/1440_stock_warehouse_cover_down.sql
-- #2694 reversal: drop the recorded site cover from stock locations.
alter table public.stock_warehouses drop constraint if exists stock_warehouses_cover_value_check;
alter table public.stock_warehouses drop column if exists cover_value;
