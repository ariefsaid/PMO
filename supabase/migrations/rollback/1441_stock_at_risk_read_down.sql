-- rollback/1441_stock_at_risk_read_down.sql
-- #2694 reversal: drop the stock-at-risk read RPC (a pure read; nothing stored).
drop function if exists public.get_stock_at_risk();
