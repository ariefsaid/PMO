-- 1323_dsr_post_stock_down.sql — reverse 1323. Ledger documents already posted stay (the ledger is append-only).
drop trigger if exists daily_site_reports_zz_post_stock on public.daily_site_reports;
drop function if exists public.dsr_post_stock_trigger();
drop function if exists public.dsr_post_stock(uuid);
drop function if exists public.dsr_reverse_stock(uuid);
