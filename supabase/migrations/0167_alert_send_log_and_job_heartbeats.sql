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
-- WHY delivered_at (2026-07-28 review, C1 — BLOCKING): the write-ahead alone converts alert-SPAM
-- into alert-LOSS. last_sent_at is written BEFORE the send, so it is already recent by the time a
-- FAILED send's group is re-selected on the next tick — the group is now "suppressed" by its own
-- write-ahead. The suppressed branch used to stamp notified_at unconditionally, so a send that never
-- reached Telegram was marked notified and never retried. delivered_at is written ONLY after a
-- CONFIRMED successful send; a suppressed group may only stamp notified_at when the attempt that
-- suppressed it was actually delivered. An undelivered suppressed group stays unnotified and un-
-- stamped until the cooldown lapses naturally, at which point it is no longer suppressed and retries.
--
-- WHY ops_job_heartbeats (last_run_at / last_outbound_at split, 2026-07-28 review, I4): the original
-- single last_success_at column was written ONLY when a message actually went out, so a healthy-but-
-- quiet drain and a drain that has stopped running altogether wrote IDENTICAL stale rows — exactly
-- the pair FR-HRD-010 exists to separate. last_run_at is written UNCONDITIONALLY at the end of every
-- completed tick (the "the job ran" signal); last_outbound_at is written only when a message actually
-- left for Telegram (the signal the staleness/liveness check reads). This is the 0071 cron lesson
-- generalised — 0071's telegram-notify-tick ran thousands of times with ZERO successes in production
-- because its GUCs were never set, and nobody noticed until 0083 replaced it. A schedule existing is
-- not a schedule working, and neither is a heartbeat column that only updates on success.
--
-- Both tables are ops bookkeeping, NOT tenant business data — same posture as error_events (0071) and
-- agent_dispatch_watermarks (ADR-0046): RLS enabled + forced with ZERO policies, service_role only.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback:
--   drop index if exists public.error_events_unnotified_idx;
--   drop table if exists public.alert_send_log;
--   drop table if exists public.ops_job_heartbeats;

create table public.alert_send_log (
  error_code   text primary key,
  last_sent_at timestamptz not null,
  delivered_at timestamptz
);
comment on table public.alert_send_log is
  'Write-ahead record of Telegram alert attempts, keyed by error_code. last_sent_at is written '
  'BEFORE the send so the re-alert cooldown holds even when the error_events.notified_at stamp '
  'fails (FR-HRD-001/002). delivered_at is written ONLY after a CONFIRMED successful send — a '
  'suppressed group may stamp notified_at only when the attempt that suppressed it actually '
  'delivered, or a send that fails after the write-ahead would be marked notified without ever '
  'reaching Telegram (C1 hardening, 2026-07-28 review). Service_role only.';

create table public.ops_job_heartbeats (
  job_name         text primary key,
  last_run_at      timestamptz not null,
  last_outbound_at timestamptz,
  last_detail      jsonb
);
comment on table public.ops_job_heartbeats is
  'Per-ops-job liveness bookkeeping (telegram-notify drain, error-events purge). last_run_at is '
  'written UNCONDITIONALLY at the end of every completed tick — the "the job ran" signal. '
  'last_outbound_at is written only when a message actually left for Telegram (a real alert or the '
  'liveness all-clear) — the signal FR-HRD-010''s staleness check reads. Splitting these two columns '
  'is what actually distinguishes "nothing happened" from "the job is broken" (I4 hardening, '
  '2026-07-28 review) — a single last_success_at column, written only on outbound, made a healthy '
  'quiet drain and a dead one write IDENTICAL stale rows.';

alter table public.alert_send_log      enable row level security;
alter table public.alert_send_log      force  row level security;
alter table public.ops_job_heartbeats  enable row level security;
alter table public.ops_job_heartbeats  force  row level security;

-- DELIBERATELY NO policy of any kind → default-deny to authenticated and anon.
revoke all on public.alert_send_log     from authenticated;
revoke all on public.alert_send_log     from anon;
revoke all on public.ops_job_heartbeats from authenticated;
revoke all on public.ops_job_heartbeats from anon;

-- M4 (perf, 2026-07-28 review): the drain's unnotified-rows query filters notified_at IS NULL with
-- no LIMIT; the only existing index on error_events (0071, error_code-led) doesn't serve an
-- error_code-agnostic predicate. Without this partial index the query is O(table) and one storm can
-- load the whole table into the worker every 2 minutes.
create index error_events_unnotified_idx
  on public.error_events (created_at)
  where notified_at is null;
