-- Rollback of 1375_billing_plan_settings.sql: drops the writers, then the two settings tables (settings only; no claim or invoice is touched).
drop function if exists public.set_billing_plan_month_target(date, numeric);
drop function if exists public.set_billing_plan_settings(numeric, text, boolean);
drop table if exists public.billing_plan_month_targets;
drop table if exists public.org_billing_plan_settings;
