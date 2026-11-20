-- Rollback of 1030 (#2321): drops the undo function. Safe at any time: it holds no data; the audit events it wrote stay.
drop function if exists public.undo_imported_purchase(text, text, boolean);
