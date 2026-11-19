-- Reverses 1004_daily_site_reports.sql. Run 1005's rollback first.
-- The 'site-report-photos' bucket stays: storage refuses direct deletes. Empty and remove it through the
-- Storage API (as for 0247's expense-receipts bucket); its policies are dropped by 1005's rollback.
drop table if exists public.dsr_events;
drop table if exists public.dsr_photos;
drop table if exists public.dsr_consumables;
drop table if exists public.dsr_idle_periods;
drop table if exists public.dsr_progress_lines;
drop table if exists public.daily_site_reports;
drop table if exists public.dsr_weather_conditions;
drop table if exists public.dsr_idle_reasons;
