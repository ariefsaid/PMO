-- Reverses 1870_work_order_ahead_alert_settings.sql (1872 and 1873 first).
drop function if exists public.set_work_order_ahead_alert_roles(text[]);
alter table public.work_order_stock_settings drop column if exists ahead_alert_roles;
