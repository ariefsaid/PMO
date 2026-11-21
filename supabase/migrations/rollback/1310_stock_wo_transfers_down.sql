-- 1310_stock_wo_transfers_down.sql — reverse 1310. 1312 and 1313 objects and any posted work-order transfer must be gone first.
drop trigger if exists stock_documents_zz_wo_transfer on public.stock_documents;
drop function if exists public.guard_stock_document_wo_transfer();
drop index if exists public.stock_documents_wo_transfer_idx;
alter table public.stock_documents drop column if exists wo_transfer_id;
drop trigger if exists stock_wo_transfers_guard on public.stock_wo_transfers;
drop function if exists public.guard_stock_wo_transfer();
drop table if exists public.stock_wo_transfers;
