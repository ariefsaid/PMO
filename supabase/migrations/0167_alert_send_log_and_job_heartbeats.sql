-- 0167_alert_send_log_and_job_heartbeats.sql
-- Alerting hardening (docs/specs/observability-analytics.spec.md §4.2/§4.3, FR-HRD-001/002/010).
--
-- WHY alert_send_log: telegram-notify derived its cooldown from error_events.notified_at
-- (index.ts:57-66, "where notified_at IS NOT NULL"). When the notified_at UPDATE failed — silently,
-- because supabase-js RESOLVES with `error` populated and index.ts:96-100 discarded the result — the
-- code was never considered recently-notified, so the cooldown could not suppress the re-send and the
-- drain re-alerted the same group every tick, forever. Writing the send record AHEAD of the send, to
-- a table that is not the one being stamped, makes the cooldown hold regardless of stamp success.
--
-- WHY ops_job_heartbeats: "no errors occurred" and "the alert path is broken" both present as silence
-- (FR-HRD-010). This is the 0071 cron lesson generalised — 0071's telegram-notify-tick ran thousands
-- of times with ZERO successes in production because its GUCs were never set, and nobody noticed until
-- 0083 replaced it. A schedule existing is not a schedule working.
--
-- Both tables are ops bookkeeping, NOT tenant business data — same posture as error_events (0071) and
-- agent_dispatch_watermarks (ADR-0046): RLS enabled + forced with ZERO policies, service_role only.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback:
--   drop table if exists public.alert_send_log;
--   drop table if exists public.ops_job_heartbeats;

create table public.alert_send_log (
  error_code   text primary key,
  last_sent_at timestamptz not null,
  send_count   integer not null default 1 check (send_count >= 0)
);
comment on table public.alert_send_log is
  'Write-ahead record of Telegram alert sends, keyed by error_code. Written BEFORE the send so the '
  'cooldown holds even when the error_events.notified_at stamp fails (FR-HRD-001/002). Service_role only.';

create table public.ops_job_heartbeats (
  job_name        text primary key,
  last_success_at timestamptz not null,
  last_detail     jsonb
);
comment on table public.ops_job_heartbeats is
  'Last successful run per ops job (telegram-notify drain, error-events purge). Distinguishes '
  '"nothing happened" from "the job is broken" (FR-HRD-010, FR-OBS-020). Service_role only.';

alter table public.alert_send_log      enable row level security;
alter table public.alert_send_log      force  row level security;
alter table public.ops_job_heartbeats  enable row level security;
alter table public.ops_job_heartbeats  force  row level security;

-- DELIBERATELY NO policy of any kind → default-deny to authenticated and anon.
revoke all on public.alert_send_log     from authenticated;
revoke all on public.alert_send_log     from anon;
revoke all on public.ops_job_heartbeats from authenticated;
revoke all on public.ops_job_heartbeats from anon;
