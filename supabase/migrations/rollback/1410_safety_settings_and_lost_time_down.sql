-- Reverses 1410_safety_settings_and_lost_time.sql. Run 1411..1414 rollbacks first.
drop trigger if exists incident_reports_zz_lost_time_guard on public.incident_reports;
drop function if exists public.guard_incident_lost_time();
alter table public.incident_reports drop column if exists lost_time;
drop table if exists public.safety_list_items;
drop function if exists public.set_safety_records_enabled(boolean);
drop function if exists public.safety_records_enabled();
alter table public.organizations drop column if exists safety_records_enabled;
