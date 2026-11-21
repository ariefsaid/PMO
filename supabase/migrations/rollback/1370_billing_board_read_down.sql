-- Rollback of 1370_billing_board_read.sql: the board read only; no data is touched.
drop function if exists public.billing_board(uuid);
