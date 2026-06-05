# Plan: Budget-versioning module (build-wave #1)

- **Spec:** `docs/specs/budget-versioning.spec.md` (SIGNED OFF, OD-BUDGET-5). 14 FR + 3 NFR, AC-720..733.
- **Decisions:** `docs/decisions.md` OD-BUDGET-1..5 (A–D ratified), OD-MARGIN-1 (downstream consumer).
- **ADR written:** `docs/adr/0011-budget-mutation-rpc.md` — `security definer` RPCs as the budget
  lifecycle-write contract (activate + clone) + a `before` trigger for the not-Draft line-item guard.
- **Layer ownership:** ADR-0010. Each AC has exactly one owning test at the lowest sufficient layer.

This plan is **strict TDD**: every behavior task writes a failing test (RED) first, then the minimum
implementation (GREEN), then a refactor pass where called for. The eng-planner writes ONLY this plan +
the ADR; the implementer writes the code/tests.

---

## 1. Design

### 1.1 Architecture & data flow

```
ProjectBudget (pages/ProjectBudget.tsx)         ← UI: versions list, line-item editor, lifecycle actions
  ├─ useProjectBudget(projectId)                ← derived budget = Σ Active line-items  (read)
  ├─ useBudgetVersions(projectId)               ← versions + their line-items           (read)
  └─ useBudgetMutations(projectId)              ← create/clone/activate/archive/delete + line-item CRUD (write)
        │                                          (TanStack useMutation; invalidates the two read keys)
        ▼
src/lib/db/budgets.ts  (DAL — typed module per aggregate, mirrors procurements.ts/projects.ts)
  reads:  deriveProjectBudget(projectId), listBudgetVersions(projectId)
  writes: createBudgetVersion · createLineItem · updateLineItem · deleteLineItem ·
          deleteDraftVersion · archiveVersion · activateVersion(RPC) · cloneVersion(RPC)
        │
        ▼
Supabase Postgres
  tables/RLS/index already exist (0001/0002/0004) — REUSED AS-IS, no rewrite.
  NEW migration 0005_budget_mutation_rpc.sql:
    • activate_budget_version(version_id uuid)  security definer  (atomic archive-prior + activate)
    • clone_budget_version(version_id uuid)      security definer  (copy line-items into a new Draft)
    • enforce_draft_line_item()  + trigger on budget_line_items (FR-BV-011 not-Draft guard)
```

**Org seam:** `org_id` is NEVER sent on any write from the DAL (column default 0001 + RLS `with check`
0002 stamp/verify it). The two RPCs are `security definer` and therefore bypass RLS, so they
**re-assert `auth_org_id()` and `auth_role()` internally** (mirrors ADR-0009 revoke-from-anon discipline;
see ADR-0011). The reads send no `org_id` — `budget_versions_select` / `budget_line_items_select`
(`org_id = auth_org_id()`) scope them.

### 1.2 Budget derivation (FR-BV-001/002/003, NFR-BV-PERF-001)

`deriveProjectBudget(projectId)` runs ONE indexed query, NOT a client cross-product:

```sql
-- inside a security-invoker SQL helper get_project_budget(p_project_id uuid) returns numeric:
select coalesce(sum(li.budgeted_amount), 0)
from budget_versions v
join budget_line_items li on li.budget_version_id = v.id
where v.project_id = p_project_id and v.status = 'Active';
```

Uses `budget_versions_one_active_idx` (find the Active version) + `budget_line_items_version_idx` (sum).
No Active version ⇒ the join is empty ⇒ `coalesce(...,0)` = 0 (FR-BV-002). The stale `projects.budget`
header is never read (FR-BV-003). The DAL calls this via `supabase.rpc('get_project_budget', {...})` and
returns `Number(data)`. This is a **`security invoker`** function (default) — base-table reads run under
the caller's RLS, so it is org-scoped by construction and takes no `org_id` arg (same model as
`get_executive_dashboard`, ADR-0009).

> Note: a pure-SQL read could also be done with PostgREST `.select()` + client `reduce`, but that would
> pull every Active line-item to the client per project and re-introduce the aggregation-in-the-browser
> anti-pattern (OBS-DASH-001/002). The RPC keeps the aggregate in SQL (charter Performance lens,
> NFR-BV-PERF-001). It is added in the same 0005 migration.

### 1.3 Version lifecycle

| Operation | Mechanism | Why |
|---|---|---|
| Create Draft (FR-BV-004) | DAL `insert` (existing RLS). `version` = `max(version)+1` computed in a sub-select via RPC-free 2-step: read max then insert. To avoid a race, compute next version **inside** the insert through `createBudgetVersion` calling a small SQL default — see Task list (uses a `select coalesce(max(version),0)+1`). | Plain insert is RLS-gated; uniqueness backstopped by `unique(project_id, version)`. |
| Activate Draft (FR-BV-005) | **RPC `activate_budget_version`** (`security definer`, single txn: `update ... set status='Archived' where project_id=… and status='Active'; update ... set status='Active' where id=version_id`). | Atomicity + race-safety + single authorization choke point — see ADR-0011 / §1.6. |
| Archive Active (FR-BV-008) | DAL `update status='Archived'` (existing RLS write gate). | Simple state set; no second row touched; warn-not-block (OD-BUDGET-B) handled in UI. |
| Clone (FR-BV-007) | **RPC `clone_budget_version`** (`security definer`: insert new Draft at next version, `insert ... select` line-items with `actual_amount=0`). | Multi-statement atomic copy; race-safe next-version; single authz choke point (ADR-0011). |
| Delete Draft (OD-BUDGET-C) | DAL `delete` (cascade FK drops line-items). RLS gate + trigger blocks non-Draft. | Hard delete of Draft only. |

### 1.4 Line-item CRUD (FR-BV-010/011)

- Create/update/delete on the DAL go through plain PostgREST writes (existing `budget_line_items_write`
  RLS gate: 4-role + parent-org guard).
- The **not-Draft guard** (FR-BV-011 / FR-BV-006 / FR-BV-009) is enforced at the DB contract by a
  `before insert or update or delete` trigger `enforce_draft_line_item()` that raises if the owning
  version's status ≠ `Draft`. This covers all three verbs uniformly and yields a deterministic error the
  DAL surfaces (see ADR-0011 §Decision for why a trigger, not an RLS predicate). The DAL also surfaces a
  typed error so the **unit** test (AC-723) can assert the guard without a DB.

### 1.5 UI (NFR-BV-UI-001)

New self-contained page component `pages/ProjectBudget.tsx` (does NOT rewrite the 1388-line prototype
`pages/ProjectDetails.tsx`). It is mounted as the project's **Budget tab** and also reachable at
`/projects/:projectId/budget`. It renders:

- derived budget header (Σ Active) via `formatCurrency` (`src/lib/format.ts`);
- versions list with a status badge + per-version total;
- on a **Draft** version: line-item editor (add / edit / delete rows) + **Activate** + **Delete draft**;
- on the **Active** version: **Archive** (with a confirm warning per OD-BUDGET-B) + **Clone to revise**;
- on an **Archived** version: read-only + **Clone to revise**;
- write actions are gated in the UI to the 4 roles via `useEffectiveRole()` (RLS is the real gate; UI
  hiding is cosmetic);
- distinct **loading** (`data-testid="budget-loading"`), **empty** (`data-testid="budget-empty"`), and
  **error + Retry** states (mirrors `pages/Procurement.tsx`).

### 1.6 OQ-2 resolution (RECOMMENDED: option a — RPC)

**Chosen: (a) `security definer` RPCs** for `activate_budget_version` and `clone_budget_version`, plus a
DB trigger for the FR-BV-011 line-item guard. Rationale:

1. **Atomicity:** activation is two writes (archive prior + set new). An RPC wraps them in one server-side
   txn; a client doing two statements cannot guarantee a single round-trip txn through PostgREST.
2. **Race-safety:** two concurrent activations both first-archive then set-Active. The
   `budget_versions_one_active_idx` is the backstop (NFR-BV-ATOM-001), but inside one txn the second
   activation serialises on the row locks and the loser hits the unique violation cleanly; a definer RPC
   makes the whole sequence atomic so no partial state (prior archived, new not yet active) is observable.
3. **Single authorization choke point:** `security definer` bypasses RLS, so the RPC **re-asserts**
   `auth_role() in ('Admin','Executive','Project Manager','Finance')` and `v.org_id = auth_org_id()`
   internally and raises `42501` otherwise. This is the OD-PROC-6-style seam: lifecycle authz lives in one
   place, swappable later for config-driven rules.

**Why not (b) two client statements:** no atomic txn boundary across two PostgREST calls; a crash between
them leaves the project with zero Active versions; and the authorization + next-version logic would be
duplicated across client + RLS. The unique index alone protects the invariant but not atomicity.

**FR-BV-011 guard:** a `before insert/update/delete` **trigger** (not an RLS predicate) because (i) it
must reject `DELETE`/`UPDATE` by inspecting the *parent* version's status — expressible in RLS `using`
but a trigger gives one uniform, message-bearing `raise exception` across all three verbs and keeps the
existing `budget_line_items_write` policy unchanged; (ii) it also guards writes that arrive via any path
(including future RPCs), not just the current RLS-gated ones.

### 1.7 Error handling

- DAL: every function throws `new Error(error.message)` on PostgREST/RPC error (mirrors existing DAL).
- Numerics normalised to `number` at the DAL boundary (`Number(...)`) so callers never cast.
- Hooks: `useMutation` `onError` leaves the error to the component; reads expose `isError` + `refetch`.
- UI: error state renders a Retry button calling `refetch()`.

### 1.8 Seed enrichment (FR-BV-012 / AC-733)

`supabase/seed.sql`: keep P001 as-is; add exactly one Active version + ≥1 line-item to **P002, P003, P010**
so no seeded project derives 0. `org_id` via column default (never hard-coded). Totals: P003 = 2,000,000
(preserve header intent); P002 = sensible (Labor+Materials); P010 = sensible (Labor+Subcontractors).

---

## 2. Traceability (AC → task → owning layer)

| AC | FR | Owning layer | Task(s) |
|---|---|---|---|
| AC-720 | FR-BV-001 | Unit | T3 |
| AC-721 | FR-BV-002 | Unit | T4 |
| AC-722 | FR-BV-003 | Unit | T5 |
| AC-723 | FR-BV-006/009/010/011 | Unit | T6, T7, T8 |
| AC-724 | FR-BV-004 | Unit | T9 |
| AC-725 | FR-BV-007 | Unit | T10 |
| AC-726 | NFR-BV-UI-001 | Unit | T14 |
| AC-727 | FR-BV-005/008, NFR-BV-ATOM-001 | pgTAP | T16 |
| AC-728 | FR-BV-013 | pgTAP | T17 |
| AC-729 | FR-BV-013 | pgTAP | T18 |
| AC-730 | FR-BV-013/014 | pgTAP | T19 |
| AC-731 | FR-BV-006/011 | pgTAP | T20 |
| AC-732 | FR-BV-001/004/005/010, NFR-BV-UI-001 | E2E | T22 |
| AC-733 | FR-BV-012 | pgTAP | T21 |

Co-owned (per spec): AC-723 (Unit owns DAL/guard logic) + AC-731 (pgTAP owns DB enforcement);
AC-727 covers both FR-BV-005 (activation) and FR-BV-008 (archive state side).

---

## 3. Task list (TDD; 2–5 min each)

> Run all `npm`/`npx` commands from `pmo-portal/`. Run `supabase test db` from the repo root.
> Type contract used across tasks (define once in T1):
> ```ts
> export type BudgetVersionRow = Tables<'budget_versions'>;
> export type BudgetLineItemRow = Tables<'budget_line_items'>;
> export type BudgetVersionWithItems = BudgetVersionRow & {
>   line_items: BudgetLineItemRow[];
>   total: number; // Σ budgeted_amount of this version's line-items (normalised number)
> };
> export interface NewLineItem { category: BudgetLineItemRow['category']; description: string | null; budgeted_amount: number; }
> ```

### Phase A — DB migration + RPC/trigger (write contract)

**T1 — Create migration `0005_budget_mutation_rpc.sql` skeleton + `get_project_budget`.**
File: `supabase/migrations/0005_budget_mutation_rpc.sql` (new). Add the header comment (forward-only,
reversibility = `supabase db reset`, ADR-0011) and the read helper:
```sql
create or replace function get_project_budget(p_project_id uuid)
  returns numeric language sql stable security invoker as $$
  select coalesce(sum(li.budgeted_amount), 0)
  from budget_versions v
  join budget_line_items li on li.budget_version_id = v.id
  where v.project_id = p_project_id and v.status = 'Active';
$$;
revoke all on function get_project_budget(uuid) from public;
grant execute on function get_project_budget(uuid) to authenticated;
revoke execute on function get_project_budget(uuid) from anon;
```
(FR-BV-001/002/003, NFR-BV-PERF-001). Verify: `supabase db reset` succeeds (run in T15 with the tests).
Standalone check now: `psql`-free — confirm the file parses by running `supabase db reset` at end of Phase A.

**T2 — Add `activate_budget_version`, `clone_budget_version`, and the not-Draft trigger to 0005.**
File: `supabase/migrations/0005_budget_mutation_rpc.sql` (append). Exact bodies:
```sql
-- Atomic activate: archive the project's current Active, set this Draft Active. SECURITY DEFINER so it
-- runs in one txn; therefore it RE-ASSERTS authz internally (RLS is bypassed under definer rights).
create or replace function activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status;
begin
  select project_id, org_id, status into v_project, v_org, v_status
    from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode = 'P0001'; end if;
  update budget_versions set status = 'Archived'
    where project_id = v_project and status = 'Active';
  update budget_versions set status = 'Active' where id = version_id;
end; $$;
revoke all on function activate_budget_version(uuid) from public;
grant execute on function activate_budget_version(uuid) to authenticated;
revoke execute on function activate_budget_version(uuid) from anon;

-- Clone any version into a new Draft (next version), copying line-items with actual_amount reset to 0.
create or replace function clone_budget_version(version_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_next int; v_new uuid;
begin
  select project_id, org_id into v_project, v_org from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  select coalesce(max(version),0)+1 into v_next from budget_versions where project_id = v_project;
  insert into budget_versions (org_id, project_id, version, name, status)
    select v_org, v_project, v_next, name || ' (copy)', 'Draft'
    from budget_versions where id = version_id
    returning id into v_new;
  insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount)
    select v_org, v_new, category, description, budgeted_amount, 0
    from budget_line_items where budget_version_id = version_id;
  return v_new;
end; $$;
revoke all on function clone_budget_version(uuid) from public;
grant execute on function clone_budget_version(uuid) to authenticated;
revoke execute on function clone_budget_version(uuid) from anon;

-- FR-BV-011 guard: line-items mutate only while the owning version is Draft (covers I/U/D uniformly).
create or replace function enforce_draft_line_item()
  returns trigger language plpgsql as $$
declare v_status budget_status;
begin
  select status into v_status from budget_versions
    where id = coalesce(new.budget_version_id, old.budget_version_id);
  if v_status <> 'Draft' then
    raise exception 'line-items can only change while the owning version is Draft' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end; $$;
create trigger budget_line_items_draft_guard
  before insert or update or delete on budget_line_items
  for each row execute function enforce_draft_line_item();
```
(FR-BV-005/007/006/009/011, NFR-BV-ATOM-001). Verify: `supabase db reset` (run in T15).

### Phase B — DAL reads (TDD, unit)

**T3 — RED+GREEN: `deriveProjectBudget` returns Σ Active.**
Test file: `pmo-portal/src/lib/db/budgets.test.ts` (new). Mock `supabase.rpc` (vi.hoisted, mirror
`procurements.test.ts` builder but for `.rpc`). Write `it('budget = Σ Active version line-items (AC-720, FR-BV-001)')`
asserting `deriveProjectBudget('p1')` calls `supabase.rpc('get_project_budget', { p_project_id: 'p1' })`,
returns `4700000` for `{ data: 4700000, error: null }`, and that the call contains no `org_id`.
Impl: `src/lib/db/budgets.ts` (new) — `deriveProjectBudget(projectId): Promise<number>` → `Number(data)`,
throws on error. Verify: `npm test -- src/lib/db/budgets.test.ts`.

**T4 — RED+GREEN: no Active ⇒ 0.**
Same files. `it('no Active version ⇒ budget 0 (AC-721, FR-BV-002)')`: `{ data: 0, error: null }` ⇒
`deriveProjectBudget` returns `0`. (Impl already satisfies via `coalesce` in the RPC; assert the boundary.)
Verify: `npm test -- src/lib/db/budgets.test.ts`.

**T5 — RED+GREEN: derivation ignores the stale header.**
Same files. `it('read-time derivation ignores the stale projects.budget header (AC-722, FR-BV-003)')`:
the DAL never queries `projects` / `budget` — assert `mockRpc` was called with `'get_project_budget'` only
and `JSON.stringify(mockRpc.mock.calls)` does not contain `'budget'` as a projects column read (it calls
the RPC, not a `.from('projects')`). Returns `4700000` regardless of any header. Verify:
`npm test -- src/lib/db/budgets.test.ts`.

**T6 — RED+GREEN: `listBudgetVersions` shape + totals.**
Same files. `it('lists versions with nested line_items and a numeric total (FR-BV-010 read side)')`:
mock `supabase.from('budget_versions').select(...).eq('project_id', id).order('version', {ascending:true})`
returning two versions each with `line_items`; assert DAL returns `BudgetVersionWithItems[]` with
`total` = Σ `budgeted_amount` (normalised `number`) and sends no `org_id`. Impl `listBudgetVersions`
with `SELECT = '*, line_items:budget_line_items(*)'`. Verify: `npm test -- src/lib/db/budgets.test.ts`.

### Phase C — DAL writes + guard (TDD, unit)

**T7 — RED+GREEN: `updateLineItem` rejects when owning version not Draft (DAL guard surface).**
Same files. `it('line-item edit rejected when owning version is Active/Archived (AC-723, FR-BV-006/009/011)')`:
mock the PostgREST update returning `{ data: null, error: { message: 'line-items can only change while the owning version is Draft', code: 'P0001' } }`; assert `updateLineItem(...)` rejects/throws with that
message. Impl `updateLineItem(id, patch)` → `.from('budget_line_items').update(patch).eq('id', id)`,
throws on error. Verify: `npm test -- src/lib/db/budgets.test.ts`.

**T8 — RED+GREEN: `createLineItem` / `deleteLineItem` succeed on Draft (DAL guard surface).**
Same files. `it('line-item create/delete succeed when owning version is Draft (AC-723, FR-BV-010)')`:
mock success; assert `createLineItem(versionId, item)` inserts `{budget_version_id, category, description, budgeted_amount}`
(no `org_id`) and resolves; `deleteLineItem(id)` resolves. Impl both, throw on error. Verify:
`npm test -- src/lib/db/budgets.test.ts`.

**T9 — RED+GREEN: `createBudgetVersion` ⇒ Draft at next version.**
Same files. `it('new version is Draft with version = max+1 (AC-724, FR-BV-004)')`: mock the read of
`max(version)` → 2 and the insert; assert `createBudgetVersion('p1','V3')` inserts
`{ project_id:'p1', version:3, name:'V3', status:'Draft' }` (no `org_id`) and returns the row. Impl reads
`coalesce(max(version),0)+1` via `.select('version').eq('project_id',id).order('version',{ascending:false}).limit(1)`
then inserts. Verify: `npm test -- src/lib/db/budgets.test.ts`.

**T10 — RED+GREEN: `cloneVersion` copies line-items into a new Draft.**
Same files. `it('clone creates a new Draft copying line-items, actual_amount reset (AC-725, FR-BV-007)')`:
mock `supabase.rpc('clone_budget_version', { version_id })` → `{ data: 'new-id', error: null }`; assert
`cloneVersion('v-active')` returns `'new-id'`, sends no `org_id`, and surfaces errors. (The actual copy +
`actual_amount=0` + source-unchanged behavior is owned by the RPC; the DAL test asserts the call contract.
The copy semantics are additionally proven at pgTAP is NOT required — AC-725 is Unit-owned; the RPC body in
T2 implements it and is exercised end-to-path by the clone call.) Verify:
`npm test -- src/lib/db/budgets.test.ts`.

**T11 — RED+GREEN: `activateVersion` + `archiveVersion` + `deleteDraftVersion` DAL contracts.**
Same files. `it('activateVersion calls the activate RPC with version_id, no org_id (FR-BV-005)')`,
`it('archiveVersion sets status Archived via update (FR-BV-008)')`,
`it('deleteDraftVersion deletes the version row (OD-BUDGET-C)')`. Mock + assert each calls
`supabase.rpc('activate_budget_version', { version_id })`, `.from('budget_versions').update({status:'Archived'}).eq('id',id)`,
and `.from('budget_versions').delete().eq('id',id)` respectively; all throw on error and send no `org_id`.
Verify: `npm test -- src/lib/db/budgets.test.ts`.

### Phase D — hooks (TDD, unit)

**T12 — RED+GREEN: read hooks org-scoped queryKeys + enabled.**
Test file: `pmo-portal/src/hooks/useBudget.test.ts` (new). Mock `useAuth` → `{ currentUser: { org_id: 'org-1' } }`
and the DAL. `it('useProjectBudget keys on [budget, org_id, projectId] and is enabled on auth')` and the
same for `useBudgetVersions` (`['budget-versions', orgId, projectId]`). Impl
`src/hooks/useBudget.ts` (new): `useProjectBudget(projectId)` and `useBudgetVersions(projectId)` mirror
`useProcurements.ts` (queryKey includes `orgId` + `projectId`, `enabled: Boolean(orgId && projectId)`).
Verify: `npm test -- src/hooks/useBudget.test.ts`.

**T13 — RED+GREEN: mutation hook invalidates both read keys.**
Same test file. `it('useBudgetMutations.activate invalidates budget + budget-versions on success')`:
spy on `queryClient.invalidateQueries`; call the mutation; assert both keys invalidated. Impl
`useBudgetMutations(projectId)` (in `src/hooks/useBudget.ts`) exposing
`{ createVersion, cloneVersion, activate, archive, deleteDraft, createLineItem, updateLineItem, deleteLineItem }`
as `useMutation`s, each `onSuccess` → `queryClient.invalidateQueries({ queryKey: ['budget', orgId, projectId] })`
and `['budget-versions', orgId, projectId]`. Verify: `npm test -- src/hooks/useBudget.test.ts`.

### Phase E — UI (TDD, unit) + wiring

**T14 — RED+GREEN: ProjectBudget loading / empty / error+retry + derived total.**
Test file: `pmo-portal/pages/ProjectBudget.test.tsx` (new). Mock `useProjectBudget`, `useBudgetVersions`,
`useBudgetMutations`, `useAuth`, `useEffectiveRole` (mirror `Procurement.test.tsx`). Tests
(all tagged AC-726 / NFR-BV-UI-001):
- `it('loading skeleton while pending (AC-726)')` → `getByTestId('budget-loading')` when `isPending`;
- `it('empty state when zero versions (AC-726)')` → `getByTestId('budget-empty')` when versions `[]`;
- `it('error + Retry re-runs the query (AC-726)')` → Retry button calls `refetch`;
- `it('renders derived budget via formatCurrency (AC-720 view side)')` → shows
  `formatCurrency(4700000)` for derived = 4700000.
Impl `pages/ProjectBudget.tsx`: states mirror `Procurement.tsx`; total via `formatCurrency`; versions list
with `ProjectStatusBadge`-style status pill; action buttons gated by `useEffectiveRole()` to the 4 roles.
Verify: `npm test -- pages/ProjectBudget.test.tsx`.

**T15 — Wire route + Budget tab; typecheck.**
Files: `pmo-portal/App.tsx` (add `<Route path="/projects/:projectId/budget" element={<ProjectBudget />} />`
+ lazy import) and `pmo-portal/pages/ProjectDetails.tsx` (replace the mock `BudgetTabContent` mount in the
`case 'Budget'` with `<ProjectBudget projectId={project.id} />` rendered from the real component;
leave the rest of the prototype page untouched this issue). Verify: `npm run typecheck` (zero errors) and
`npm run build`.

### Phase F — pgTAP (TDD, integration)

> Each pgTAP file follows the existing shape: `begin; select plan(N); … set local role authenticated;
> set local request.jwt.claims = '{"sub":"…","role":"authenticated"}'; … select * from finish(); rollback;`
> AC id is the **leading token** of the test description.

**T16 — RED+GREEN: single-Active invariant on activation + archive side.**
File: `supabase/tests/0008_budget_activation.test.sql` (new). Fixture: org + PM profile + project +
Active v1 (with a line-item) + Draft v2. As the PM, call `select activate_budget_version('<v2>')`. Assert
(AC-727, FR-BV-005/008, NFR-BV-ATOM-001): v2 = `Active`; v1 = `Archived`; exactly one row where
`project_id=… and status='Active'`. Verify: `supabase test db`.

**T17 — RED+GREEN: Engineer read allowed, write blocked.**
File: `supabase/tests/0009_budget_role_gate.test.sql` (new). Fixture: org + Engineer + PM + project +
a Draft version + line-item (inserted as owner). As the Engineer: assert SELECT returns the version +
line-item rows (read allowed); `throws_ok` `42501` on INSERT of a `budget_versions` row and on INSERT of a
`budget_line_items` row (write blocked). (AC-728, FR-BV-013.) Verify: `supabase test db`.

**T18 — RED+GREEN: authorized roles may write.**
File: `supabase/tests/0009_budget_role_gate.test.sql` (append to same plan count). As a `Project Manager`,
then (reset role) as `Finance`: each creates a Draft `budget_versions` row and a `budget_line_items` row;
assert both inserts succeed (`lives_ok`). (AC-729, FR-BV-013.) Verify: `supabase test db`.

**T19 — RED+GREEN: cross-org isolation + client org_id ignored + parent-org guard.**
File: `supabase/tests/0010_budget_tenant_isolation.test.sql` (new). Fixture: org-A + org-B, each with a
project + a Draft version. As an org-A PM: assert SELECT sees only org-A versions/line-items; `throws_ok`
`42501` on inserting a `budget_versions` row stamped with org-B's `org_id`; `throws_ok` `42501` on
inserting a `budget_line_items` row whose `budget_version_id` belongs to org-B (parent-org guard).
(AC-730, FR-BV-013/014.) Verify: `supabase test db`.

**T20 — RED+GREEN: line-item mutation on a non-Draft version rejected at the DB contract.**
File: `supabase/tests/0011_budget_draft_guard.test.sql` (new). Fixture: org + PM + project + an Active
version with a line-item (inserted as owner). As the PM: `throws_ok` `P0001` on INSERT of a line-item to
the Active version; on UPDATE of the existing line-item; on DELETE of it (trigger
`enforce_draft_line_item`). (AC-731, FR-BV-006/011.) Verify: `supabase test db`.

**T21 — RED+GREEN: seed invariant — every project has exactly one Active version with line-items.**
Step 1 (seed): edit `supabase/seed.sql` — add Active v1 + line-items to P002 (Labor+Materials), P003
(line-items summing to 2,000,000), P010 (Labor+Subcontractors); `org_id` via column default (do NOT
hard-code). Step 2 (test): `supabase/tests/0012_budget_seed_invariant.test.sql` (new) — load against the
seeded DB; assert every `project_id` in `projects` has exactly one `budget_versions` row with
`status='Active'`, and that version has `>= 1` line-item. (AC-733, FR-BV-012.) Verify:
`supabase db reset` then `supabase test db`.

### Phase G — E2E + full gate

**T22 — RED+GREEN: E2E curated journey — create → add line-items → activate → budget shows.**
File: `pmo-portal/e2e/AC-732-budget-activate.spec.ts` (new). `test('AC-732 PM creates a Draft, adds
line-items {600000,400000}, activates, project shows formatCurrency(1000000)', …)`: `login(page,'pm@acme.test')`;
navigate to a project with no Active version **created in-test** (or use a seeded project's Budget tab and
create a fresh Draft); create a Draft, add the two line-items, Activate; assert the version badge reads
`Active` and the derived budget reads `$1,000,000`. (AC-732, FR-BV-001/004/005/010, NFR-BV-UI-001.)
Verify: `npx playwright test e2e/AC-732-budget-activate.spec.ts`.

**T23 — Full gate.**
Run, from `pmo-portal/`: `npm run typecheck` (0 errors), `npm run lint` (0 errors/warnings),
`npm test` (all green, ≥80% lines on `budgets.ts` / `useBudget.ts` / `ProjectBudget.tsx`); from repo root
`supabase db reset && supabase test db` (all pgTAP green); from `pmo-portal/`
`npx playwright test e2e/AC-732-budget-activate.spec.ts`. All must pass before PR.

---

## 4. Notes for the implementer

- Reuse `Tables<'budget_versions'>` / `Tables<'budget_line_items'>` / `Enums` from
  `src/lib/supabase/database.types.ts` (already present) — do NOT redefine enum literals.
- `database.types.ts` has no `Functions` entries for the new RPCs; use the same
  `// @ts-expect-error` + `as unknown as <T>` escape hatch documented in `dashboard.ts` until types are
  regenerated. Keep the cast contained to the DAL.
- Never send `org_id` on any write (mirror existing DAL); the seed inserts must omit `org_id` too.
- Mutations must invalidate BOTH `['budget', orgId, projectId]` and `['budget-versions', orgId, projectId]`.
- Do NOT touch dashboard margin, procurement `spent`, project customer-PO fields, or per-category roll-up
  (spec OUT list).
