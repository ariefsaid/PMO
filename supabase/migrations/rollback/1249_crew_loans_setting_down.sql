-- Rollback of 1249_crew_loans_setting.sql.
drop function if exists public.set_org_crew_loans_enabled(boolean);
alter table public.organizations drop column if exists crew_loans_enabled;
