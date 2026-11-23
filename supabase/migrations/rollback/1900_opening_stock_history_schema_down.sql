-- 1900_opening_stock_history_schema_down.sql — reverses 1900. Run only with no opening history loaded (the columns would be dropped with their data).
drop index if exists public.opening_balances_request_uniq;
alter table public.opening_balances drop column if exists client_request_id;
revoke select (occurred_on, reference) on public.stock_document_lines from authenticated;
alter table public.stock_document_lines drop column if exists reference;
alter table public.stock_document_lines drop column if exists occurred_on;
