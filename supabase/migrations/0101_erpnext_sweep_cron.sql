-- 0101_erpnext_sweep_cron.sql — ERPNext P2, Slice 8, task 8.7 (AC-ENA-071, ADR-0055 §3).
-- pg_cron registration for the erpnext-sweep reconciliation tick (the convergence authority that
-- catches webhook gaps + runs the ADR-0058 §Consequences outbox recovery pass). Mirrors migration
-- 0094_clickup_sweep_cron.sql's corrected Vault pattern EXACTLY.
--
-- LEAST-PRIVILEGE via Supabase Vault + a DEDICATED sweep secret (NOT the master service_role key),
-- mirroring 0082_automation_dispatch_vault.sql / 0094 EXACTLY. The tick reads the target URL + a
-- narrow `erpnext_sweep_secret` from Vault (encrypted, access-controlled) and presents that secret to
-- erpnext-sweep, which validates it via its ERPNEXT_SWEEP_SECRET function env (constant-time). The
-- master SUPABASE_SERVICE_ROLE_KEY NEVER lives in the DB — it stays only in the erpnext-sweep function
-- env, used solely to mint the service-role client that applies mirror writes + runs the outbox
-- recovery. A leaked sweep secret can at worst trigger a tick (which only reconciles ERPNext changes
-- into the read-model + recovers outbox rows, RLS-org-scoped on read), never grant DB access.
--
-- Vault secrets are DATA, created per-environment at enable-time (NEVER committed), e.g.:
--   select vault.create_secret('<erpnext-sweep-fn-url>', 'erpnext_sweep_url');
--   select vault.create_secret('<random-sweep-secret>', 'erpnext_sweep_secret');
-- Until those rows exist, the helper below reads NULL and does nothing — a harmless no-op (identical
-- fail-safe to 0094 / the old unset-GUC behavior). Registration only; the fire is live-verified in a
-- deployed environment. (The erpnext-sweep fn env must ALSO set ERPNEXT_SWEEP_SECRET to the same value,
-- plus its existing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY + the per-org ERPNext API creds via
-- external_org_bindings.secret_ref — two Vault secrets + fn env.)
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback:
--   select cron.unschedule('erpnext-sweep-tick');
--   drop function if exists public.erpnext_sweep_tick();
--
-- Schedule: every 5 minutes — mirrors 0094 (conservative; the sweep is a no-op for non-employing
-- orgs, so the schedule is safe at rest). The sweep rate-limits its ERP reads (the per-org client) and
-- runs outbox recovery + the ledger-mirror feed + accounting refresh per employing org
-- (NFR-ENA-PERF-001 — interactive priority over bulk is the sweep's own discipline).
--
-- pg_cron / pg_net caveat (mirrors 0094/0082): `cron.schedule()` is idempotent and MUST succeed in
-- `supabase db reset` (the pgTAP env). The job body's `net.http_post` reads Vault secrets that are
-- absent in CI/local-dev until an operator creates them — the helper no-ops when either is NULL.
-- Registration (the `cron.job` row) is the DB-layer fact; the job's actual fire against a real edge fn
-- URL is live-verified only in a deployed environment, never in CI.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Null-safe sweep helper: reads url + a DEDICATED sweep secret from Vault and posts to erpnext-sweep
-- ONLY when both are present. security definer so it runs as the (privileged) owner that can read
-- vault.decrypted_secrets; locked down (revoke from public) so only the cron/owner can invoke it.
create or replace function public.erpnext_sweep_tick()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'erpnext_sweep_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'erpnext_sweep_secret';
  if v_url is not null and v_url <> '' and v_secret is not null and v_secret <> '' then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  end if;
end;
$$;

revoke all on function public.erpnext_sweep_tick() from public;

-- Reschedule the tick (cron.schedule upserts by name) to run the guarded helper every 5 minutes.
select cron.schedule('erpnext-sweep-tick', '*/5 * * * *', 'select public.erpnext_sweep_tick()');
