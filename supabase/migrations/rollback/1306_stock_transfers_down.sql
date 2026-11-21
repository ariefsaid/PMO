-- 1306_stock_transfers_down.sql — reverse 1306. Remove (or never create) two-step transfers first.
drop view if exists public.stock_transit_reconciliation;
drop trigger if exists stock_documents_zz_one_step on public.stock_documents;
drop function if exists public.guard_stock_document_one_step();
drop index if exists public.stock_documents_two_step_idx;
alter table public.stock_documents drop column if exists two_step_id;
drop table if exists public.stock_transfer_lines;
drop table if exists public.stock_transfers;
drop function if exists public.guard_stock_transfer_line();
drop function if exists public.guard_stock_transfer();
