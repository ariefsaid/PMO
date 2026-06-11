# Implementation plan: Delivery milestones (spine 3 MVP)

- **Issue / spec:** `docs/specs/delivery-milestones.spec.md` (21 FRs · 22 ACs: 14 Unit · 7 pgTAP · 1 E2E).
- **Decisions:** `docs/decisions.md` OD-DEL-1..8, OD-UX-1, OD-ARCH-1. Director resolutions: OQ1 (hard delete), OQ2 (decided below), OQ3 (click-to-edit inline).
- **Patterns followed:** ADR-0016 (`can()` UX / RLS authority), ADR-0017 (repository seam), ADR-0019 (RPC only for real SoD/destructive — milestone writes are plain role-gated RLS, no RPC), ADR-0021 (canonical `/projects/:id` at every stage), ADR-0010 (lowest-layer AC ownership).
- **One PR / one issue.** Six phases, sequenced. Read-only on source for this planner; the implementer follows TDD red→green per task.

---

## Decisions made by the planner (not reopened)

### D-1 — OQ1: milestone **HARD delete** with `tasks.milestone_id ON DELETE SET NULL` (Director-resolved)
The spec body §FR-DEL-010 leaned soft-archive, but the **Director resolution is binding: hard delete**. Rationale (already ratified): a milestone has no audit/financial value of its own; the FK `on delete set null` cleanly un-groups dependent tasks (they are never deleted with the milestone); soft-archive would add a perpetual `archived_at is null` filter to every read for no benefit. **Consequence:** the `project_milestones` table carries **no `archived_at` column** (it diverges from the spec checklist §537 here on the Director's instruction — flagged in Open questions for confirmation). All "non-archived" qualifiers in the spec collapse to "all rows for the project". Delete is `ConfirmDialog`-gated in the FE (OD-UX-1: destructive ⇒ confirm) + RLS role check (PM/Admin); **not** Admin-only (OD-DEL-7 gates milestone CRUD to PM+Admin uniformly).

### D-2 — OQ2: Projects-list delivery-% via **one correlated-subquery RPC `get_projects_delivery(p_ids uuid[])`** (security-invoker)
The Projects list already fetches rows via `listProjects()` (PostgREST `.from('projects').select(...)`). The delivery-% rollup needs a two-level aggregate (tasks → per-milestone effective % → weight-weighted project average) that PostgREST cannot express in one embedded select without N+1. Per OD-ARCH-1 (RPC reserved for server-side aggregation that REST can't do) and the established `get_*` security-**invoker** read-RPC pattern (`get_executive_dashboard`, `get_sales_pipeline`, `get_project_budget`), a **single set-returning RPC `get_projects_delivery(p_ids uuid[]) returns table(project_id uuid, delivery_pct numeric)`** is the simplest thing that avoids N+1: the list hook calls it once with the page's project ids and merges the map client-side. `security invoker` (NOT definer) so RLS still scopes every row to the caller's org — no definer re-assertion needed, consistent with the read-RPC family. This is one extra round-trip total for the whole list (NFR-DEL-PERF-001 satisfied), keeps `listProjects()` untouched (no behavior change to the existing list query), and reuses the same SQL derivation expression as the detail-page read so there is a single source of truth for the rollup formula.

### D-3 — Calculated/effective % derivation **locus = SQL, in a read RPC `get_project_milestones(p_project_id uuid)`**
Per DN-1 the spec recommends shape B. We adopt it: a `security invoker` RPC returns each milestone row **plus** `calculated_pct` (`count(*) filter (where status='Done')*100.0/nullif(count(*),0)`), `effective_pct` (`coalesce(input_pct, calculated_pct, 0)`), and `task_count`, ordered by `sort_order`. Rationale: (a) the Tasks tab and the milestone strip both need per-milestone task counts — deriving in SQL avoids shipping all tasks twice and avoids drift between two derivation sites; (b) it reuses the same `get_*` invoker pattern as D-2 and shares the rollup expression; (c) the worked-example oracle (AC-DEL-019, pgTAP) tests this SQL directly. **The pure arithmetic of effective-% and the rollup is ALSO mirrored in a tiny TS module `delivery.ts`** so the Unit ACs (AC-DEL-001..007) can assert the formulas without a DB — the TS functions are the testable oracle for the display layer and the RPC SQL is the testable oracle for pgTAP; both implement the identical formula (kept in sync by AC-DEL-019's worked example being the shared 32% oracle).

### D-4 — org-coherence: **WITH CHECK subquery on `project_milestones_write`** (not a trigger)
The milestone's `org_id` must equal its parent project's `org_id` (defense-in-depth, ADR-0015 parent-org hardening). `org_id` is server-defaulted (column default) + RLS `with check (org_id = auth_org_id())`, and the parent-project guard is an `exists(...)` subquery in the same `with check` — exactly the `tasks_write` / `budget_versions_write` shape (0002). No org-inherit trigger is needed (unlike `procurement_items` 0015, which is written by a direct INSERT where the client could leave `org_id` at a stale default for a cross-org parent): here the create form is `projects`-scoped and `org_id` is never client-sent, so the column default = `auth_org_id()`'s org for the only project the caller can write under, and the parent-org `exists` subquery rejects a `project_id` from another org. One line, justified: chose the WITH-CHECK subquery over a trigger because milestones (like tasks) have no number-minting/definer path, so the table-layer trigger that `procurement_items` needs does not apply.

### D-5 — E2E seed strategy: a **dedicated expendable on-hand seed project `P013`** with NO milestones
AC-DEL-022 mutates data (creates a milestone + task, marks it Done). Mirroring the P011/P012 isolation pattern, it acts on its **own** dedicated on-hand seed project `P013 "Seabridge Terminal Delivery"` (`40000000-…-013`) that no other spec reads. Because `project_milestones` is a brand-new table, **no existing pgTAP oracle counts milestones or this project's tasks** — so adding P013 + its Active budget version perturbs nothing. We deliberately seed P013 with ZERO milestones so AC-DEL-022 exercises the create-from-empty journey. `P013` is on-hand (`Ongoing Project`) so it appears in the active Projects list for the chip assertion. `seed.sql` is local-only (never prod, CLAUDE.md). **Affected pgTAP oracles: none** (verified — the milestone table is new; the new project is margin-neutral by construction, Active budget == contract_value like P011/P012, so the 0034/0035/0036 dashboard/pipeline oracles that sum over the default org are unaffected because an Ongoing on-hand project with budget==contract contributes 0 to on-hand margin numerator and the on-hand oracles assert on specific named rows, not a global count — confirmed P013 is not referenced by any of 0034–0060).

---

## Architecture & data flow

```
                                        ┌─ get_project_milestones(p_project_id)  [invoker RPC, D-3]
  MilestoneStrip / TasksTab grouping ──►│   → rows + calculated_pct + effective_pct + task_count
   (pages/project-detail)               └─ milestones.* CRUD via REST (.from('project_milestones'))
        │
        ├─ useMilestones(projectId)  ──► repositories.milestone.* ──► src/lib/db/milestones.ts ──► Supabase
        │       (TanStack Query; key ['milestones', org, projectId])
        │
  Projects list / PMDashboard chip ────► useProjectsDelivery(ids) ──► repositories.milestone.deliveryForProjects(ids)
                                              └─ get_projects_delivery(p_ids)  [invoker RPC, D-2]

  delivery.ts (pure TS): calculatedPct(done,total) · effectivePct(input,calc) · projectDeliveryPct(milestones)
       └─ the Unit-test oracle for AC-DEL-001..007; mirrors the RPC SQL formula
```

`can('create'|'edit'|'delete', 'milestone', ctx)` gates every affordance (UX); RLS is the authority. New `Entity` value `'milestone'`.

---

## Phase 0 — Schema + pgTAP (migration `0023`, tests `0061`–`0067`)

### Task 0.1 — Write migration `0023_delivery_milestones.sql` (table + FK + RLS + RPCs)
**File (new):** `supabase/migrations/0023_delivery_milestones.sql`
**Action:** create the file with EXACTLY this content:

```sql
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
```

**Verify:** `cd /Users/ariefsaid/Coding/PMO && supabase db reset` (exits 0; the migration applies clean).

### Task 0.2 — Add the dedicated e2e seed project P013 (D-5)
**File:** `supabase/seed.sql` (append after the P012 block, around line 440, before the Wave-6 backdate at line 442).
**Action:** insert:

```sql
-- P013 "Seabridge Terminal Delivery" — a DEDICATED, EXPENDABLE on-hand row used EXCLUSIVELY by AC-DEL-022
-- (the delivery-milestones e2e journey). It carries ZERO milestones so the journey exercises the
-- create-from-empty flow, then creates its own milestone + task via the UI. No other spec reads it; no
-- pgTAP oracle counts milestones (new table) or this project's tasks. Margin-neutral (Active budget ==
-- contract_value, like P011/P012) so it does not perturb the dashboard/pipeline margin oracles.
insert into projects (id, code, name, status, client_id, project_manager_id,
                      contract_value, budget, spent) values
  ('40000000-0000-0000-0000-000000000013','P013','Seabridge Terminal Delivery','Ongoing Project',
   'c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   2000000,2000000,0);
insert into budget_versions (id, project_id, version, name, status) values
  ('50000000-0000-0000-0000-000000000013','40000000-0000-0000-0000-000000000013',1,'Delivery Budget','Draft');
insert into budget_line_items (budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('50000000-0000-0000-0000-000000000013','Labor','Delivery works',2000000,0);
update budget_versions set status = 'Active' where id = '50000000-0000-0000-0000-000000000013';
```

**Verify:** `cd /Users/ariefsaid/Coding/PMO && supabase db reset` (exits 0) then
`supabase test db 2>&1 | tail -5` (existing 60 pgTAP suites still pass — confirms P013 perturbs nothing).

### Task 0.3 — pgTAP `0061`: RLS reads-all-roles / writes-PM+Admin-only (AC-DEL-015, AC-DEL-016)
**File (new):** `supabase/tests/0061_milestones_rls.test.sql`
**Action:** `begin; select plan(N);` then, modeled on `0051_companies_crud.test.sql` (own-namespace fixtures `00610000-…`, `set local request.jwt.claims` per actor): insert an org-A project + one milestone owned by the table owner. Each pgTAP description's **leading token names the AC**:
- `AC-DEL-015: Engineer SELECTs project_milestones in-org → rows returned` (`set role` Engineer → `ok((select exists(select 1 from project_milestones …)))`).
- `AC-DEL-015: Engineer INSERT milestone → 42501` (`throws_ok($$ insert into project_milestones (project_id,name) values (...,'X') $$, '42501', ...)`).
- `AC-DEL-015: Finance UPDATE milestone → RLS no-op` (`lives_ok` UPDATE then a `reset role` + `is(...)` proving 0 rows changed — Finance is not in the write set, USING hides the row).
- `AC-DEL-016: PM INSERT milestone for an in-org project succeeds (org_id defaulted, never sent)` (`lives_ok`, then confirm org_id == default org).
- `AC-DEL-016: PM-inserted milestone is visible to another in-org member` (`reset role` to Admin → row exists).
- `AC-DEL-016: Admin UPDATE milestone.input_pct succeeds` (`lives_ok`, then `is(input_pct,75)`).
`select * from finish(); rollback;`
**Verify:** `cd /Users/ariefsaid/Coding/PMO && supabase test db --debug 2>&1 | grep -E '0061|not ok|^# '` → all `ok`, no `not ok`.

### Task 0.4 — pgTAP `0062`: cross-org isolation + org_id server-stamp (AC-DEL-017, AC-DEL-018)
**File (new):** `supabase/tests/0062_milestones_tenant_isolation.test.sql`
**Action:** org-A + org-B fixtures, each with a project + milestone (own `00620000-…` namespace, plus an org-B org id). Tests:
- `AC-DEL-017: org-A PM SELECT returns only org-A milestones` (`is((select count(*) from project_milestones)::int, <org-A count>)` under org-A PM jwt).
- `AC-DEL-017: org-A PM INSERT with an org-B project_id → rejected` (`throws_ok` `42501` — the parent-org `exists` subquery in WITH CHECK fails because the org-B project is not in `auth_org_id()`).
- `AC-DEL-018: org-A PM INSERT explicitly stamping org-B's org_id → WITH CHECK 42501` (`throws_ok($$ insert into project_milestones (org_id, project_id, name) values ('<orgB>','<orgA-project>','X') $$, '42501', ...)`).
**Verify:** `cd /Users/ariefsaid/Coding/PMO && supabase test db --debug 2>&1 | grep -E '0062|not ok'` → all `ok`.

### Task 0.5 — pgTAP `0063`: tasks.milestone_id ON DELETE SET NULL (AC-DEL-021)
**File (new):** `supabase/tests/0063_milestone_delete_sets_null.test.sql`
**Action:** owner-inserted fixtures: project + milestone M1 + two tasks T1, T2 with `milestone_id = M1`. As a PM (jwt) `delete from project_milestones where id = M1` (`lives_ok`). Then `reset role` and:
- `AC-DEL-021: T1 still exists after milestone delete` (`ok(exists T1)`).
- `AC-DEL-021: T1.milestone_id is null after milestone delete` (`ok((select milestone_id is null from tasks where id=T1))`).
- `AC-DEL-021: T2.milestone_id is null after milestone delete` (same for T2).
**Verify:** `cd /Users/ariefsaid/Coding/PMO && supabase test db --debug 2>&1 | grep -E '0063|not ok'` → all `ok`.

### Task 0.6 — pgTAP `0064`: weight/input_pct CHECK constraints + clear-input revert (AC-DEL-020)
**File (new):** `supabase/tests/0064_milestone_checks_and_input_clear.test.sql`
**Action:** owner fixtures: project + a milestone M with 5 tasks (2 Done) so `calculated_pct = 40`, `input_pct = 75`. As a PM:
- `AC-DEL-020: PM UPDATE input_pct = null clears it; effective % reverts to calculated (40)` — `update project_milestones set input_pct = null where id = M`; then `is((select effective_pct from get_project_milestones('<project>') where id = M), 40)`.
- CHECK constraints (leading-token references AC-DEL-016's edit FR, surfaced here as the write contract): `throws_ok($$ update project_milestones set input_pct = 150 where id = M $$, '23514', ...)` labelled `AC-DEL-020: input_pct > 100 rejected (23514)`; `throws_ok($$ update project_milestones set weight = -1 where id = M $$, '23514', ...)` labelled `AC-DEL-020: negative weight rejected (23514)`.
**Verify:** `cd /Users/ariefsaid/Coding/PMO && supabase test db --debug 2>&1 | grep -E '0064|not ok'` → all `ok`.

### Task 0.7 — pgTAP `0065`: worked-example rollup oracle 20/30/50 → 32% (AC-DEL-019)
**File (new):** `supabase/tests/0065_milestone_rollup_oracle.test.sql`
**Action:** owner fixtures reproducing the spec's worked example on one project: milestone E (weight 20, 5 tasks all Done → calc 100), milestone P (weight 30, 5 tasks, 2 Done → calc 40), milestone C (weight 50, 4 tasks, 0 Done → calc 0); all `input_pct` null. Tests (leading token AC-DEL-019):
- `AC-DEL-019: get_project_milestones effective % = 100/40/0 for E/P/C` (three `is(...)` on the RPC rows).
- `AC-DEL-019: calculated % is null for a milestone with no tasks` (add a tasks-less milestone N, assert `calculated_pct is null` and `effective_pct = 0` — also covers the AC-DEL-002/005 invariants at the SQL layer for the read-time-derivation proof FR-DEL-007).
- `AC-DEL-019: get_projects_delivery returns 32 for the worked-example project` (`is((select delivery_pct from get_projects_delivery(array['<project>'::uuid]))::numeric, 32)`).
- `AC-DEL-007/019: a project with no milestones is absent from get_projects_delivery` (`is((select count(*) from get_projects_delivery(array['<empty-project>'::uuid]))::int, 0)`).
**Verify:** `cd /Users/ariefsaid/Coding/PMO && supabase test db --debug 2>&1 | grep -E '0065|not ok'` → all `ok`.

> Note: `0061`–`0065` use the five new file numbers after `0060`. If a future merge bumps the count, the implementer renames in-sequence; the AC tokens (not the numbers) are the traceability anchor.

---

## Phase 1 — Types, DAL, repository, policy

### Task 1.1 — Regenerate Supabase types (NOT a hand-cast)
**File:** `pmo-portal/src/lib/supabase/database.types.ts` (regenerated).
**Action:** run the repo's type-gen so `project_milestones`, `tasks.milestone_id`, `get_project_milestones`, and `get_projects_delivery` appear in the generated types (memory rule: regen, never cast). Command lives in `package.json`/scripts — use the existing one:
`cd /Users/ariefsaid/Coding/PMO/pmo-portal && npm run gen:types` (if no such script, the implementer uses `supabase gen types typescript --local > src/lib/supabase/database.types.ts` from repo root per the existing convention).
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx tsc --noEmit 2>&1 | head` (no new errors) and `grep -c project_milestones src/lib/supabase/database.types.ts` (≥1).

### Task 1.2 — Write the pure derivation module `delivery.ts` (RED first) (AC-DEL-001..007)
**File (new test):** `pmo-portal/src/lib/db/delivery.test.ts`
**File (new impl):** `pmo-portal/src/lib/db/delivery.ts`
**Action — test first (RED):** write `delivery.test.ts` with these `it(...)` titles (AC token leads):
- `AC-DEL-001: calculatedPct(3,5) → 60`
- `AC-DEL-002: calculatedPct(0,0) → null` (no tasks)
- `AC-DEL-003: effectivePct({input:75,calculated:40}) → 75`
- `AC-DEL-004: effectivePct({input:null,calculated:40}) → 40`
- `AC-DEL-005: effectivePct({input:null,calculated:null}) → 0`
- `AC-DEL-006: projectDeliveryPct([{w:20,eff:100},{w:30,eff:40},{w:50,eff:0}]) → 32`
- `AC-DEL-007: projectDeliveryPct([]) → null`
**Then impl (GREEN):** `delivery.ts`:
```ts
/** Calculated % = Done/total *100; null when there are no tasks (FR-DEL-004). */
export function calculatedPct(done: number, total: number): number | null {
  if (total <= 0) return null;
  return (done * 100) / total;
}
/** Effective % = input ?? calculated ?? 0 (FR-DEL-005). */
export function effectivePct(args: { input: number | null; calculated: number | null }): number {
  return args.input ?? args.calculated ?? 0;
}
/** Project delivery % = Σ(w·eff)/Σw; null when there are no milestones (FR-DEL-006). */
export function projectDeliveryPct(ms: { weight: number; effective: number }[]): number | null {
  if (ms.length === 0) return null;
  const sumW = ms.reduce((a, m) => a + m.weight, 0);
  if (sumW === 0) return null;
  return ms.reduce((a, m) => a + m.weight * m.effective, 0) / sumW;
}
```
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run src/lib/db/delivery.test.ts` (7 pass).

### Task 1.3 — Write the milestones DAL `milestones.ts`
**File (new):** `pmo-portal/src/lib/db/milestones.ts`
**Action:** mirror `companies.ts`/`tasks.ts` conventions (AppError + `throwWrite(code)`, `org_id` NEVER sent). Exports:
```ts
import type { Tables } from '@/src/lib/supabase/database.types';
export type MilestoneRow = Tables<'project_milestones'>;

/** A milestone row enriched with the server-derived %s (from get_project_milestones, D-3). */
export interface MilestoneWithProgress {
  id: string; project_id: string; name: string; sort_order: number;
  target_date: string | null; weight: number; input_pct: number | null;
  task_count: number; calculated_pct: number | null; effective_pct: number;
}
/** Create form fields. org_id NEVER among them — RLS stamps it. */
export interface MilestoneInput { name: string; sort_order: number; target_date: string | null; weight: number; }
/** Edit patch — any subset, incl. input_pct: null to clear it (FR-DEL-009). */
export interface MilestonePatch { name?: string; sort_order?: number; target_date?: string | null; weight?: number; input_pct?: number | null; }
```
Functions:
- `listMilestones(projectId): Promise<MilestoneWithProgress[]>` → `supabase.rpc('get_project_milestones', { p_project_id: projectId })`, maps `data ?? []`. (FR-DEL-012/014; AC-DEL-008..010 consume this shape.)
- `getProjectsDelivery(ids: string[]): Promise<Record<string, number>>` → `supabase.rpc('get_projects_delivery', { p_ids: ids })`; returns a `{ [project_id]: delivery_pct }` map (rows absent ⇒ no key ⇒ no chip). Skip the call (return `{}`) when `ids.length === 0`. (FR-DEL-017.)
- `createMilestone(input: MilestoneInput, projectId: string): Promise<MilestoneRow>` → `.from('project_milestones').insert({ project_id, name, sort_order, target_date, weight }).select().single()`; `input_pct` defaults null (FR-DEL-008).
- `updateMilestone(id: string, patch: MilestonePatch): Promise<void>` → build a `TablesUpdate<'project_milestones'>` sending only present keys (note: `input_pct` present-and-null clears it — distinguish `patch.input_pct !== undefined`). (FR-DEL-009.)
- `deleteMilestone(id: string): Promise<void>` → `.from('project_milestones').delete().eq('id', id)` (hard delete, D-1; FK SET NULLs tasks). (FR-DEL-010.)
- `updateTaskMilestone(taskId: string, milestoneId: string | null): Promise<void>` → `.from('tasks').update({ milestone_id: milestoneId }).eq('id', taskId)` (FR-DEL-011; the column-default org + RLS parent-project guard authorize it).
Each `if (error) throwWrite(error)`.
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx tsc --noEmit 2>&1 | grep milestones` (no errors).

### Task 1.4 — Add the milestone repository to the seam (ADR-0017)
**Files:** `pmo-portal/src/lib/repositories/types.ts` (add `MilestoneRepository` + `milestone` on `Repositories`) and `pmo-portal/src/lib/repositories/index.ts` (wire it).
**Action — types.ts:** add
```ts
export interface MilestoneRepository {
  list: (projectId: string) => Promise<MilestoneWithProgress[]>;
  deliveryForProjects: (ids: string[]) => Promise<Record<string, number>>;
  create: (input: MilestoneInput, projectId: string) => Promise<MilestoneRow>;
  update: (id: string, patch: MilestonePatch) => Promise<void>;
  delete: (id: string) => Promise<void>;
  setTaskMilestone: (taskId: string, milestoneId: string | null) => Promise<void>;
}
```
add `milestone: MilestoneRepository;` to `Repositories` and import the milestone types.
**Action — index.ts:** import the six DAL fns; add
```ts
const milestone: MilestoneRepository = {
  list: (projectId) => wrap(() => listMilestones(projectId)),
  deliveryForProjects: (ids) => wrap(() => getProjectsDelivery(ids)),
  create: (input, projectId) => wrap(() => createMilestone(input, projectId)),
  update: (id, patch) => wrap(() => updateMilestone(id, patch)),
  delete: (id) => wrap(() => deleteMilestone(id)),
  setTaskMilestone: (taskId, milestoneId) => wrap(() => updateTaskMilestone(taskId, milestoneId)),
};
```
and add `milestone` to the exported `repositories` object + the `export type { … MilestoneRepository }` tail.
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx tsc --noEmit 2>&1 | grep -E 'repositories|milestone'` (no errors).

### Task 1.5 — Add `'milestone'` to the policy (AC-DEL-012, AC-DEL-021-FE-gate) — test first (RED)
**File (test):** `pmo-portal/src/auth/policy.test.ts` (append cases) — if no such file exists, create `policy.milestone.test.ts`.
**File (impl):** `pmo-portal/src/auth/policy.ts`.
**Action — test first (RED):** add `it(...)`:
- `AC-DEL-012: can('edit','milestone') is true for PM and Admin, false for Engineer/Finance/Executive`
- `AC-DEL-021: can('create','milestone') and can('delete','milestone') follow the same PM+Admin gate`
**Then impl (GREEN):** in `policy.ts` add `'milestone'` to the `Entity` union, and a `MILESTONE_WRITE` role set + table entry:
```ts
const MILESTONE_WRITE: Role[] = ['Admin', 'Project Manager']; // OD-DEL-7
// …in POLICY:
milestone: {
  view: allow(ALL),
  create: allow(MILESTONE_WRITE),
  edit: allow(MILESTONE_WRITE),
  delete: allow(MILESTONE_WRITE),
},
```
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run src/auth/policy` (new cases pass).

---

## Phase 2 — Hooks + derivation glue

### Task 2.1 — Write `useMilestones.ts` (query + mutations) — test first (RED)
**File (test):** `pmo-portal/src/hooks/useMilestones.test.tsx` (mirror `useTasks.test.tsx`).
**File (impl):** `pmo-portal/src/hooks/useMilestones.ts`.
**Action — test (RED):** assert `useMilestones(projectId)` calls `repositories.milestone.list(projectId)` and is keyed `['milestones', orgId, projectId]`; assert `useMilestoneMutations(projectId).create` invalidates `['milestones', orgId, projectId]` AND `['tasks', orgId, projectId]` (a milestone change can re-group tasks) AND `['projects']` + `['projects-delivery']` (chip refresh). Title: `useMilestones queries by project and invalidates tasks + projects on mutate`.
**Then impl (GREEN):** mirror `useTasks.ts`:
```ts
export function useMilestones(projectId: string) {
  const { currentUser } = useAuth(); const orgId = currentUser?.org_id;
  return useQuery({ queryKey: ['milestones', orgId, projectId],
    queryFn: () => repositories.milestone.list(projectId),
    enabled: Boolean(orgId) && Boolean(projectId) });
}
export function useMilestoneMutations(projectId: string) {
  const qc = useQueryClient(); const { currentUser } = useAuth(); const orgId = currentUser?.org_id;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['milestones', orgId, projectId] });
    qc.invalidateQueries({ queryKey: ['tasks', orgId, projectId] });
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['projects-delivery'] });
  };
  const create = useMutation({ mutationFn: ({ input }: { input: MilestoneInput }) =>
    repositories.milestone.create(input, projectId), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, patch }: { id: string; patch: MilestonePatch }) =>
    repositories.milestone.update(id, patch), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => repositories.milestone.delete(id), onSuccess: invalidate });
  const setTaskMilestone = useMutation({ mutationFn: ({ taskId, milestoneId }: { taskId: string; milestoneId: string | null }) =>
    repositories.milestone.setTaskMilestone(taskId, milestoneId), onSuccess: invalidate });
  return { create, update, remove, setTaskMilestone };
}
```
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run src/hooks/useMilestones.test.tsx` (pass).

### Task 2.2 — Write `useProjectsDelivery.ts` (chip enrichment, NFR-DEL-PERF-001) — test first (RED)
**File (test):** `pmo-portal/src/hooks/useProjectsDelivery.test.tsx`.
**File (impl):** `pmo-portal/src/hooks/useProjectsDelivery.ts`.
**Action — test (RED):** assert `useProjectsDelivery(ids)` calls `repositories.milestone.deliveryForProjects(ids)` ONCE for the whole id array (no per-row call), keyed `['projects-delivery', orgId, ids.join(',')]`, disabled when `ids` is empty. Title: `useProjectsDelivery fetches all delivery %s in one call (no N+1)`.
**Then impl (GREEN):**
```ts
export function useProjectsDelivery(ids: string[]) {
  const { currentUser } = useAuth(); const orgId = currentUser?.org_id;
  const key = [...ids].sort().join(',');
  return useQuery<Record<string, number>>({
    queryKey: ['projects-delivery', orgId, key],
    queryFn: () => repositories.milestone.deliveryForProjects(ids),
    enabled: Boolean(orgId) && ids.length > 0,
    staleTime: 60_000,
  });
}
```
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run src/hooks/useProjectsDelivery.test.tsx` (pass).

---

## Phase 3 — Detail-page UI: MilestoneStrip + MilestoneFormModal + Tasks-tab grouping

### Task 3.1 — `MilestoneStrip` two-column display + null rendering — test first (RED) (AC-DEL-008, AC-DEL-009)
**File (test):** `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.display.test.tsx`.
**File (impl):** `pmo-portal/pages/project-detail/MilestoneStrip.tsx`.
**Action — test (RED):** render `MilestoneStrip` with a stubbed `useMilestones` returning one milestone `{calculated_pct:60, input_pct:75, effective_pct:75}`:
- `AC-DEL-008: From-tasks cell reads "60%" and PM-input cell reads "75%"` — query the cell labelled "From tasks" → text `60%`; "PM input" → `75%`.
- Second milestone `{calculated_pct:null, input_pct:null, effective_pct:0}`: `AC-DEL-009: null calculated and null input render "—" in both cells`.
**Then impl (GREEN):** strip renders, per milestone (sort order): name, target date (if set), an effective-% `ProgressBar`, and the two labelled cells. Use a `pct(v: number|null) => v == null ? '—' : `${Math.round(v)}%`` formatter. Cells carry `data-testid` or accessible labels `From tasks` / `PM input` so the test can target them. Uses `DESIGN.md` tokens (16px root → existing card/border classes from TasksTab).
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run pages/project-detail/__tests__/MilestoneStrip.display.test.tsx` (2 pass).

### Task 3.2 — `MilestoneStrip` loading/empty/error states — test first (RED) (AC-DEL-014, AC-DEL-013)
**File (test):** `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.states.test.tsx`.
**File (impl):** extend `MilestoneStrip.tsx`.
**Action — test (RED):**
- `AC-DEL-014: pending query renders the loading skeleton (testid milestone-strip-loading)`.
- `AC-DEL-014/FR-DEL-013: empty + PM viewer renders milestone-strip-empty with an "Add a milestone" CTA` — stub `useMilestones` → `{data:[], isPending:false}` and `usePermission` → PM; assert `getByTestId('milestone-strip-empty')` + a button matching `/add a milestone/i`.
- `FR-DEL-013: empty + Engineer viewer hides the empty prompt` — `usePermission` → Engineer; assert `queryByTestId('milestone-strip-empty')` is null.
- `AC-DEL-014: error renders an error + Retry, and Retry calls refetch` — stub `{isError:true, refetch: spy}`; click Retry → spy called.
**Then impl (GREEN):** mirror the `state` ladder from `TasksTab.tsx` (loading → `ListState variant="loading"` wrapped with `data-testid="milestone-strip-loading"`; error → `ListState variant="error" onRetry={refetch}`; empty → a PM/Admin-gated prompt `data-testid="milestone-strip-empty"` with `action={canCreate ? {label:'Add a milestone', onClick: openCreate} : undefined}`, rendered for `can('create','milestone')` only). Gate via `usePermission()('create','milestone')`.
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run pages/project-detail/__tests__/MilestoneStrip.states.test.tsx` (pass).

### Task 3.3 — `MilestoneStrip` inline input-% edit, gated PM/Admin — test first (RED) (AC-DEL-012)
**File (test):** `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.inlineEdit.test.tsx`.
**File (impl):** extend `MilestoneStrip.tsx`.
**Action — test (RED):**
- `AC-DEL-012: PM viewer — clicking the "PM input" cell reveals an editable number field` (`usePermission` → PM; click the cell → a `<input>`/NumberField appears).
- `AC-DEL-012: Engineer viewer — the "PM input" cell shows a static value, no editable field` (`usePermission` → Engineer; the cell has no input/button).
- Saving (OD-UX-1: single click + toast, no confirm) calls `useMilestoneMutations().update` with `{ input_pct }` and blanking sends `{ input_pct: null }` (FR-DEL-009 clear).
**Then impl (GREEN):** click-to-edit (OQ3, OD-UX-1) — the "PM input" cell, when `can('edit','milestone')`, becomes a button that swaps to a `NumberField` + Save/Cancel inline (no modal); on Save call `update.mutateAsync({ id, patch: { input_pct } })`, `toast('Progress updated', …, 'success')`, classify errors via `classifyMutationError`. Blank field ⇒ `input_pct: null`. Non-PM/Admin: render the static `%`/`—` value only (no affordance).
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run pages/project-detail/__tests__/MilestoneStrip.inlineEdit.test.tsx` (pass).

### Task 3.4 — `MilestoneFormModal` (create/edit) + delete confirm
**File (impl):** `pmo-portal/pages/project-detail/MilestoneFormModal.tsx`.
**Action:** build with the shared primitives, mirroring `TaskFormModal` in `TasksTab.tsx`: `EntityFormModal` + `useEntityForm<{name,sort_order,target_date,weight,input_pct}>`, `TextField` (name required; sort_order number; target_date `type="date"`; weight number; input_pct number, optional), `validate` requires `name` and rejects `weight < 0` / `input_pct` outside 0..100 (matching the DB CHECKs so the user sees field errors before the round-trip; the DB stays the authority). On submit call `create`/`update` from `useMilestoneMutations`; `classifyMutationError` on failure with the spec's error table messages (name blank → "Milestone name is required"; range → "Progress must be between 0 and 100"; weight → "Weight must be 0 or greater"). Wire from the `MilestoneStrip` create/edit affordances (gated `can('create'|'edit','milestone')`). Delete affordance → `ConfirmDialog tone="destructive"` (OD-UX-1) → `remove.mutateAsync(id)` with copy "Tasks under this milestone become ungrouped; they are not deleted." (names the FK SET NULL behavior, D-1).
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx tsc --noEmit 2>&1 | grep -i milestone` (no errors) and `npm run lint:ci` passes for the new file.

### Task 3.5 — Mount `MilestoneStrip` in the detail page header area (FR-DEL-012)
**File:** `pmo-portal/pages/project-detail/ProjectDetail.tsx`.
**Action:** import `MilestoneStrip`; render it between `<ProjectDetailHeader …/>` and the `PipelineLens` banner (header area, every lifecycle stage per ADR-0021 / OD-DEL-1):
```tsx
<ProjectDetailHeader project={project} />
<div className="mb-4"><MilestoneStrip projectId={project.id} /></div>
{isPipeline && (<div className="mb-4"><PipelineLens project={project} /></div>)}
```
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run pages/project-detail/__tests__/ProjectDetail.test.tsx` (the existing detail-page tests still pass — no regression).

### Task 3.6 — Tasks-tab grouping by milestone — test first (RED) (AC-DEL-010, AC-DEL-015-FR-015)
**File (test):** `pmo-portal/pages/project-detail/__tests__/TasksTab.grouping.test.tsx`.
**File (impl):** `pmo-portal/pages/project-detail/tabs/TasksTab.tsx`.
**Action — test (RED):** stub `useTasks` → T1,T2 (`milestone_id=M1`), T3 (`milestone_id=M2`), T4 (`milestone_id=null`); stub `useMilestones` → M1 (effective 50), M2 (effective 0):
- `AC-DEL-010: T1,T2 render under an M1 heading; T3 under M2; T4 under a trailing "Ungrouped" section` — assert section order (M1 group, M2 group, then Ungrouped last) and membership.
- `FR-DEL-015: each milestone heading shows its name, target date, and effective %` — M1 heading text includes `50%`.
**Then impl (GREEN):** in `TasksTab`, additionally consume `useMilestones(projectId)`; in list view, group `tasks` by `milestone_id` into per-milestone sections (ordered by milestone `sort_order`) + a trailing `Ungrouped` section for `milestone_id == null`. Each milestone section header shows name + target date + effective %. Keep the existing `DataTable`/board within each group (re-use the existing `columns`/`StatusCell`). The board view may keep its status-column layout (grouping is the list-view requirement per FR-DEL-014).
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run pages/project-detail/__tests__/TasksTab.grouping.test.tsx` (pass) AND `npx vitest run pages/project-detail/__tests__/TasksTab.test.tsx` (existing tests still green).

### Task 3.7 — "Add task" inside a milestone group pre-populates milestone_id — test first (RED) (AC-DEL-011)
**File (test):** `pmo-portal/pages/project-detail/__tests__/TasksTab.addInGroup.test.tsx`.
**File (impl):** `TasksTab.tsx` (+ thread `milestone_id` through create).
**Action — test (RED):** `AC-DEL-011: clicking "Add task" within the M1 group opens the modal with the milestone field pre-populated to M1's id` — render as PM, click the M1-group "Add task", assert the form's milestone control value === M1.id.
**Then impl (GREEN):** each milestone group header (when `can('create','task')`) carries an "Add task" button that opens `TaskFormModal` with a new `defaultMilestoneId` prop = that group's id. Extend `TaskInput` consumption: add `milestone_id?: string | null` to the task create path (DAL `createTask` already inserts only listed columns — add `milestone_id: input.milestone_id ?? null` to `tasks.ts`'s `createTask` insert and to `TaskInput`). The modal renders a `SelectField`/`Combobox` "Milestone" option list (from `useMilestones`) defaulting to `defaultMilestoneId`; the Ungrouped "Add task" passes `null`.
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run pages/project-detail/__tests__/TasksTab.addInGroup.test.tsx` (pass).

> Cross-task type note: `TaskInput` gains `milestone_id?: string | null`; `tasks.ts` `createTask` inserts it; the repository `task.create` signature is unchanged (still `TaskInput`). Verify in Task 3.7's tsc pass.

---

## Phase 4 — Projects list + PM dashboard chip

### Task 4.1 — `DeliveryPctChip` component — test first (RED) (AC-DEL-013)
**File (test):** `pmo-portal/components/__tests__/DeliveryPctChip.test.tsx` (or co-located under `pages/__tests__`).
**File (impl):** `pmo-portal/components/DeliveryPctChip.tsx`.
**Action — test (RED):**
- `AC-DEL-013: a project with no delivery % (null/absent) renders nothing` — `render(<DeliveryPctChip pct={null} />)` → empty (`container.firstChild` is null).
- `renders "32%" pill when pct=32` — `render(<DeliveryPctChip pct={32} />)` → text `32%`.
**Then impl (GREEN):** a presentational pill (no data fetching): `if (pct == null) return null;` else a compact pill `{Math.round(pct)}%` with a delivery-tone token + accessible label `Delivery ${Math.round(pct)}%`. DESIGN.md tokens only.
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run components/__tests__/DeliveryPctChip.test.tsx` (2 pass).

### Task 4.2 — Wire the chip into the Projects list (AC-DEL-013, AC-DEL-017-list, NFR-DEL-PERF-001)
**File:** `pmo-portal/pages/Projects.tsx`.
**Action:** call `useProjectsDelivery(all.map(p => p.id))` once after `all` is computed; in the `'project'` column cell, render `<DeliveryPctChip pct={delivery?.[p.id] ?? null} />` next to the existing "At risk" pill (so the chip is absent when the project has no milestones — the map has no key). The single batched call satisfies NFR-DEL-PERF-001 (no per-row fetch).
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run pages/__tests__ 2>&1 | tail` (existing Projects tests still pass) and `npx tsc --noEmit 2>&1 | grep -i projects` (no errors).

### Task 4.3 — Wire the chip into the PM Dashboard project rows (FR-DEL-017)
**File:** the PM Dashboard project-list surface — `cd /Users/ariefsaid/Coding/PMO/pmo-portal && grep -rl "PMDashboard\|PM Dashboard" pages src` to confirm the exact file, then render `<DeliveryPctChip>` on each project row using the same `useProjectsDelivery(ids)` batched hook (one call for the dashboard's project id set).
**Action:** add the chip to the dashboard's per-project row, fed by one `useProjectsDelivery` call over the rows' ids.
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run 2>&1 | tail` (dashboard tests still green) and `npx tsc --noEmit` clean.

---

## Phase 5 — E2E curated journey (AC-DEL-022)

### Task 5.1 — `AC-DEL-022` Playwright journey
**File (new):** `pmo-portal/e2e/AC-DEL-022-milestone-journey.spec.ts`
**Action:** mirror `AC-1011-win-project.spec.ts` structure (login helper, generous timeouts, goal-oracle assertion). The journey acts on the dedicated **P013 "Seabridge Terminal Delivery"** (D-5), an on-hand project already in the active Projects list:
1. `await login(page, 'pm@acme.test');`
2. `await page.goto('/projects');` open P013's detail (click the row named "Seabridge Terminal Delivery").
3. In the milestone strip (empty state), click "Add a milestone"; fill name "Engineering design", weight 1; save → assert the strip now shows "Engineering design".
4. Go to the Tasks tab; within the "Engineering design" group click "Add task"; create "Detail drawings" (the milestone field is pre-populated — leave it); save.
5. Mark "Detail drawings" Done (the status `<select>` in its row).
6. **Goal oracle:** the milestone strip shows "Engineering design" with "From tasks" = `100%` and effective % = `100%`; navigate to `/projects` and the Seabridge row shows a delivery-% chip reading `100%`.
Title (leading AC token): `test('AC-DEL-022: a PM creates a milestone, adds a task under it, marks it Done — the strip shows From-tasks 100% and the Projects list chip shows 100%', …)`.
Header comment documents the P013 isolation (run after `supabase db reset`; no other spec reads P013).
**Verify:** `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx playwright test e2e/AC-DEL-022-milestone-journey.spec.ts` (pass; requires `supabase db reset` first so P013 is pristine).

---

## Phase 6 — Full gate

### Task 6.1 — Whole-suite green
**Verify (run all from the stated dirs):**
- `cd /Users/ariefsaid/Coding/PMO && supabase db reset && supabase test db 2>&1 | tail -5` (all pgTAP incl. 0061–0065 pass).
- `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npm run typecheck` (0 errors).
- `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npm run lint:ci` (0 errors/warnings).
- `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx vitest run` (all unit, ≥80% on changed milestone files).
- `cd /Users/ariefsaid/Coding/PMO/pmo-portal && npx playwright test e2e/AC-DEL-022-milestone-journey.spec.ts` (pass).

---

## Traceability (all 22 ACs → owning layer + file)

| AC | Layer | Owning test file | Task |
|---|---|---|---|
| AC-DEL-001 | Unit | `src/lib/db/delivery.test.ts` | 1.2 |
| AC-DEL-002 | Unit | `src/lib/db/delivery.test.ts` | 1.2 |
| AC-DEL-003 | Unit | `src/lib/db/delivery.test.ts` | 1.2 |
| AC-DEL-004 | Unit | `src/lib/db/delivery.test.ts` | 1.2 |
| AC-DEL-005 | Unit | `src/lib/db/delivery.test.ts` | 1.2 |
| AC-DEL-006 | Unit | `src/lib/db/delivery.test.ts` | 1.2 |
| AC-DEL-007 | Unit | `src/lib/db/delivery.test.ts` | 1.2 |
| AC-DEL-008 | Unit | `pages/project-detail/__tests__/MilestoneStrip.display.test.tsx` | 3.1 |
| AC-DEL-009 | Unit | `pages/project-detail/__tests__/MilestoneStrip.display.test.tsx` | 3.1 |
| AC-DEL-010 | Unit | `pages/project-detail/__tests__/TasksTab.grouping.test.tsx` | 3.6 |
| AC-DEL-011 | Unit | `pages/project-detail/__tests__/TasksTab.addInGroup.test.tsx` | 3.7 |
| AC-DEL-012 | Unit | `pages/project-detail/__tests__/MilestoneStrip.inlineEdit.test.tsx` (+ `src/auth/policy` gate) | 3.3, 1.5 |
| AC-DEL-013 | Unit | `components/__tests__/DeliveryPctChip.test.tsx` | 4.1 |
| AC-DEL-014 | Unit | `pages/project-detail/__tests__/MilestoneStrip.states.test.tsx` | 3.2 |
| AC-DEL-015 | pgTAP | `supabase/tests/0061_milestones_rls.test.sql` | 0.3 |
| AC-DEL-016 | pgTAP | `supabase/tests/0061_milestones_rls.test.sql` | 0.3 |
| AC-DEL-017 | pgTAP | `supabase/tests/0062_milestones_tenant_isolation.test.sql` | 0.4 |
| AC-DEL-018 | pgTAP | `supabase/tests/0062_milestones_tenant_isolation.test.sql` | 0.4 |
| AC-DEL-019 | pgTAP | `supabase/tests/0065_milestone_rollup_oracle.test.sql` | 0.7 |
| AC-DEL-020 | pgTAP | `supabase/tests/0064_milestone_checks_and_input_clear.test.sql` | 0.6 |
| AC-DEL-021 | pgTAP | `supabase/tests/0063_milestone_delete_sets_null.test.sql` | 0.5 |
| AC-DEL-022 | E2E | `e2e/AC-DEL-022-milestone-journey.spec.ts` | 5.1 |

Per-layer: 14 Unit · 7 pgTAP · 1 E2E = 22. Every behavior task names its AC and writes the failing test first (TDD).

---

## ADR

No new ADR. Milestone writes are plain role-gated RLS (within ADR-0019's boundary: RPC only for real SoD/destructive rules — milestone delete is Confirm-gated FE + RLS role check, no SoD axis). The two read RPCs follow the existing `get_*` security-invoker aggregation pattern (OD-ARCH-1) and ADR-0009/0014 — no architectural novelty. The detail-page placement follows ADR-0021. The hard-delete-over-soft-archive choice (D-1) is a Director per-issue resolution of the spec's OPEN-QUESTION-1, recorded here, not an org-wide reversal of ADR-0018; if the owner later wants undo, it is additive.

---

## Open questions for the Director

1. **`archived_at` divergence from the spec checklist.** The spec §FR-DEL-001 / implementation-checklist §537 list an `archived_at` column on `project_milestones`; the Director's OQ1 resolution (hard delete) makes it dead weight, so this plan **omits it** (D-1). Confirm the table ships without `archived_at` (the spec text should be reconciled, or the migration adds an unused nullable column for spec-literal fidelity). Recommend: omit it.
2. **PM-Dashboard chip file.** Task 4.3 names the dashboard surface via a `grep` the implementer runs; if the owner knows the exact component (e.g. a `PMDashboard.tsx` project table vs a shared card), naming it now saves one lookup. Non-blocking.
3. **Chip tone token.** `DeliveryPctChip` needs a tone; the plan says "delivery-tone token". If DESIGN.md has no existing neutral/info pill suited to a progress figure, the ui-implementer reuses the existing `StatusPill variant="open"`/neutral rather than minting a token (no new DESIGN.md token per the design-system rules). Confirm no new token is wanted.
