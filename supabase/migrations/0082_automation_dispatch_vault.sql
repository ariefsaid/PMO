-- 0082_automation_dispatch_vault.sql
-- Least-privilege automation dispatch (owner directive 2026-07-09). Supersedes the pg_cron tick
-- registered in 0048 with two changes:
--
--   1. AUTH via Supabase Vault + a DEDICATED dispatch secret (NOT the master service_role key).
--      The tick now reads the target URL and a narrow `agent_dispatch_secret` from Vault
--      (encrypted, access-controlled) and presents that secret to agent-dispatch, which validates
--      it via its AGENT_DISPATCH_SECRET function env. The master SUPABASE_SERVICE_ROLE_KEY NEVER
--      lives in the DB anymore — it stays only in the agent-dispatch function env, used solely to
--      mint owner JWTs (deputy invariant, NFR-AAN-SEC-001). A leaked dispatch secret can at worst
--      trigger a tick (which only fires DUE automations under THEIR owners, RLS-scoped), never
--      grant DB access.
--
--   2. CADENCE hourly (was every minute): ~43k -> ~720 edge-fn invocations/month, trivial against the
--      Free-tier 500k. Automations are daily/weekly/day-of-month (all at hour boundaries), so an
--      hourly tick catches every schedule.
--
-- Vault secrets are DATA, created per-environment at enable-time (NEVER committed), e.g.:
--   select vault.create_secret('<agent-dispatch-fn-url>', 'agent_dispatch_url');
--   select vault.create_secret('<random-dispatch-secret>', 'agent_dispatch_secret');
-- Until those rows exist, the helper below reads NULL and does nothing — a harmless no-op
-- (identical fail-safe to the old unset-GUC behavior). Registration only; the fire is live-verified
-- in a deployed environment.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Null-safe dispatch helper: reads url + dispatch secret from Vault and posts to agent-dispatch
-- ONLY when both are present. security definer so it runs as the (privileged) owner that can read
-- vault.decrypted_secrets; locked down (revoke from public) so only the cron/owner can invoke it.
create or replace function public.agent_dispatch_tick()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'agent_dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'agent_dispatch_secret';
  if v_url is not null and v_url <> '' and v_secret is not null and v_secret <> '' then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret)
    );
  end if;
end;
$$;

revoke all on function public.agent_dispatch_tick() from public;

-- Reschedule the tick (cron.schedule upserts by name) to run the guarded helper hourly (top of hour).
select cron.schedule('agent-dispatch-tick', '0 * * * *', 'select public.agent_dispatch_tick()');
