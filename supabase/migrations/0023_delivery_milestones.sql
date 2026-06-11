-- 0023_delivery_milestones.sql — Delivery backbone (spine 3): project_milestones + tasks.milestone_id.
-- Forward-only, additive; reversibility contract is `supabase db reset` pre-prod, documented forward-only
-- rollback post-deploy (charter Data/Schema DoD): `drop table project_milestones cascade;
-- alter table tasks drop column milestone_id;` reverses it (the FK on tasks SET NULLs, then the column drops).
-- OD-DEL (LOCKED 2026-06-11). Director OQ1 = HARD delete (no archived_at); OQ2/OQ3 resolved in the plan.
-- RLS shape mirrors tasks_write / budget_versions_write (0002): org-read for all; PM+Admin write with a
-- parent-project org guard (ADR-0015 defense-in-depth). NO security-definer RPC for writes — milestone
-- CRUD has no SoD axis (ADR-0019 boundary); writes are plain role-gated RLS. The two get_* RPCs are
-- security INVOKER read aggregations (OD-ARCH-1) — RLS scopes their rows; no definer re-assertion.

-- §1 — project_milestones table (FR-DEL-001).
create table project_milestones (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  target_date date,
  weight      numeric not null default 1 check (weight >= 0),
  input_pct   numeric check (input_pct is null or (input_pct >= 0 and input_pct <= 100)),
  created_at  timestamptz not null default now()
);
create index project_milestones_project_idx on project_milestones (project_id);
create index project_milestones_org_idx on project_milestones (org_id);

-- §2 — tasks.milestone_id FK (FR-DEL-002). Nullable; ON DELETE SET NULL un-groups tasks when a
-- milestone is hard-deleted (Director OQ1). Existing tasks are unaffected (NFR-DEL-DATA-001).
alter table tasks add column milestone_id uuid references project_milestones(id) on delete set null;
create index tasks_milestone_idx on tasks (milestone_id);

-- §3 — RLS (FR-DEL-003/018/019). enable + force (0004 pattern).
alter table project_milestones enable row level security;
alter table project_milestones force row level security;

-- Read: any authenticated member of the org (FR-DEL-018).
create policy project_milestones_select on project_milestones for select
  using (org_id = auth_org_id());

-- Write (insert/update/delete): PM + Admin only (FR-DEL-019, OD-DEL-7). org_id server-stamped + re-checked;
-- parent-project must be in the caller's org (ADR-0015 parent-org guard, D-4). Same shape as tasks_write.
create policy project_milestones_write on project_milestones for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Project Manager')
    and exists (select 1 from public.projects p
                 where p.id = project_milestones.project_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Project Manager')
    and exists (select 1 from public.projects p
                 where p.id = project_milestones.project_id and p.org_id = auth_org_id()));

-- §4 — get_project_milestones(p_project_id): per-milestone rows + derived %s (FR-DEL-004/005, D-3).
-- security INVOKER → RLS scopes both project_milestones and tasks to the caller's org. calculated_pct is
-- NULL when the milestone has no tasks (nullif on the denominator); effective_pct = coalesce(input,calc,0).
create or replace function get_project_milestones(p_project_id uuid)
  returns table (
    id uuid, project_id uuid, name text, sort_order integer, target_date date,
    weight numeric, input_pct numeric, task_count integer,
    calculated_pct numeric, effective_pct numeric
  )
  language sql stable security invoker set search_path = public as $$
  select m.id, m.project_id, m.name, m.sort_order, m.target_date, m.weight, m.input_pct,
         count(t.id)::int as task_count,
         (count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0)) as calculated_pct,
         coalesce(
           m.input_pct,
           count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
           0
         ) as effective_pct
    from project_milestones m
    left join tasks t on t.milestone_id = m.id
   where m.project_id = p_project_id
   group by m.id
   order by m.sort_order, m.created_at;
$$;
revoke all     on function get_project_milestones(uuid) from public;
grant  execute on function get_project_milestones(uuid) to   authenticated;
revoke execute on function get_project_milestones(uuid) from anon;

-- §5 — get_projects_delivery(p_ids): weight-weighted project delivery % per project (FR-DEL-006, D-2).
-- NULL delivery_pct (or absent row) ⇒ no chip. A project with no milestones is simply not in the result.
-- Same effective_pct expression as §4 (single source of truth for the rollup formula).
create or replace function get_projects_delivery(p_ids uuid[])
  returns table (project_id uuid, delivery_pct numeric)
  language sql stable security invoker set search_path = public as $$
  with eff as (
    select m.project_id, m.weight,
           coalesce(
             m.input_pct,
             count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
             0
           ) as effective_pct
      from project_milestones m
      left join tasks t on t.milestone_id = m.id
     where m.project_id = any(p_ids)
     group by m.id
  )
  select project_id,
         sum(weight * effective_pct) / nullif(sum(weight), 0) as delivery_pct
    from eff
   group by project_id;
$$;
revoke all     on function get_projects_delivery(uuid[]) from public;
grant  execute on function get_projects_delivery(uuid[]) to   authenticated;
revoke execute on function get_projects_delivery(uuid[]) from anon;
