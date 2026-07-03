-- 0046_agent_persistence.sql — agent_threads/agent_runs/agent_events persistence layer (ADR-0043 §1/§2,
-- Issue PMO#2 batteries-included A). Three ordinary owner-private tenant entities backing the shipped
-- AgentRuntime port's AgentRun/AgentEvent shapes (port.ts is unchanged — these tables are its durable
-- storage). Mirrors the Companies/user_views slice (0045_user_views.sql) exactly, with ONE deliberate
-- divergence: NO Admin cross-owner read grant on any of the three tables (FR-AGP-008) — an agent
-- conversation is more sensitive than a saved view. Reuses auth_org_id()/auth_role() from 0002_rls.sql
-- (NOT redefined here).
--
-- Ordering key: agent_events.seq (a per-run monotonic counter assigned by the edge fn as it emits) is
-- the transcript order — NEVER created_at, which can tie within a turn (FR-AGP-005).
--
-- Append-only: agent_events permits no UPDATE/DELETE except the single narrow feedback UPDATE
-- (rating/downvote_reason on an owner's own type='assistant' row). The FOR UPDATE policy alone permits
-- reaching the row; a BEFORE UPDATE trigger (agent_events_feedback_only) blocks any drift on the other
-- columns — this is the AC-AGP-010 authority (mirrors the 0016_task_engineer_status.sql column-pin
-- trigger pattern).
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback (reverse order):
--   drop trigger if exists agent_events_feedback_only_trg on agent_events;
--   drop function if exists agent_events_feedback_only();
--   drop policy if exists agent_events_delete on agent_events;
--   drop policy if exists agent_events_update on agent_events;
--   drop policy if exists agent_events_insert on agent_events;
--   drop policy if exists agent_events_select on agent_events;
--   drop policy if exists agent_runs_delete on agent_runs;
--   drop policy if exists agent_runs_update on agent_runs;
--   drop policy if exists agent_runs_insert on agent_runs;
--   drop policy if exists agent_runs_select on agent_runs;
--   drop policy if exists agent_threads_delete on agent_threads;
--   drop policy if exists agent_threads_update on agent_threads;
--   drop policy if exists agent_threads_insert on agent_threads;
--   drop policy if exists agent_threads_select on agent_threads;
--   drop index if exists public.agent_threads_owner_live_idx;
--   drop index if exists public.agent_runs_thread_created_idx;
--   drop index if exists public.agent_events_run_seq_idx;
--   drop table if exists public.agent_events;
--   drop table if exists public.agent_runs;
--   drop table if exists public.agent_threads;

create table agent_threads (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id    uuid not null references profiles(id) default auth.uid(),
  title       text not null default 'New conversation',
  scope       jsonb,
  pinned_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table agent_runs (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null references agent_threads(id) on delete cascade,
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id         uuid not null references profiles(id) default auth.uid(),
  title            text not null default '',
  status           text not null default 'queued'
                     check (status in ('queued','running','paused','needs-approval','completed','errored')),
  progress         numeric,
  last_progress_at timestamptz,
  progress_step    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table agent_events (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references agent_runs(id) on delete cascade,
  org_id          uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id        uuid not null references profiles(id) default auth.uid(),
  seq             bigint not null,
  type            text not null check (type in ('user','assistant','tool','artifact','status','system')),
  text            text,
  payload         jsonb,
  tool_name       text,
  tool_args_hash  text,
  tool_status     text check (tool_status in ('completed','errored')),
  rating          text check (rating in ('up','down')),
  downvote_reason text check (downvote_reason in ('inaccurate','not_helpful','wrong_tool','too_slow')),
  created_at      timestamptz not null default now()
);

-- Hot-path indexes (NFR-AGP-PERF-001/002, FR-AGP-006).
create index agent_events_run_seq_idx      on agent_events (run_id, seq);
create index agent_runs_thread_created_idx  on agent_runs (thread_id, created_at);
create index agent_threads_owner_live_idx   on agent_threads (owner_id) where archived_at is null;

alter table agent_threads enable row level security;
alter table agent_threads force row level security;
alter table agent_runs    enable row level security;
alter table agent_runs    force row level security;
alter table agent_events  enable row level security;
alter table agent_events  force row level security;

-- ── agent_threads: owner-only, no Admin read grant (FR-AGP-007/008). ────────────────────────────────
create policy agent_threads_select on agent_threads for select
  using (owner_id = auth.uid() and org_id = auth_org_id());

create policy agent_threads_insert on agent_threads for insert
  with check (owner_id = auth.uid() and org_id = auth_org_id());

create policy agent_threads_update on agent_threads for update
  using (owner_id = auth.uid() and org_id = auth_org_id())
  with check (owner_id = auth.uid() and org_id = auth_org_id());

create policy agent_threads_delete on agent_threads for delete
  using (owner_id = auth.uid() and org_id = auth_org_id());

-- ── agent_runs: owner-only, no Admin read grant. ────────────────────────────────────────────────────
create policy agent_runs_select on agent_runs for select
  using (owner_id = auth.uid() and org_id = auth_org_id());

create policy agent_runs_insert on agent_runs for insert
  with check (owner_id = auth.uid() and org_id = auth_org_id());

create policy agent_runs_update on agent_runs for update
  using (owner_id = auth.uid() and org_id = auth_org_id())
  with check (owner_id = auth.uid() and org_id = auth_org_id());

create policy agent_runs_delete on agent_runs for delete
  using (owner_id = auth.uid() and org_id = auth_org_id());

-- ── agent_events: owner-only SELECT/INSERT/DELETE; UPDATE is feedback-only (FR-AGP-009). ──────────────
create policy agent_events_select on agent_events for select
  using (owner_id = auth.uid() and org_id = auth_org_id());

-- WITH CHECK also verifies run_id belongs to a run the caller owns — pinning owner_id/org_id on the
-- event alone is not enough, since a caller could stamp their OWN owner_id while pointing run_id at
-- someone else's run (AC-AGP-009: a non-owner cannot insert under another user's run_id).
create policy agent_events_insert on agent_events for insert
  with check (
    owner_id = auth.uid() and org_id = auth_org_id()
    and exists (
      select 1 from agent_runs r
       where r.id = agent_events.run_id
         and r.owner_id = auth.uid()
         and r.org_id = auth_org_id()
    )
  );

-- Feedback-only UPDATE: reachable only for the owner's own type='assistant' row. The USING/WITH CHECK
-- predicate alone permits touching ANY column on that row — the column pin (rating/downvote_reason
-- only) is enforced by the trigger below, which is the actual AC-AGP-010 authority.
create policy agent_events_update on agent_events for update
  using (owner_id = auth.uid() and org_id = auth_org_id() and type = 'assistant')
  with check (owner_id = auth.uid() and org_id = auth_org_id() and type = 'assistant');

create policy agent_events_delete on agent_events for delete
  using (owner_id = auth.uid() and org_id = auth_org_id());

-- Column-pin trigger: the only permitted UPDATE is rating/downvote_reason. Any drift on the
-- transcript/journal columns — including by the owner — is rejected (append-only except feedback).
-- seq is also pinned (an out-of-band UPDATE must never renumber the transcript).
create or replace function agent_events_feedback_only()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.text           is distinct from old.text
     or new.payload      is distinct from old.payload
     or new.type         is distinct from old.type
     or new.tool_name    is distinct from old.tool_name
     or new.tool_args_hash is distinct from old.tool_args_hash
     or new.tool_status  is distinct from old.tool_status
     or new.seq          is distinct from old.seq
  then
    raise exception 'agent_events is append-only except rating/downvote_reason' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger agent_events_feedback_only_trg
  before update on agent_events
  for each row execute function agent_events_feedback_only();
