-- 0094_clickup_sweep_cron.sql — pg_cron registration for the ClickUp reconciliation sweep
-- (Slice D, FR-CUA-045/048, AC-CUA-043/044). ADR-0055 §3: webhooks for latency, sweep for truth.
--
-- LEAST-PRIVILEGE via Supabase Vault + a DEDICATED sweep secret (NOT the master service_role key),
-- mirroring migration 0082_automation_dispatch_vault.sql EXACTLY (the corrected Vault pattern). The
-- tick reads the target URL + a narrow `clickup_sweep_secret` from Vault (encrypted, access-controlled)
-- and presents that secret to clickup-sweep, which validates it via its CLICKUP_SWEEP_SECRET function
-- env (constant-time). The master SUPABASE_SERVICE_ROLE_KEY NEVER lives in the DB — it stays only in
-- the clickup-sweep function env, used solely to mint the service-role client that applies mirror
-- writes (deputy invariant, NFR-AAN-SEC-001). A leaked sweep secret can at worst trigger a tick (which
-- only reconciles ClickUp changes into the read-model, RLS-org-scoped on read), never grant DB access.
--
-- This supersedes the original (pre-renumber) 0092 shape that put `app.settings.service_role_key` (the MASTER
-- service_role key) in a DB GUC — a Vault-pattern regression (security-audit HIGH). NO master key in
-- the DB, ever.
--
-- Vault secrets are DATA, created per-environment at enable-time (NEVER committed), e.g.:
--   select vault.create_secret('<clickup-sweep-fn-url>', 'clickup_sweep_url');
--   select vault.create_secret('<random-sweep-secret>', 'clickup_sweep_secret');
-- Until those rows exist, the helper below reads NULL and does nothing — a harmless no-op (identical
-- fail-safe to the old unset-GUC behavior). Registration only; the fire is live-verified in a deployed
-- environment. (The clickup-sweep fn env must ALSO set CLICKUP_SWEEP_SECRET to the same value, plus its
-- existing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CLICKUP_API_TOKEN — two Vault secrets + fn env.)
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback:
--   select cron.unschedule('clickup-sweep-tick');
--   drop function if exists public.clickup_sweep_tick();
--
-- Schedule: every 5 minutes — conservative, well within ClickUp's ~100 req/min free-tier budget
-- (NFR-CUA-PERF-001). The sweep rate-limits itself (ClickUpRateLimiter, bulk lane) and is a no-op
-- for non-employing orgs, so the schedule is safe at rest.
--
-- pg_cron / pg_net caveat (mirrors 0082/0048): `cron.schedule()` is idempotent and MUST succeed in
-- `supabase db reset` (the pgTAP env). The job body's `net.http_post` reads Vault secrets that are
-- absent in CI/local-dev until an operator creates them — the helper no-ops when either is NULL.
-- Registration (the `cron.job` row) is the DB-layer fact; the job's actual fire against a real edge fn
-- URL is live-verified only in a deployed environment, never in CI.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Null-safe sweep helper: reads url + a DEDICATED sweep secret from Vault and posts to clickup-sweep
-- ONLY when both are present. security definer so it runs as the (privileged) owner that can read
-- vault.decrypted_secrets; locked down (revoke from public) so only the cron/owner can invoke it.
create or replace function public.clickup_sweep_tick()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'clickup_sweep_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'clickup_sweep_secret';
  if v_url is not null and v_url <> '' and v_secret is not null and v_secret <> '' then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  end if;
end;
$$;

revoke all on function public.clickup_sweep_tick() from public;

-- Reschedule the tick (cron.schedule upserts by name) to run the guarded helper every 5 minutes.
select cron.schedule('clickup-sweep-tick', '*/5 * * * *', 'select public.clickup_sweep_tick()');
