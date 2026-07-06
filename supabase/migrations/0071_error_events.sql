-- 0071_error_events.sql — durable operator-telemetry sink for the Telegram alert
-- webhook (observability floor, spec docs/specs/observability-floor.spec.md,
-- FR-OF-001..009, NFR-OF-SEC-001). Append-only; RLS enabled+forced with NO policy —
-- service-role-only by omission, the SAME posture as agent_dispatch_watermarks
-- (ADR-0046): this is operator/ops bookkeeping, not tenant business data, so there
-- is deliberately no org_id-scoped policy (org_id is carried as an OPTIONAL nullable
-- column for cross-reference only, never used to scope a policy — there is none).
--
-- Reversibility (pre-production, ADR-0006): supabase db reset. Manual rollback:
--   select cron.unschedule('telegram-notify-tick');
--   drop index if exists public.error_events_code_notified_idx;
--   drop table if exists public.error_events;

create table public.error_events (
  id           uuid primary key default gen_random_uuid(),
  fn           text not null,
  error_code   text not null,
  context_id   text,
  org_id       uuid,
  created_at   timestamptz not null default now(),
  notified_at  timestamptz
);

-- Drain fast path (NFR-OF-PERF-001): the drain's two queries are
-- "unnotified rows" (notified_at IS NULL) and "MAX(notified_at) GROUP BY error_code
-- WHERE notified_at IS NOT NULL" — this composite index serves both.
create index error_events_code_notified_idx
  on public.error_events (error_code, notified_at, created_at);

alter table public.error_events enable row level security;
alter table public.error_events force row level security;
-- Intentionally NO policy — default-deny to every ordinary JWT role (authenticated,
-- anon). Only service_role (which bypasses RLS by Postgres/Supabase design) reads or
-- writes this table: recordErrorEvent() inserts, telegram-notify reads+updates.

-- ── pg_cron drain tick (FR-OF-004), every 2 minutes. Idempotent registration; the
-- job body's net.http_post reads app.settings.telegram_notify_url /
-- app.settings.service_role_key GUCs that are UNSET in CI/local-dev by default —
-- net.http_post queues a request that never resolves in that case (identical,
-- documented no-op behavior to 0048_agent_automations_notifications.sql's
-- agent-dispatch-tick job). Registration only; the real fire is live-verified in a
-- deployed environment (NFR-OF-RUN-001).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'telegram-notify-tick', '*/2 * * * *',
  $$ select net.http_post(
       url := current_setting('app.settings.telegram_notify_url', true),
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
     ); $$
);
