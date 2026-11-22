-- Reverses 1872_work_order_ahead_alert_check.sql (1873 first: it uses the recipients function).
drop trigger if exists work_order_stock_settings_ahead_alert_ins on public.work_order_stock_settings;
drop trigger if exists work_order_stock_settings_ahead_alert_upd on public.work_order_stock_settings;
drop trigger if exists work_order_acceptances_ahead_alert on public.work_order_acceptances;
drop trigger if exists daily_site_reports_ahead_alert on public.daily_site_reports;
drop trigger if exists stock_documents_ahead_alert on public.stock_documents;
drop function if exists public.wo_material_alerts_backfill();
drop function if exists public.wo_material_alert_threshold_trg();
drop function if exists public.wo_material_alert_trg();
drop function if exists public.wo_material_alert_check(uuid, boolean);
drop function if exists public.wo_material_alert_recipients(uuid);
