-- Reverse of 1026_m365_org_app_status.sql (#2260): drops the service-only read.
-- No data is touched: the values live in m365_org_apps (0817) and stay.
drop function if exists public.m365_org_app_status(uuid);
