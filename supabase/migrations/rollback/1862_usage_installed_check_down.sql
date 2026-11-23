-- Reverses 1862_usage_installed_check.sql. The recorded installed-material warnings are removed with their table.
drop trigger if exists stock_documents_zz_usage_check on public.stock_documents;
drop function if exists public.usage_check_stock_trigger();
drop trigger if exists daily_site_reports_zz_usage_check on public.daily_site_reports;
drop function if exists public.usage_check_report_trigger();
drop function if exists public.usage_check_safe(uuid);
drop function if exists public.usage_check_work_order(uuid);
drop function if exists public.usage_warning_recipient(uuid);
drop function if exists public.usage_installed_qty(uuid, uuid);
-- dropping the table also drops its policies (select and light_account_deny_select)
drop table if exists public.material_installed_usage_alerts;
