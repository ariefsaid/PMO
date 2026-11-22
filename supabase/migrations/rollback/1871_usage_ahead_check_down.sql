-- Reverses 1871_usage_ahead_check.sql (1872 first). Open ahead-of-progress rows are removed with 1870's rollback.
drop trigger if exists work_order_stock_settings_ahead_upd on public.work_order_stock_settings;
drop trigger if exists work_order_stock_settings_ahead_ins on public.work_order_stock_settings;
drop trigger if exists work_order_acceptances_zz_ahead_check on public.work_order_acceptances;
drop trigger if exists daily_site_reports_zz_ahead_check on public.daily_site_reports;
drop trigger if exists stock_documents_zz_ahead_check on public.stock_documents;
drop function if exists public.usage_ahead_backfill();
drop function if exists public.usage_ahead_threshold_trigger();
drop function if exists public.usage_ahead_trigger();
drop function if exists public.usage_ahead_check_safe(uuid);
drop function if exists public.usage_ahead_check_work_order(uuid, boolean);
drop function if exists public.usage_ahead_recipient(uuid);
