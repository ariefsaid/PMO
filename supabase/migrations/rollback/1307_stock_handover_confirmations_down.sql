-- 1307_stock_handover_confirmations_down.sql — reverse 1307 (confirmations and their photos are lost).
drop policy if exists storage_stock_handover_insert on storage.objects;
drop policy if exists storage_stock_handover_read on storage.objects;
delete from storage.objects where bucket_id = 'stock-handover';
delete from storage.buckets where id = 'stock-handover';
drop function if exists public.stock_handover_readable(text);
drop function if exists public.stock_can_handover(text);
drop table if exists public.stock_handover_confirmations;
drop function if exists public.guard_stock_handover_object();
drop function if exists public.guard_stock_handover_immutable();
