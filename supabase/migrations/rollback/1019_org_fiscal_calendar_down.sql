-- Rollback of 1019_org_fiscal_calendar.sql. Apply 1019's rollback first (its functions call these).
drop function if exists public.get_pmo_fiscal_calendar(uuid);
drop function if exists public.set_org_fiscal_year_start_month(integer);
drop function if exists public.get_org_fiscal_year_setting();
drop function if exists public.org_pmo_fiscal_start_month();
drop function if exists public.pmo_fiscal_year_by_name(text, integer);
drop function if exists public.pmo_fiscal_year_for_date(date, integer);
alter table public.organizations drop column if exists fiscal_year_start_month;
