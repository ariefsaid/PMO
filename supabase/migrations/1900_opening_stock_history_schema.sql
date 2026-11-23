-- 1900_opening_stock_history_schema.sql — opening stock with movement history (docs/specs/opening-stock-history.spec.md).
-- Lines of an opening document may carry the movement's own date and a paper reference; an opening records the request that made it,
-- so a re-submitted file is recognised (FR-OSH-006). No new table; every grant stays cost-free (FR-OSH-013).
-- Reversal: rollback/1900_opening_stock_history_schema_down.sql.
alter table public.stock_document_lines add column occurred_on date;
alter table public.stock_document_lines add column reference text check (reference is null or length(reference) <= 100);
grant select (occurred_on, reference) on public.stock_document_lines to authenticated;

alter table public.opening_balances add column client_request_id uuid;
create unique index opening_balances_request_uniq on public.opening_balances (org_id, client_request_id, warehouse_id) where client_request_id is not null;
