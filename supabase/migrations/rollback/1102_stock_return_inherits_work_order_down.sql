-- Reverse of 1102.
drop trigger if exists stock_document_lines_return_work_order on public.stock_document_lines;
drop function if exists public.stock_returns_inherit_work_order();
