-- rollback/1210_phone_clock_in_area_down.sql
drop function if exists public.set_phone_check_in_supervisor_role(text);
drop function if exists public.get_phone_check_in_supervisor_role();
alter table public.organizations drop column if exists phone_check_in_supervisor_role;
alter table public.work_orders drop constraint if exists work_orders_area_all_or_none;
alter table public.work_orders drop column if exists area_radius_m, drop column if exists area_lng, drop column if exists area_lat;
