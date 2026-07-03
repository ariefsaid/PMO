-- 0047_agent_automations_notifications.sql — agent automations (cron + event-triggered) +
-- notifications inbox (ADR-0044 §1/§5, ADR-0046, Issue PMO#5 batteries-included A). Three tables:
-- two ordinary owner-private tenant entities (agent_automations, notifications) mirroring the
-- Companies/user_views/agent_threads slice exactly, plus ONE non-tenant, service-role-only infra
-- table (agent_dispatch_watermarks — ADR-0046) that deliberately carries NO org_id/owner_id: it is
-- dispatcher bookkeeping (a cursor over an append-only log), not tenant data. Reuses
-- auth_org_id()/auth_role() from 0002_rls.sql (NOT redefined here).
--
-- service_role note (REC-5, plan §0): the dispatcher's service_role client bypasses RLS entirely
-- (Postgres/Supabase's superuser-adjacent role) — the agent_dispatch_watermarks "no policy" posture
-- is default-deny to every ordinary JWT role, and is never reached by an interactive, caller-JWT-
-- scoped client; only the dispatcher's service_role client ever touches it (proven by the
-- AC-AAN-018 table-set assertion in Vitest, not by RLS on this table).
--
-- pg_cron / pg_net caveat (Task A5): the cron.schedule() DDL below is idempotent and MUST succeed in
-- `supabase db reset` (the pgTAP env) — it only *registers* the per-minute job. The job's *body*
-- (net.http_post to app.settings.dispatch_url with app.settings.service_role_key) reads Postgres GUCs
-- that are NOT set in CI/local-dev by default (the edge runtime does not run inside the pgTAP test
-- DB) — net.http_post tolerates unset GUCs by queuing a request that never resolves, a no-op in the
-- test DB. Registration (a `cron.job` row existing) is asserted at the DB layer; the job's actual
-- fire against a real edge fn URL is live-verified only in a deployed environment, never in CI.
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback (reverse order):
--   select cron.unschedule('agent-dispatch-tick');
--   drop policy if exists notifications_delete on notifications;
--   drop policy if exists notifications_update on notifications;
--   drop policy if exists notifications_insert on notifications;
--   drop policy if exists notifications_select on notifications;
--   drop trigger if exists notifications_mark_read_only_trg on notifications;
--   drop function if exists notifications_mark_read_only();
--   drop policy if exists agent_automations_delete on agent_automations;
--   drop policy if exists agent_automations_update on agent_automations;
--   drop policy if exists agent_automations_insert on agent_automations;
--   drop policy if exists agent_automations_select on agent_automations;
--   drop index if exists public.notifications_owner_unread_idx;
--   drop index if exists public.agent_automations_due_idx;
--   drop table if exists public.agent_dispatch_watermarks;
--   drop table if exists public.notifications;
--   drop table if exists public.agent_automations;

create table agent_automations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id      uuid not null references profiles(id) default auth.uid(),
  kind          text not null check (kind in ('schedule','trigger')),
  prompt        text not null,
  schedule      text,
  trigger_on    jsonb,
  condition     text,
  enabled       boolean not null default true,
  timeout_s     integer not null default 120,
  last_fired_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  -- kind-conditional required fields (FR-AAN-002):
  constraint agent_automations_schedule_req
    check (kind <> 'schedule' or (schedule is not null and length(trim(schedule)) > 0)),
  constraint agent_automations_trigger_req
    check (kind <> 'trigger' or (trigger_on is not null and trigger_on ? 'source' and trigger_on ? 'event'))
);
-- Dispatcher due-selection fast path (NFR-AAN-PERF-001): narrows to enabled+live automations of a
-- given kind; the cron-minute match itself happens in-JS (cronMatches), not in this predicate.
create index agent_automations_due_idx
  on agent_automations (kind) where enabled and archived_at is null;

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id    uuid not null references profiles(id) default auth.uid(),
  severity    text not null default 'info' check (severity in ('info','warning','critical')),
  title       text not null,
  body        text,
  metadata    jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
-- Unread-badge fast path (NFR-AAN-PERF-002): count(*) where owner_id = caller and read_at is null.
create index notifications_owner_unread_idx on notifications (owner_id) where read_at is null;

-- ADR-0046: dispatcher watermark infra table — deliberately NO org_id/owner_id (not tenant data; a
-- global cursor over an append-only log, one row per event source). service_role-only via RLS with
-- no policy (default-deny to every JWT role).
create table agent_dispatch_watermarks (
  source        text primary key,
  last_seen_id  uuid,
  last_seen_at  timestamptz,
  updated_at    timestamptz not null default now()
);

alter table agent_automations        enable row level security;
alter table agent_automations        force row level security;
alter table notifications            enable row level security;
alter table notifications            force row level security;
alter table agent_dispatch_watermarks enable row level security;
alter table agent_dispatch_watermarks force row level security;
-- agent_dispatch_watermarks: intentionally NO policy created — default-deny to every JWT role;
-- only service_role (which bypasses RLS) reaches it.

-- ── agent_automations: owner-only (FR-AAN-004). ─────────────────────────────────────────────────────
create policy agent_automations_select on agent_automations for select
  using (owner_id = auth.uid() and org_id = auth_org_id());

create policy agent_automations_insert on agent_automations for insert
  with check (owner_id = auth.uid() and org_id = auth_org_id());

create policy agent_automations_update on agent_automations for update
  using (owner_id = auth.uid() and org_id = auth_org_id())
  with check (owner_id = auth.uid() and org_id = auth_org_id());

create policy agent_automations_delete on agent_automations for delete
  using (owner_id = auth.uid() and org_id = auth_org_id());

-- ── notifications: owner-only SELECT/INSERT/DELETE; UPDATE is mark-read-only (FR-AAN-008/009). ────────
create policy notifications_select on notifications for select
  using (owner_id = auth.uid() and org_id = auth_org_id());

create policy notifications_insert on notifications for insert
  with check (owner_id = auth.uid() and org_id = auth_org_id());

-- The USING/WITH CHECK predicate alone permits touching ANY column on the owner's own row — the
-- column pin (read_at only) is enforced by the trigger below, which is the actual AC-AAN-015
-- authority (mirrors the agent_events_feedback_only pattern, 0046_agent_persistence.sql).
create policy notifications_update on notifications for update
  using (owner_id = auth.uid() and org_id = auth_org_id())
  with check (owner_id = auth.uid() and org_id = auth_org_id());

create policy notifications_delete on notifications for delete
  using (owner_id = auth.uid() and org_id = auth_org_id());

-- Column-pin trigger: the only permitted UPDATE is read_at. Any drift on title/body/severity/
-- metadata/owner_id/org_id/created_at — including by the owner — is rejected (notification content
-- is immutable post-creation, FR-AAN-009).
create or replace function notifications_mark_read_only()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.title      is distinct from old.title
     or new.body     is distinct from old.body
     or new.severity is distinct from old.severity
     or new.metadata is distinct from old.metadata
     or new.owner_id is distinct from old.owner_id
     or new.org_id   is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'notifications is immutable except read_at' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger notifications_mark_read_only_trg
  before update on notifications
  for each row execute function notifications_mark_read_only();

-- ── pg_cron per-minute dispatcher tick (FR-AAN-010). ────────────────────────────────────────────────
-- Guarded: create extension if absent (Supabase local + cloud both ship pg_cron/pg_net). This DDL is
-- idempotent and MUST succeed in `supabase db reset`; the job body's net.http_post call reads
-- app.settings.dispatch_url / app.settings.service_role_key GUCs that are unset in CI/local-dev — see
-- the header caveat above. Registration only; the fire is live-verified in a deployed environment.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'agent-dispatch-tick', '* * * * *',
  $$ select net.http_post(
       url := current_setting('app.settings.dispatch_url', true),
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
     ); $$
);
