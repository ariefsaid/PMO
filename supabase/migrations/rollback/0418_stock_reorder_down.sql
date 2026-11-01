-- Rollback for 0418_stock_reorder.sql (#1512 S6): functions first, then the params function, then the table.
drop function if exists public.get_stock_below_reorder();
drop function if exists public.get_reorder_suggestions(uuid, uuid);
drop function if exists public.set_stock_reorder_level(uuid, uuid, numeric, numeric);
drop function if exists public.stock_reorder_params();
drop table if exists public.stock_reorder_levels;
