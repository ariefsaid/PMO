-- 0258_alert_send_log_org_key.sql
-- Give the Telegram alert write-ahead log an independent key per organization and error code.
-- Existing entries remain in the nullable global scope; no organization is inferred retroactively.
alter table public.alert_send_log
  add column id uuid not null default gen_random_uuid(),
  add column org_id uuid references public.organizations(id) on delete cascade;

alter table public.alert_send_log
  drop constraint alert_send_log_pkey,
  add constraint alert_send_log_pkey primary key (id),
  add constraint alert_send_log_org_id_error_code_key unique nulls not distinct (org_id, error_code);

create index alert_send_log_error_code_idx on public.alert_send_log (error_code);

comment on table public.alert_send_log is
  'Write-ahead record of Telegram alert attempts, keyed by (org_id, error_code). A NULL org_id is '
  'the distinct global scope for error events without organization metadata. last_sent_at is written '
  'BEFORE the send so the re-alert cooldown holds even when the error_events.notified_at stamp fails. '
  'delivered_at is written ONLY after a CONFIRMED successful send; a suppressed group may stamp '
  'notified_at only when the attempt that suppressed it actually delivered. Service_role only.';
