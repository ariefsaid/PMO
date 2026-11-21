-- Reverse of 1225. Report rows in the outbox go with their report; the notification-only shape is restored.
delete from public.email_outbox where report_id is not null;
drop index if exists public.email_outbox_report_period_recipient;
alter table public.email_outbox drop constraint if exists email_outbox_one_source;
alter table public.email_outbox drop column if exists report_id, drop column if exists period_key,
  drop column if exists subject, drop column if exists body;
alter table public.email_outbox alter column notification_id set not null;
drop table if exists public.scheduled_report_runs;
drop table if exists public.scheduled_reports;
