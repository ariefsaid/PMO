-- 0047_agent_usage_credits.sql — agent_usage (per-request spend ledger) + credits (admin-grant
-- ledger), the mechanism backing docs/specs/agent-usage-credits.spec.md. Balance is COMPUTED
-- (sum(credits.amount) - sum(agent_usage.cost)), never stored — no mutable counter, no race
-- (FR-AUC-010, spec "Design choices"). Both tables are owner-private; credits INSERT is the
-- family's first Admin-only RLS policy (no UPDATE/DELETE policy on credits for any role —
-- append-only by omission, FR-AUC-007). Reuses auth_org_id()/auth_role() from 0002_rls.sql.
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback (reverse order):
--   drop policy if exists credits_insert on credits;
--   drop policy if exists credits_select on credits;
--   drop policy if exists agent_usage_insert on agent_usage;
--   drop policy if exists agent_usage_select on agent_usage;
--   drop index if exists public.credits_owner_idx;
--   drop index if exists public.agent_usage_run_id_idx;
--   drop index if exists public.agent_usage_owner_created_idx;
--   drop table if exists public.credits;
--   drop table if exists public.agent_usage;

create table agent_usage (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id           uuid not null references profiles(id) default auth.uid(),
  run_id             uuid references agent_runs(id) on delete set null,
  model              text not null,
  prompt_tokens      integer not null default 0,
  completion_tokens  integer not null default 0,
  cost               numeric not null default 0,
  created_at         timestamptz not null default now()
);

create table credits (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id    uuid not null references profiles(id),
  amount      numeric not null check (amount > 0),
  note        text,
  granted_by  uuid not null references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

-- Hot-path indexes (NFR-AUC-PERF-001): the balance sum and "my usage history" queries.
create index agent_usage_owner_created_idx on agent_usage (owner_id, created_at);
create index agent_usage_run_id_idx        on agent_usage (run_id);
-- credits(owner_id): the balance computation (creditRateGuard.computeBalance) and every
-- credits RLS predicate (owner_id = auth.uid()) filter on this column — was previously an
-- unindexed scan (Quality review CRITICAL finding); now index-backed like agent_usage's.
create index credits_owner_idx on credits (owner_id);

alter table agent_usage enable row level security;
alter table agent_usage force row level security;
alter table credits     enable row level security;
alter table credits     force row level security;

-- ── agent_usage: owner-only SELECT/INSERT. No UPDATE/DELETE policy for anyone (append-only by
-- omission — a usage row is a historical fact, never corrected in place; NFR-AUC-SEC-001). ────────
create policy agent_usage_select on agent_usage for select
  using (owner_id = auth.uid() and org_id = auth_org_id());

-- WITH CHECK also verifies run_id (when non-null) belongs to a run the caller owns — mirrors the
-- agent_events_insert/agent_runs_insert symmetric FK-ownership guard (0046_agent_persistence.sql).
create policy agent_usage_insert on agent_usage for insert
  with check (
    owner_id = auth.uid() and org_id = auth_org_id()
    and (
      run_id is null
      or exists (
        select 1 from agent_runs r
         where r.id = agent_usage.run_id
           and r.owner_id = auth.uid()
           and r.org_id = auth_org_id()
      )
    )
  );

-- ── credits: owner-only SELECT; Admin-only INSERT (the family's first Admin-only INSERT policy —
-- NFR-AUC-SEC-002). No UPDATE/DELETE policy for anyone (FR-AUC-007 — mis-issued grants are
-- corrected by a new row, never mutation). ──────────────────────────────────────────────────────
create policy credits_select on credits for select
  using (owner_id = auth.uid() and org_id = auth_org_id());

-- Security review LOW-1: also verifies owner_id's profile belongs to the caller's org — mirrors
-- the agent_usage run-FK-ownership guard above. Without this, an Admin could grant credits to a
-- cross-org owner_id (org_id itself is caller-pinned, but owner_id was not cross-checked against
-- it before this fix).
create policy credits_insert on credits for insert
  with check (
    auth_role() = 'Admin' and org_id = auth_org_id()
    and exists (
      select 1 from profiles p
       where p.id = owner_id
         and p.org_id = auth_org_id()
    )
  );
