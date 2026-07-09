-- 0083_telegram_notify_vault.sql
-- Fix + harden the telegram-notify (error-alert drain) pg_cron tick registered in 0071. Same
-- treatment as the automation dispatcher (0082), owner directive 2026-07-09:
--
--   1. AUTH via Supabase Vault + a DEDICATED secret (NOT the master service_role key). The tick reads
--      the target URL and a narrow `telegram_notify_secret` from Vault and presents that secret to
--      telegram-notify (validated via its TELEGRAM_NOTIFY_SECRET function env). The master
--      SUPABASE_SERVICE_ROLE_KEY no longer lives in the DB — it stays only in the function env, used
--      solely for the error_events drain (an infra/ops table, not tenant data).
--
--   2. CADENCE hourly (was every 2 min): the 0071 job read app.settings.telegram_notify_url /
--      app.settings.service_role_key GUCs that were never set on prod → net.http_post(null) failed
--      EVERY tick (prod cron.job_run_details: thousands of runs, 0 succeeded). This retires that path.
--      NOTE: hourly means a prod error alert can be delayed up to ~1h — acceptable per the directive;
--      tighten the cron here if faster alerting is wanted later.
--
-- Vault secrets are DATA, created per-environment at enable-time (NEVER committed), e.g.:
--   select vault.create_secret('<telegram-notify-fn-url>', 'telegram_notify_url');
--   select vault.create_secret('<random-notify-secret>',   'telegram_notify_secret');
-- Until those rows exist, the helper reads NULL and does nothing — a harmless no-op.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Null-safe drain-tick helper: posts to telegram-notify ONLY when url + secret are both present.
-- security definer so it can read vault.decrypted_secrets; locked down (revoke from public) so only
-- the cron/owner can invoke it.
create or replace function public.telegram_notify_tick()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'telegram_notify_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'telegram_notify_secret';
  if v_url is not null and v_url <> '' and v_secret is not null and v_secret <> '' then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret)
    );
  end if;
end;
$$;

revoke all on function public.telegram_notify_tick() from public;

-- Reschedule the tick (cron.schedule upserts by name) to run the guarded helper hourly (top of hour).
select cron.schedule('telegram-notify-tick', '0 * * * *', 'select public.telegram_notify_tick()');
