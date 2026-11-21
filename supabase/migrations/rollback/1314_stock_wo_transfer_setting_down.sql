-- 1314_stock_wo_transfer_setting_down.sql — reverse 1314.
drop function if exists public.set_stock_wo_transfers(boolean);
drop function if exists public.stock_wo_transfers_on(uuid);
alter table public.organizations drop column if exists stock_wo_transfers;
