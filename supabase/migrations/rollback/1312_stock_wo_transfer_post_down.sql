-- 1312_stock_wo_transfer_post_down.sql — reverse 1312.
drop trigger if exists stock_wo_transfers_pair_check on public.stock_wo_transfers;
drop function if exists public.trg_stock_wo_transfer_pair();
drop function if exists public.check_stock_wo_transfer_pair(uuid);
drop function if exists public.post_stock_wo_transfer(jsonb, jsonb, uuid);
