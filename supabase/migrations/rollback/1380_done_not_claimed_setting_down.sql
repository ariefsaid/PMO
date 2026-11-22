-- Rollback of 1380_done_not_claimed_setting.sql (run after rollback/1381): drops the writer, the stamp table and the day-limit column.
drop function if exists public.set_billing_plan_reminder(boolean, integer);
drop table if exists public.done_not_claimed_notices;
alter table public.org_billing_plan_settings drop column if exists done_not_claimed_after_days;
