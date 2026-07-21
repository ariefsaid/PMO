-- 0143_clickup_webhook_inbox.sql — the durable ClickUp webhook-ingress queue (OD-INT-11 fix,
-- 2026-07-20). ClickUp's REAL webhook envelope (live-verified, 7/7 real deliveries) carries only
-- {event, task_id, team_id, webhook_id, history_items} — NO task body, NO date_updated, NO list_id.
-- `clickup-webhook` can therefore no longer apply inline: it verifies the X-Signature HMAC BEFORE any
-- parse (unchanged trust boundary), enqueues the raw envelope here, and returns 200 within ClickUp's
-- budget (>7s or a non-2xx response marks the webhook Failing; 5 failed retries drop the event
-- permanently; 100 failures SUSPEND the webhook with NO notification — so the ingress must never do a
-- synchronous re-GET on the request path). A separate worker (clickup-webhook-worker, invoked on a
-- short pg_cron tick below) re-GETs the task and applies the full current state through the existing
-- source-mod-guarded apply path, resolving the org/project binding from the re-GET's `task.list.id`
-- (never from the payload — the payload never carries a `list_id`, which made the adopt tier
-- unreachable dead code before this fix).
--
-- Service-role only (mirrors m365_pkce_states, 0106; the money outbox 0096 lockdown stance): RLS
-- enabled + forced, ZERO policies, revoke all from authenticated/anon — this is an internal queue,
-- never client-visible, never org-scoped at insert time (the org is resolved by the WORKER, after the
-- re-GET — the ingress does not and cannot know it yet).
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback (functions/cron before the table):
--   select cron.unschedule('clickup-webhook-worker-tick');
--   drop function if exists public.clickup_webhook_worker_tick();
--   drop table if exists public.clickup_webhook_inbox;

create table public.clickup_webhook_inbox (
  id              uuid primary key default gen_random_uuid(),
  event           text not null check (event in ('taskCreated','taskUpdated','taskStatusUpdated','taskDeleted')),
  task_id         text not null,
  team_id         text,
  webhook_id      text,
  history_items   jsonb not null default '[]'::jsonb,
  status          text not null default 'pending' check (status in ('pending','processing','done','failed')),
  attempts        int not null default 0,
  last_error      text,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz
);
comment on table public.clickup_webhook_inbox is
  'Durable ClickUp webhook queue (OD-INT-11, 2026-07-20): verify -> 200 -> enqueue -> worker re-GET -> '
  'apply. Service-role only; the ingress never applies inline (ClickUp Failing/Suspend budget).';
create index clickup_webhook_inbox_pending_idx on public.clickup_webhook_inbox (received_at) where status = 'pending';

alter table public.clickup_webhook_inbox enable row level security;
alter table public.clickup_webhook_inbox force  row level security;

-- DELIBERATELY NO policy of any kind → every authenticated/anon access is denied; only service_role
-- (which bypasses RLS) reads/writes this internal queue.
revoke all on public.clickup_webhook_inbox from authenticated;
revoke all on public.clickup_webhook_inbox from anon;

-- ── pg_cron registration for the worker tick (mirrors 0094_clickup_sweep_cron.sql's Vault-secret
-- pattern EXACTLY — a DEDICATED worker secret, never the master service_role key, in the DB). Every
-- MINUTE (faster than the 5-minute sweep — this path exists FOR latency, ADR-0055 §3). Null-safe: the
-- helper no-ops until an operator creates the two Vault secrets (identical fail-safe to 0094). ──
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

create or replace function public.clickup_webhook_worker_tick()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'clickup_webhook_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'clickup_webhook_worker_secret';
  if v_url is not null and v_url <> '' and v_secret is not null and v_secret <> '' then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  end if;
end;
$$;

revoke all on function public.clickup_webhook_worker_tick() from public;

select cron.schedule('clickup-webhook-worker-tick', '* * * * *', 'select public.clickup_webhook_worker_tick()');
