-- Reverses 0415_stock_read_rpcs.sql (#1512 S3). Pre-production reversal is also `supabase db reset`.
drop function if exists public.get_stock_ledger(uuid, uuid, uuid, uuid, uuid, date, date, bigint, integer);
drop function if exists public.get_stock_on_hand(uuid, uuid, boolean);
