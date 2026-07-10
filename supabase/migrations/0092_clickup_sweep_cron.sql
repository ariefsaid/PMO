-- 0092_clickup_sweep_cron.sql — pg_cron registration for the ClickUp reconciliation sweep
-- (Slice D, FR-CUA-045/048, AC-CUA-043/044). ADR-0055 §3: webhooks for latency, sweep for truth.
--
-- REGISTERED-BUT-IDLE, exactly following migration 0048's precedent (Director ruling): the cron job
-- is *registered* here (a `cron.job` row exists), but its *body* reads Postgres GUCs that are NOT set
-- by default — so the job fires as a NO-OP until an operator configures them. No org is employing
-- ClickUp at rest (P1 is flag-off / mocked-only), so even if the GUCs were set, the sweep iterates
-- zero employing orgs and applies nothing. Reversibility (pre-production, ADR-0006): `supabase db
-- reset`. Manual rollback: `select cron.unschedule('clickup-sweep-tick');`.
--
-- pg_cron / pg_net caveat (mirrors 0048): `cron.schedule()` is idempotent and MUST succeed in
-- `supabase db reset` (the pgTAP env). The job body's `net.http_post` reads GUCs that are unset in
-- CI/local-dev — net.http_post tolerates unset GUCs by queuing a request that never resolves (a
-- no-op in the test DB). Registration (the `cron.job` row) is the DB-layer fact; the job's actual
-- fire against a real edge fn URL is live-verified only in a deployed environment, never in CI.
--
-- Schedule: every 5 minutes — conservative, well within ClickUp's ~100 req/min free-tier budget
-- (NFR-CUA-PERF-001). The sweep rate-limits itself (ClickUpRateLimiter, bulk lane) and is a no-op
-- for non-employing orgs, so the schedule is safe at rest.
--
-- To activate (operator, per deployment): set the GUCs the body reads, e.g.
--   alter database postgres set app.settings.clickup_sweep_url =
--     'https://<project-ref>.supabase.co/functions/v1/clickup-sweep';
--   alter database postgres set app.settings.service_role_key = '<service-role-key>';
-- (the service_role_key GUC is the bearer clickup-sweep self-verifies). Until both are set, the job
-- is idle.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'clickup-sweep-tick', '*/5 * * * *',
  $$ select net.http_post(
       url := current_setting('app.settings.clickup_sweep_url', true),
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
         'Content-Type', 'application/json'
       ),
       body := '{}'::jsonb
     ); $$
);
