# Implementation plan — `user_views` persistence entity (Issue I1)

> **Spec:** `docs/specs/user-views.spec.md` (signed). **ADR:** `docs/adr/0036-agent-native-user-composed-ui.md` §6/§10 (first build slice of §10.1).
> **Date:** 2026-06-29. **Owning agent:** eng-planner. **Build agent:** implementer (TDD, red-green-refactor).
>
> **Scope (locked, Director):** persistence layer ONLY — `user_views` table + RLS (+ pgTAP), `src/lib/db/userViews.ts` DAL, `userView` repository entry, `useUserViews()` hook. The `spec jsonb` column is stored/returned **opaquely** (FR-UV-004). No UI, no routes, no e2e this issue.
>
> **Reference slice (template):** Companies — `supabase/migrations/0001_init_schema.sql` (DDL) + `0002_rls.sql` (RLS helpers/policies) + `0012_soft_archive.sql` (archive column/index) + `0004_force_rls.sql` (force RLS) + `0013` (restrictive delete) for the migration; `supabase/tests/0051_companies_crud.test.sql` + `0002_tenant_isolation.test.sql` for pgTAP; `pmo-portal/src/lib/db/companies.ts` (+ `companies.test.ts`) for the DAL; `src/lib/repositories/{types,index}.ts` for the seam; `pmo-portal/src/hooks/useCompanies.ts` (+ `useCompanies.test.tsx`) for the hook.

---

## 0. Design (brainstorm outcome)

### 0.1 Architecture & data flow
Identical 3-layer shape to every shipped entity (ADR-0017): **FE hook (`useUserViews`)** → **repository seam (`repositories.userView`, normalizes thrown values to `AppError`)** → **DAL (`src/lib/db/userViews.ts`, the only module that touches the supabase client)** → **Postgres + RLS**. `org_id`/`user_id` are NEVER sent by the client — the column default stamps `org_id`, RLS `WITH CHECK` pins it, and `user_id` is set to `auth.uid()` by the INSERT policy's check (the client supplies `user_id = auth.uid()` only via the default-org/own-uid path; see §0.4). RLS is the sole enforcement authority (ADR-0016: `can()` is UX-only — and there is no UI this issue).

### 0.2 The one deliberate difference from Companies — owner-private-by-default
Every existing business table is "read-in-org for all members". `user_views` is **owner-private by default** (ADR-0036 §6 corrected model): a row is visible to its owner always, and to same-org members only when `scope = 'shared_org'`. This lives entirely in the SELECT policy predicate:
`user_id = auth.uid() OR (scope = 'shared_org' AND org_id = auth_org_id())`. There is **no org-wide `..._select using (org_id = auth_org_id())`** policy here — that would leak private rows.

### 0.3 Authorization model (baked-in owner decisions)
- **OD-1** — `scope` CHECK permits `'private' | 'shared_org' | 'shared_roles'`; `shared_roles` is **stored but not row-level-enforced** this issue (RLS treats it like `private` — owner-only — until I6). No later CHECK migration needed.
- **OD-2** — Admin write reach: UPDATE/DELETE permitted to the owner OR an org Admin (`auth_role() = 'Admin'`), org-scoped. Admin **read** of another user's `private` row is NOT granted (SELECT policy does not expose it) — the documented read/write asymmetry.
- **OD-3** — both `archiveUserView` (soft, ADR-0018 default) and `deleteUserView` (hard, owner/Admin) are exposed.
- **OQ-1** — no `(user_id, name)` uniqueness constraint (views are id-addressed).
- **OQ-2** — `update_updated_at_column()` **does NOT exist** in any migration (verified: `grep -r update_updated_at_column supabase/migrations` → no matches). Therefore **no DB trigger** is created; `updated_at` is bumped **explicitly in the DAL** `updateUserView`/`archiveUserView` calls (`updated_at: new Date().toISOString()`). This matches the "set explicitly in the DAL" fallback the brief specifies.

### 0.4 INSERT path note (org_id/user_id stamping)
`org_id` comes from the column default (`'000…0001'`, the canonical default org) and is pinned by `WITH CHECK (org_id = auth_org_id())`. `user_id` has no column default — the DAL must NOT send `org_id`, but it cannot let `user_id` default either. The INSERT path sends **`user_id` only as the caller's own id via `auth.uid()`**: the DAL does not have `auth.uid()` client-side, so the production insert sends nothing for `user_id` and relies on a column default of `auth.uid()`. **Decision:** add `user_id uuid not null default auth.uid()` so the client sends neither `org_id` nor `user_id`, and the `WITH CHECK (user_id = auth.uid())` pins it. This keeps the DAL signature identical to Companies (no id threading) and is the cleanest seam. The pgTAP proof (AC-UV-005) verifies the stamp.

### 0.5 Indexes (NFR-UV-PERF-001)
Per the build-kit baseline: `user_views_org_id_idx (org_id)`, `user_views_live_idx (org_id) where archived_at is null` (default-list fast path), `user_views_user_id_idx (user_id) where archived_at is null` (owner-list fast path). These cover the two hot read shapes (owner list, shared-org list) without full scans as rows grow.

### 0.6 Reversibility (NFR-UV-REV-001)
Additive forward migration; pre-production reversibility contract is `supabase db reset`. The header documents the manual rollback (drop indexes, drop policies, drop table). No `seed.sql` change (local-only if ever added; never prod).

### 0.7 Test-layer mapping (ADR-0010)
- **AC-UV-001..006** → **pgTAP** (RLS/tenancy/scope/soft-archive). Validated by the CI `integration` job on the `dev`→`main` PR (no local Docker). Split across two files per the build-kit: `0088_user_views_crud.test.sql` (CRUD + owner/role gate: AC-UV-001, 004, 005, 006) and `0089_user_views_tenancy.test.sql` (org isolation + scope-share: AC-UV-002, 003).
- **AC-UV-007** → **Vitest** `pmo-portal/src/lib/db/userViews.test.ts` (mocked supabase) — local `npm test`.
- **AC-UV-008** → **Vitest** `pmo-portal/src/hooks/useUserViews.test.tsx` (test `QueryClient`) — local `npm test`.

> **Note on test file paths.** The build-kit brief referenced `src/lib/db/__tests__/userViews.test.ts` and `src/hooks/__tests__/useUserViews.test.tsx`, but the **actual repo convention is co-located** (`companies.test.ts` sits beside `companies.ts`; `useCompanies.test.tsx` beside `useCompanies.ts`) and the signed spec's traceability table uses the co-located paths. This plan follows the repo convention + spec: `pmo-portal/src/lib/db/userViews.test.ts` and `pmo-portal/src/hooks/useUserViews.test.tsx`.

### 0.8 Type-regen constraint
`Tables<'user_views'>` does not exist until `database.types.ts` includes the table. `supabase gen types` needs a running DB (no local Docker here), so the implementer **hand-adds** the `user_views` `Row`/`Insert`/`Update`/`Relationships` block to `database.types.ts` (Task 5), mirroring the existing `companies` block shape exactly (string-typed columns; `Json` for `spec`).

---

## Phase A — Migration (DDL + RLS + force RLS + indexes)

### Task A1 — Create the migration file with the table DDL
**File:** `supabase/migrations/0045_user_views.sql` (new; next free number — highest existing is 0044).
**Action:** create the file with a header comment (mirroring `0001`/`0012` style: purpose, owner-decisions baked in, reversibility) and the table DDL:

```sql
-- 0045_user_views.sql — the user_views persistence entity (ADR-0036 §6/§10.1, Issue I1).
-- Owner-private-by-default saved-view definitions. Mirrors the Companies slice (0001 DDL + 0002 RLS
-- + 0004 force-rls + 0012 archive). Reuses auth_org_id()/auth_role() from 0002 (NOT redefined here).
-- Owner-decisions baked in: OD-1 scope CHECK permits 'shared_roles' but RLS does not yet row-level-
-- enforce it (treated as private until I6); OD-2 Admin may UPDATE/DELETE any same-org view (read of a
-- private row is NOT granted); OD-3 archive (soft) + delete (hard) both exposed; OQ-1 no name uniqueness;
-- OQ-2 no update_updated_at_column() trigger exists in the schema, so updated_at is bumped in the DAL.
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback:
--   drop index if exists public.user_views_user_id_idx;
--   drop index if exists public.user_views_live_idx;
--   drop index if exists public.user_views_org_id_idx;
--   drop policy if exists user_views_delete on user_views;
--   drop policy if exists user_views_update on user_views;
--   drop policy if exists user_views_insert on user_views;
--   drop policy if exists user_views_select on user_views;
--   drop table if exists public.user_views;

create table user_views (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  user_id     uuid not null references profiles(id) default auth.uid(),
  name        text not null,
  description text,
  spec        jsonb not null default '{}'::jsonb,
  scope       text not null default 'private' check (scope in ('private','shared_org','shared_roles')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);
```
**Satisfies:** FR-UV-001, FR-UV-002 (the `scope` CHECK), FR-UV-003 (`org_id`/`user_id` defaults).
**Verify:** `grep -n "create table user_views" /home/user/PMO/supabase/migrations/0045_user_views.sql` (file exists with the table). Full DDL validity is proven by the pgTAP run in CI integration.

### Task A2 — Add the indexes (append to `0045_user_views.sql`)
**File:** `supabase/migrations/0045_user_views.sql` (append).
**Action:** append the three indexes:
```sql
-- Hot-path indexes (NFR-UV-PERF-001): per-org listing + live-only fast path + owner-list fast path.
create index user_views_org_id_idx  on user_views (org_id);
create index user_views_live_idx    on user_views (org_id) where archived_at is null;
create index user_views_user_id_idx on user_views (user_id) where archived_at is null;
```
**Satisfies:** NFR-UV-PERF-001.
**Verify:** `grep -c "create index user_views" /home/user/PMO/supabase/migrations/0045_user_views.sql` → `3`.

### Task A3 — Enable + force RLS (append to `0045_user_views.sql`)
**File:** `supabase/migrations/0045_user_views.sql` (append).
**Action:** append (mirror `0002` enable + `0004` force):
```sql
alter table user_views enable row level security;
alter table user_views force row level security;
```
**Satisfies:** FR-UV-008, NFR-UV-SEC-001.
**Verify:** `grep -n "enable row level security\|force row level security" /home/user/PMO/supabase/migrations/0045_user_views.sql` (both present).

### Task A4 — RLS SELECT policy: owner-private-by-default (append to `0045_user_views.sql`)
**File:** `supabase/migrations/0045_user_views.sql` (append).
**Action:** append the SELECT policy (the deliberate difference vs Companies — NO org-wide select):
```sql
-- SELECT: owner always; same-org members only for shared_org rows. A private/shared_roles row owned by
-- another user is invisible even to same-org members and to Admin (OD-1/OD-2 read asymmetry). org_id is
-- the wall: a shared_org row in another org is never returned (cross-org → 0 rows).
create policy user_views_select on user_views for select
  using (user_id = auth.uid() or (scope = 'shared_org' and org_id = auth_org_id()));
```
**Satisfies:** FR-UV-005 (AC-UV-001, AC-UV-002, AC-UV-003).
**Verify:** `grep -n "user_views_select" /home/user/PMO/supabase/migrations/0045_user_views.sql`. Behavior proven by pgTAP AC-UV-001/002/003 in CI integration.

### Task A5 — RLS INSERT/UPDATE/DELETE policies (append to `0045_user_views.sql`)
**File:** `supabase/migrations/0045_user_views.sql` (append).
**Action:** append the write policies (OD-2 Admin reach baked into UPDATE/DELETE `using`):
```sql
-- INSERT: org pinned to caller's org (default + check) and owner pinned to the caller (auth.uid()).
create policy user_views_insert on user_views for insert
  with check (org_id = auth_org_id() and user_id = auth.uid());

-- UPDATE: in-org AND (owner OR Admin); the post-image org stays in the caller's org (OD-2).
create policy user_views_update on user_views for update
  using (org_id = auth_org_id() and (user_id = auth.uid() or auth_role() = 'Admin'))
  with check (org_id = auth_org_id());

-- DELETE: in-org AND (owner OR Admin) (OD-2; OD-3 hard-delete path).
create policy user_views_delete on user_views for delete
  using (org_id = auth_org_id() and (user_id = auth.uid() or auth_role() = 'Admin'));
```
**Satisfies:** FR-UV-006 (AC-UV-005), FR-UV-007 (AC-UV-004), FR-UV-003.
**Verify:** `grep -c "create policy user_views_" /home/user/PMO/supabase/migrations/0045_user_views.sql` → `4` (select + insert + update + delete). Behavior proven by pgTAP AC-UV-004/005 in CI integration.

---

## Phase B — pgTAP proofs (validated in CI integration; no local Docker)

### Task B1 — CRUD + owner/role gate pgTAP file
**File:** `supabase/tests/0088_user_views_crud.test.sql` (new).
**Action:** write a `begin; select plan(N); … select * from finish(); rollback;` file mirroring `0051_companies_crud.test.sql`. Use a unique fixture namespace (`00880000-…`). Seed: org A = default org `00000000-…-0001`; users Ann (`…a1`, Engineer), Bob (`…a2`, Engineer/non-Admin), Admin (`…a3`, Admin) all in org A. Insert (as table owner) Ann's `private` view "Ann-Only", Bob's `private` "Bob-Only", and a row Bob will try to write. Each test description leads with its AC id. Cover:
- **AC-UV-001:** as Ann (`set local role authenticated; set local request.jwt.claims = '{"sub":"…a1","role":"authenticated"}'`) — `is( (select count(*)::int from user_views where name='Ann-Only'), 1, 'AC-UV-001: owner reads their own private view')` and `is( (select count(*)::int from user_views where name='Bob-Only'), 0, 'AC-UV-001: owner does NOT see another user''s private view')`.
- **AC-UV-005:** as Ann — `lives_ok($$ insert into user_views (name, spec) values ('Ann New', '{"k":1}'::jsonb) $$, 'AC-UV-005: owner INSERT with name/spec only — org_id+user_id stamped')`; then `reset role` and assert the new row's `org_id` = `00000000-…-0001` and `user_id` = Ann. Then as Ann `throws_ok($$ insert into user_views (org_id, name, spec) values ('<org-B uuid>','Spoof','{}'::jsonb) $$, '42501', null, 'AC-UV-005: cross-org spoofed INSERT rejected (WITH CHECK → 42501)')`. (Requires org B seeded — co-locate with B2's org or seed an extra org here.)
- **AC-UV-004:** as Bob — `lives_ok($$ update user_views set name='Hijack' where name='Ann-Only' $$, 'AC-UV-004: non-owner non-Admin UPDATE is a 0-row no-op (USING hides the row)')`, then `reset role` + `is((select name from user_views where … Ann's row), 'Ann-Only', 'AC-UV-004: Ann''s view name unchanged')`; and as Bob `lives_ok($$ delete from user_views where … Ann's row $$, 'AC-UV-004: non-owner DELETE is a 0-row no-op')` + assert the row still exists. (Per the Companies precedent, RLS USING denial on UPDATE/DELETE is a silent 0-row no-op, not `42501`; the spec's "denied (42501)" is satisfied by "the write does not take effect". State this note in a comment.)
- **AC-UV-006:** as Ann — archive her own view (`update user_views set archived_at = now() where name='Ann-Only'`), then assert `is((select count(*)::int from user_views where name='Ann-Only' and archived_at is null), 0, 'AC-UV-006: archived row excluded from the live (archived_at is null) list')` AND `is((select count(*)::int from user_views where name='Ann-Only'), 1, 'AC-UV-006: the row still exists (soft-archive, not hard-delete)')`.
**Satisfies:** AC-UV-001, AC-UV-004, AC-UV-005, AC-UV-006.
**Verify:** validated by the CI `integration` job on the `dev`→`main` PR (`supabase test db`). Local check only: `grep -c "AC-UV-00" /home/user/PMO/supabase/tests/0088_user_views_crud.test.sql` ≥ 8 (each AC referenced) and `plan(N)` matches the number of test calls.

### Task B2 — Tenancy + scope-share pgTAP file
**File:** `supabase/tests/0089_user_views_tenancy.test.sql` (new).
**Action:** write a `begin; … rollback;` file mirroring `0002_tenant_isolation.test.sql`. Seed org A (default `…0001`) + org B (`00890000-…0002`); Ann (`…a1`) in A, Bob (`…a2`) in A, Carol (`…b1`) in org B. Insert (table owner) Ann's `shared_org` view "Team Board" in org A. Cover:
- **AC-UV-003:** as Bob (org A) — `is((select count(*)::int from user_views where name='Team Board'), 1, 'AC-UV-003: shared_org view is visible to a same-org member')`; as Carol (org B) — `is((select count(*)::int from user_views where name='Team Board'), 0, 'AC-UV-003: shared_org view is NOT visible to another org')`.
- **AC-UV-002:** also insert Ann's `private` "Ann Private" + keep "Team Board" (`shared_org`); as Carol (org B) — `is((select count(*)::int from user_views where org_id = '<org-A default>'), 0, 'AC-UV-002: cross-org SELECT returns zero regardless of scope — org_id is the wall')`.
**Satisfies:** AC-UV-002, AC-UV-003.
**Verify:** validated by the CI `integration` job. Local check: `grep -c "AC-UV-002\|AC-UV-003" /home/user/PMO/supabase/tests/0089_user_views_tenancy.test.sql` ≥ 3; `plan(N)` matches test-call count.

---

## Phase C — Types regen (so `Tables<'user_views'>` exists)

### Task C1 — Hand-add the `user_views` block to `database.types.ts`
**File:** `pmo-portal/src/lib/supabase/database.types.ts` (edit — insert the `user_views` table block into `Database.public.Tables`, alphabetical position after `timesheet_entries`/before any later table, or append at the end of `Tables`).
**Action:** add (mirroring the `companies` block shape exactly; `spec` is `Json`):
```ts
      user_views: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
          scope: string
          spec: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id?: string
          scope?: string
          spec?: Json
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          scope?: string
          spec?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_views_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
```
> Fallback note: once Docker is available, `supabase gen types typescript --local > src/lib/supabase/database.types.ts` regenerates this; the hand-add must match that output (same alphabetical placement, same column ordering as gen produces).
**Satisfies:** enabling (FR-UV-009/010 type plumbing).
**Verify:** `cd /home/user/PMO/pmo-portal && npm run typecheck` (zero errors — confirms the block parses and `Tables<'user_views'>` resolves). This is run as part of the final `npm run verify` (Task F1); run it standalone here after the edit.

---

## Phase D — DAL (`src/lib/db/userViews.ts`) — TDD

### Task D1 — RED: write the DAL unit test
**File:** `pmo-portal/src/lib/db/userViews.test.ts` (new).
**Action:** copy the chainable-mock harness from `companies.test.ts` verbatim (the `vi.hoisted` builder + `vi.mock('@/src/lib/supabase/client', …)` + `beforeEach` reset), import the six functions from `./userViews`, and write the `AC-UV-007` cases (each `it(...)` title leads with `AC-UV-007:`):
- list: `h.result.value = { data: [row], error: null }` → `listUserViews()` calls `from('user_views')`, filters `is(['archived_at', null])`, orders `['updated_at', { ascending: false }]` (assert `h.calls.order` contains the desc order), never contains `org_id`/`user_id` in calls, returns the row array; `data: null` → `[]`.
- get: `maybeSingle` called once, `eq(['id', id])`, returns row or `null`.
- create: `insert` payload `=== { name, description, spec, scope }` (or the subset supplied) and `JSON.stringify(h.calls.insert)` does NOT contain `org_id` or `user_id`; `single` called once; returns the row.
- update: `update` payload contains the patched fields AND `updated_at` (a non-null ISO string, the OQ-2 explicit bump), `eq(['id', id])`, no `org_id`/`user_id`.
- archive: `update` payload has `archived_at` (non-null) AND `updated_at` (non-null), `eq(['id', id])`.
- delete: `delete` called once, `eq(['id', id])`.
- error mapping (one case per function family, mirroring Companies): `error: { message:'denied', code:'42501' }` → rejects `toMatchObject({ message:'denied', code:'42501' })` and `toBeInstanceOf(AppError)`.
**Satisfies:** AC-UV-007 (FR-UV-009..011).
**Verify:** `cd /home/user/PMO/pmo-portal && npx vitest run src/lib/db/userViews.test.ts` → FAILS (module `./userViews` not found / functions undefined). RED confirmed.

### Task D2 — GREEN: implement `src/lib/db/userViews.ts`
**File:** `pmo-portal/src/lib/db/userViews.ts` (new).
**Action:** mirror `companies.ts` exactly. Imports: `supabase` from `@/src/lib/supabase/client`, `AppError` from `@/src/lib/appError`, `Tables` from `@/src/lib/supabase/database.types`. Define:
```ts
export type UserViewRow = Tables<'user_views'>;
export type UserViewScope = UserViewRow['scope'];

/** Create/edit form fields. org_id and user_id are NEVER among them — RLS stamps them. spec is opaque (FR-UV-004). */
export interface UserViewInput {
  name: string;
  description?: string | null;
  spec: UserViewRow['spec'];
  scope?: string;
}

interface PostgrestErrorLike { message: string; code?: string }
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}
```
Functions (signatures, all `org_id`/`user_id`-free):
- `listUserViews(): Promise<UserViewRow[]>` — `from('user_views').select('*').is('archived_at', null).order('updated_at', { ascending: false })`; `if (error) throwWrite(error); return data ?? [];`
- `getUserView(id: string): Promise<UserViewRow | null>` — `.select('*').eq('id', id).maybeSingle()`; `return data ?? null;`
- `createUserView(input: UserViewInput): Promise<UserViewRow>` — `.insert({ name: input.name, description: input.description ?? null, spec: input.spec, scope: input.scope })` (do NOT spread; build the object explicitly so `org_id`/`user_id` can never leak) `.select().single()`; `return data as UserViewRow;`
- `updateUserView(id: string, input: UserViewInput): Promise<void>` — `.update({ name: input.name, description: input.description ?? null, spec: input.spec, scope: input.scope, updated_at: new Date().toISOString() }).eq('id', id)` (OQ-2 explicit `updated_at`).
- `archiveUserView(id: string): Promise<void>` — `.update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)`.
- `deleteUserView(id: string): Promise<void>` — `.delete().eq('id', id)`.
Each `if (error) throwWrite(error);`. Add doc-comments naming the FR/AC like `companies.ts`.
**Satisfies:** AC-UV-007 (FR-UV-009, FR-UV-010, FR-UV-011, FR-UV-003, FR-UV-004 spec round-trip).
**Verify:** `cd /home/user/PMO/pmo-portal && npx vitest run src/lib/db/userViews.test.ts` → PASSES. GREEN confirmed.

---

## Phase E — Repository seam + hook — TDD

### Task E1 — Add `UserViewRepository` to the seam interface
**File:** `pmo-portal/src/lib/repositories/types.ts` (edit).
**Action:** (1) add an import `import type { UserViewRow, UserViewInput } from '@/src/lib/db/userViews';` next to the other `@/src/lib/db/*` type imports. (2) add the interface (place near `ContactRepository`):
```ts
export interface UserViewRepository {
  /** The caller's non-archived visible views (owner + shared_org in-org), newest write first. */
  list(): Promise<UserViewRow[]>;
  /** A single view by id, or null when not found / not readable (RLS-scoped out). */
  get(id: string): Promise<UserViewRow | null>;
  /** Create a view (org_id + user_id stamped by RLS, never sent; spec is opaque). */
  create(input: UserViewInput): Promise<UserViewRow>;
  /** Update a view's editable fields (owner or Admin at the RLS layer). */
  update(id: string, input: UserViewInput): Promise<void>;
  /** Soft-archive a view (stamps archived_at; ADR-0018). */
  archive(id: string): Promise<void>;
  /** Hard-delete a view (owner or Admin at the RLS layer). */
  delete(id: string): Promise<void>;
}
```
(3) add `userView: UserViewRepository;` to the `Repositories` interface.
**Satisfies:** FR-UV-012 (interface half).
**Verify:** `cd /home/user/PMO/pmo-portal && npm run typecheck` (no errors yet for unused; `index.ts` wiring in E2 completes it — run typecheck after E2). Standalone local check: `grep -n "UserViewRepository" /home/user/PMO/pmo-portal/src/lib/repositories/types.ts`.

### Task E2 — Assemble `userView` in the repository implementation
**File:** `pmo-portal/src/lib/repositories/index.ts` (edit).
**Action:** (1) add the DAL import:
```ts
import {
  listUserViews,
  getUserView,
  createUserView,
  updateUserView,
  archiveUserView,
  deleteUserView,
} from '@/src/lib/db/userViews';
```
(2) add `UserViewRepository` to the `import type { … } from './types'` list AND to the re-`export type { … } from './types'` list. (3) assemble (near `contact`):
```ts
const userView: UserViewRepository = {
  list: () => wrap(() => listUserViews()),
  get: (id) => wrap(() => getUserView(id)),
  create: (input) => wrap(() => createUserView(input)),
  update: (id, input) => wrap(() => updateUserView(id, input)),
  archive: (id) => wrap(() => archiveUserView(id)),
  delete: (id) => wrap(() => deleteUserView(id)),
};
```
(4) add `userView,` to the `export const repositories: Repositories = { … }` object.
**Satisfies:** FR-UV-012 (implementation; `wrap`/`toAppError` normalizes thrown values to `AppError` preserving the PG code).
**Verify:** `cd /home/user/PMO/pmo-portal && npm run typecheck` → zero errors (the `Repositories` object now matches the interface).

### Task E3 — RED: write the hook unit test
**File:** `pmo-portal/src/hooks/useUserViews.test.tsx` (new).
**Action:** copy the `useCompanies.test.tsx` harness verbatim, but mock `userView` (not `company`): `vi.mock('@/src/lib/repositories', () => ({ repositories: { userView } }))` and `vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }) }))`. Import `useUserViews, useUserView, useUserViewMutations` from `./useUserViews`. Cases (titles lead with `AC-UV-008:`):
- list: keys `['user_views', orgId]` and returns rows via `userView.list` (assert success + data; `userView.list` called).
- list disabled: re-mock `useAuth` to return `currentUser: undefined` (a second `describe` with its own `vi.mock` is awkward — instead assert via a `useUserView(undefined)`/no-orgId path using `fetchStatus === 'idle'` and `userView.list`/`get` not called). Simplest: a `useUserView(undefined)` case → `fetchStatus === 'idle'`, `userView.get` not called (mirrors the Companies `useCompany(undefined)` test) covering the "disabled until id present" half; for the "disabled until orgId present" half, add a dedicated test file-level mock variant OR assert the queryKey/enabled wiring through `useUserView('v1')` keying `['user_view', 'org-1', 'v1']`. (Mirror exactly how `useCompanies.test.tsx` proves enabled/keys — it relies on the static `org_id: 'org-1'` mock; the "no orgId" branch is covered by the `id: undefined` idle assertion, consistent with the Companies precedent.)
- record: `useUserView('v1')` keys `['user_view', 'org-1', 'v1']`, returns the row via `userView.get`, called with `'v1'`.
- mutations: `create`/`update`/`archive`/`remove` invoke the repository with the right args AND on success `invalidateQueries` is called with `{ queryKey: ['user_views'] }` and `{ queryKey: ['user_view'] }` (spy on `client.invalidateQueries`).
**Satisfies:** AC-UV-008 (FR-UV-013, FR-UV-014, FR-UV-015).
**Verify:** `cd /home/user/PMO/pmo-portal && npx vitest run src/hooks/useUserViews.test.tsx` → FAILS (module `./useUserViews` not found). RED confirmed.

### Task E4 — GREEN: implement `src/hooks/useUserViews.ts`
**File:** `pmo-portal/src/hooks/useUserViews.ts` (new).
**Action:** mirror `useCompanies.ts`. Imports: `useMutation, useQuery, useQueryClient` from `@tanstack/react-query`; `repositories` from `@/src/lib/repositories`; `UserViewRow, UserViewInput` from `@/src/lib/db/userViews`; `useAuth` from `@/src/auth/useAuth`.
```ts
export function useUserViews() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<UserViewRow[]>({
    queryKey: ['user_views', orgId],
    queryFn: () => repositories.userView.list(),
    enabled: Boolean(orgId),
  });
}

export function useUserView(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<UserViewRow | null>({
    queryKey: ['user_view', orgId, id],
    queryFn: () => repositories.userView.get(id!),
    enabled: Boolean(orgId && id),
  });
}

export interface UpdateUserViewArgs { id: string; input: UserViewInput }

export function useUserViewMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['user_views'] });
    qc.invalidateQueries({ queryKey: ['user_view'] });
  };
  const create = useMutation({ mutationFn: (input: UserViewInput) => repositories.userView.create(input), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, input }: UpdateUserViewArgs) => repositories.userView.update(id, input), onSuccess: invalidate });
  const archive = useMutation({ mutationFn: (id: string) => repositories.userView.archive(id), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => repositories.userView.delete(id), onSuccess: invalidate });
  return { create, update, archive, remove };
}
```
**Satisfies:** AC-UV-008 (FR-UV-013, FR-UV-014, FR-UV-015), NFR-UV-CACHE-001 (TanStack defaults).
**Verify:** `cd /home/user/PMO/pmo-portal && npx vitest run src/hooks/useUserViews.test.tsx` → PASSES. GREEN confirmed.

---

## Phase F — Full verify (pre-push gate)

### Task F1 — Run the whole verify suite
**File:** none (gate).
**Action:** run the full pre-push verify (CLAUDE.md binding gate; never just touched files).
**Verify:** `cd /home/user/PMO/pmo-portal && npm run verify` (= `typecheck && lint:ci && test && build`) → all green, ESLint `--max-warnings=0`. This is the local gate; pgTAP (Tasks B1/B2) runs in the CI `integration` job on the `dev`→`main` PR.

---

## Traceability (AC → task → owning test file / layer)

| AC | Requirement(s) | Owning layer | Owning test file | Implemented by | Proven by task |
|---|---|---|---|---|---|
| AC-UV-001 | FR-UV-005 | pgTAP | `supabase/tests/0088_user_views_crud.test.sql` | A1, A4 | B1 |
| AC-UV-002 | FR-UV-005, NFR-UV-SEC-001 | pgTAP | `supabase/tests/0089_user_views_tenancy.test.sql` | A1, A4 | B2 |
| AC-UV-003 | FR-UV-005 | pgTAP | `supabase/tests/0089_user_views_tenancy.test.sql` | A1, A4 | B2 |
| AC-UV-004 | FR-UV-007 | pgTAP | `supabase/tests/0088_user_views_crud.test.sql` | A1, A5 | B1 |
| AC-UV-005 | FR-UV-003, FR-UV-006 | pgTAP | `supabase/tests/0088_user_views_crud.test.sql` | A1, A5 | B1 |
| AC-UV-006 | FR-UV-009 (ADR-0018) | pgTAP | `supabase/tests/0088_user_views_crud.test.sql` | A1, A2, D2 | B1 |
| AC-UV-007 | FR-UV-009..012 | Vitest | `pmo-portal/src/lib/db/userViews.test.ts` | D2, E1, E2 | D1 (RED) → D2 (GREEN) |
| AC-UV-008 | FR-UV-013..015 | Vitest | `pmo-portal/src/hooks/useUserViews.test.tsx` | E4 | E3 (RED) → E4 (GREEN) |

> Structural/enabling requirements proven transitively (per spec §6 note): FR-UV-001/002 (schema + scope CHECK) and FR-UV-008 (RLS enabled) are preconditions exercised by every pgTAP row; FR-UV-004 (spec opacity) is exercised by AC-UV-007's verbatim `spec` round-trip; NFR-UV-PERF-001 (indexes) by Task A2 existence; NFR-UV-REV-001 by the A1 rollback header; NFR-UV-CACHE-001 by the hook's TanStack defaults (E4).

---

## Notes for the build agent
- **TDD order:** D1(RED)→D2(GREEN), then E1/E2 (seam, typecheck-driven), then E3(RED)→E4(GREEN). pgTAP (B1/B2) authored after the migration (A1–A5) — they are the proof, written before the migration is considered done (red without the table, green after).
- **org_id/user_id never sent** — build the insert/update payload objects explicitly (no `...input` spread) so neither can ever leak from the client.
- **`updated_at`** is bumped explicitly in `updateUserView`/`archiveUserView` (OQ-2 — no DB trigger exists).
- **pgTAP `42501` vs no-op:** per the Companies precedent, an RLS USING denial on UPDATE/DELETE is a silent 0-row no-op (not `42501`); a WITH CHECK denial on INSERT is `42501`. Author AC-UV-004 as "the write does not take effect" (no-op + state-unchanged assertions) and AC-UV-005's spoof as `throws_ok(..., '42501')`.
- **Do not** add any UI, route, nav, or e2e — out of scope (spec §0).
