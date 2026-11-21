-- 1225_scheduled_reports_tables.sql — #2714: scheduled reports by email.
-- An organisation-defined record (kind, frequency, weekday, local send time, recipients) plus a run record that makes each
-- (report, period) fire once. The #2711 outbox is reused: a row now has exactly one source, a notification or a report period.
-- Nothing is seeded: with no report, no run and no outbox row exists and nothing changes.
-- Reverse: rollback/1225_scheduled_reports_tables_down.sql

create table public.scheduled_reports (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  name               text not null check (char_length(btrim(name)) between 1 and 120),
  kind               text not null check (kind in ('daily_progress','overdue_tasks')),
  frequency          text not null check (frequency in ('daily','weekly')),
  weekday            smallint check (weekday between 1 and 7),          -- ISO: 1 = Monday
  send_time          time not null,                                      -- local time in the organisation's timezone
  recipient_user_ids uuid[] not null default '{}',
  recipient_roles    text[] not null default '{}',
  enabled            boolean not null default true,
  archived_at        timestamptz,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint scheduled_reports_weekday check ((frequency = 'weekly') = (weekday is not null)),
  constraint scheduled_reports_recipients check (cardinality(recipient_user_ids) + cardinality(recipient_roles) between 1 and 50)
);
create index scheduled_reports_due_idx on public.scheduled_reports (org_id) where enabled and archived_at is null;

create table public.scheduled_report_runs (
  report_id  uuid not null references public.scheduled_reports(id) on delete cascade,
  period_key text not null,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  queued     integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (report_id, period_key)
);

alter table public.email_outbox alter column notification_id drop not null;
alter table public.email_outbox
  add column report_id  uuid references public.scheduled_reports(id) on delete cascade,
  add column period_key text,
  add column subject    text,
  add column body       text;
alter table public.email_outbox
  add constraint email_outbox_one_source check (
    (notification_id is not null and report_id is null and period_key is null)
    or (notification_id is null and report_id is not null and period_key is not null and subject is not null));
create unique index email_outbox_report_period_recipient on public.email_outbox (report_id, period_key, recipient_id)
  where report_id is not null;

alter table public.scheduled_reports     enable row level security;
alter table public.scheduled_reports     force row level security;
alter table public.scheduled_report_runs enable row level security;
alter table public.scheduled_report_runs force row level security;
revoke all on public.scheduled_reports, public.scheduled_report_runs from public, anon, authenticated;
grant select on public.scheduled_reports to authenticated;   -- Admin only, by the policy; writes go through 1228
grant all on public.scheduled_reports, public.scheduled_report_runs to service_role;

create policy scheduled_reports_admin_read on public.scheduled_reports for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.auth_role()) = 'Admin' and (select public.is_active_member()));
