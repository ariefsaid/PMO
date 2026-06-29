# Spec: `user_views` persistence entity (Issue I1 — agent-native user-composed UI)

> **Status:** Draft.
>
> First build slice of **ADR-0036 §10.1** (the "renderer-first" build sequence). Conforms to house
> conventions (EARS + `FR-UV-`/`NFR-UV-`/`AC-UV-` ids; Given/When/Then; ADR-0010 test-pyramid
> traceability). Grounds: ADR-0036 §6 (data model + RLS), §7 (coexistence namespace), §10 (sequence);
> ADR-0001 (`org_id` seam), ADR-0016 (`auth_role()` real-JWT), ADR-0017 (repository seam),
> ADR-0018 (soft-archive), ADR-0019 (server-enforced authz), ADR-0005 (TanStack Query). RLS helpers
> reused from `supabase/migrations/0002_rls.sql` (`auth_org_id()`, `auth_role()`).
>
> **Scope (locked, Director):** the **persistence layer ONLY** for a user's saved view definitions —
> the `user_views` table + RLS policies (+ pgTAP proof), the `src/lib/db/userViews.ts` DAL module, a
> `userView` entry on the `repositories` seam, and the `useUserViews()` TanStack hook. The `spec jsonb`
> column is stored and returned **opaquely**; this issue does **not** parse, validate, or interpret it.
>
> **Out of scope (later ADR-0036 issues — do NOT build here):** the query-spec DSL + compiler + spec
> registry validation (I2); the `<UserViewRenderer>` + `/views/:viewId` route + dynamic "My Views" nav
> (I3); the manual builder UI (I4); the agent spec-author (I5); `scope='shared_roles'` **row-level**
> enforcement (I6 — see OD-3). No UI, no routes, no e2e this issue.

---

## 1. Context (AS-IS) and Scope

ADR-0036 decided that an agent-built (or manually-built) view is **"a row, not a migration"** (§6): saving
a composed dashboard inserts a `user_views` row through the existing repository seam — no runtime DDL,
no code-gen, no deploy. The renderer-first build sequence (§10) puts the persistence entity **first** so
every later layer (compiler, renderer, builder, agent) has a place to read and write specs.

PMO already ships the full CRUD/RBAC foundation this slice mirrors: a typed DAL (`src/lib/db/*`), a
repository seam normalizing thrown values to a code-bearing `AppError` (`src/lib/repositories/index.ts`,
ADR-0017), org-scoped RLS using `auth_org_id()` / `auth_role()` (`0002_rls.sql`, ADR-0016), soft-archive
via `archived_at` (ADR-0018), and org-keyed TanStack hooks (`useCompanies`, ADR-0005). The **Companies
reference slice** (`pages/Companies.tsx` + `src/lib/db/companies.ts` + `useCompanies()`) is the template;
this issue follows it, with **one deliberate difference**: `user_views` is **owner-private by default**,
not org-wide-readable. Every existing business table is "read-in-org for all members"; `user_views` must
honor the owner's core requirement — **"theirs alone until explicitly shared"** (§6).

`organizations` and `profiles` exist with RLS (`0002_rls.sql`); `profiles.id = auth.uid()` and
`auth_org_id()` reads the caller's org from `profiles`. No `user_views` table, DAL module, repository
entry, or hook exists yet.

## 2. Goals

- **G-1** A `user_views` table with RLS that is **owner-private by default**: a row is visible to its
  owner always, and to same-org members only when `scope = 'shared_org'`. Cross-org reads return nothing.
- **G-2** Writes (INSERT/UPDATE/DELETE) restricted to the row's owner or an org Admin, org-scoped, with
  the `org_id` seam stamped server-side (default + `WITH CHECK`) and never sent by the client (ADR-0001).
- **G-3** Soft-archive (`archived_at`, ADR-0018) hides rows from the default list; no hard-delete by default.
- **G-4** A typed `src/lib/db/userViews.ts` DAL + a `userView` repository (list/get/create/update/archive/
  delete) over the seam (ADR-0017), errors normalized to `AppError` with the Postgres `code` preserved.
- **G-5** A `useUserViews()` TanStack hook, org-keyed and org-gated, with mutations invalidating the
  `['user_views']` / `['user_view']` query families (ADR-0005).
- **G-6** The `spec jsonb` column is stored and round-tripped **opaquely** — never parsed or validated here.

## 3. Functional requirements (EARS)

### Schema + tenancy

- **FR-UV-001** (ubiquitous) The system shall provide a `user_views` table with columns: `id uuid pk
  default gen_random_uuid()`; `org_id uuid not null references organizations(id) default
  '00000000-0000-0000-0000-000000000001'`; `user_id uuid not null references profiles(id)`; `name text
  not null`; `description text`; `spec jsonb not null default '{}'::jsonb`; `scope text not null default
  'private'`; `created_at timestamptz not null default now()`; `updated_at timestamptz not null default
  now()`; `archived_at timestamptz`.
- **FR-UV-002** (ubiquitous) The `scope` column shall be constrained (CHECK) to one of `'private'`,
  `'shared_org'`, `'shared_roles'`; any other value shall be rejected at write time.
- **FR-UV-003** (ubiquitous) The DAL/repository shall never send `org_id` or `user_id` on insert; `org_id`
  is supplied by the column default and pinned by RLS `WITH CHECK (org_id = auth_org_id())`, and `user_id`
  is set to the caller (`auth.uid()`) — so a client cannot widen or spoof tenant or owner.
- **FR-UV-004** (ubiquitous) The `spec` column shall be treated as opaque JSON by this layer: the DAL
  reads and writes it verbatim and performs **no** schema validation or interpretation of its contents
  (registry validation is deferred to I2 — ADR-0036 §5).

### RLS (authorization)

- **FR-UV-005** (state-driven) While a caller queries `user_views`, the system shall return a row only when
  `user_id = auth.uid()` **OR** (`scope = 'shared_org'` AND `org_id = auth_org_id()`); a row with
  `scope = 'private'` owned by another user shall be invisible even to same-org members.
- **FR-UV-006** (event-driven) When a caller inserts a `user_views` row, the system shall accept it only if
  `org_id = auth_org_id()` AND `user_id = auth.uid()` (RLS `WITH CHECK`); a row whose `org_id` or `user_id`
  is set to another org/user shall be rejected (`42501`).
- **FR-UV-007** (event-driven) When a caller updates or deletes a `user_views` row, the system shall permit
  it only if the row is in the caller's org (`org_id = auth_org_id()`) AND the caller is the owner
  (`user_id = auth.uid()`) **OR** an Admin (`auth_role() = 'Admin'`); otherwise it shall be denied (`42501`).
- **FR-UV-008** (ubiquitous) RLS shall be enabled on `user_views`, and authorization shall be enforced by
  these policies server-side, independent of any FE `can()` check (ADR-0016: `can()` is UX-only).

### DAL + repository (ADR-0017)

- **FR-UV-009** (ubiquitous) `src/lib/db/userViews.ts` shall expose `listUserViews()` returning the
  caller's non-archived (`archived_at is null`) visible rows, ordered by `updated_at desc`; it shall import
  the Supabase client only from `@/src/lib/supabase/client` and shall send no `org_id`/`user_id`.
- **FR-UV-010** (ubiquitous) The DAL shall expose `getUserView(id)` (single row or `null` when absent /
  RLS-scoped-out), `createUserView(input)`, `updateUserView(id, input)`, `archiveUserView(id)` (sets
  `archived_at = now()`), and `deleteUserView(id)` (hard delete, owner/Admin only). The create/update input
  shall accept `{ name, description?, spec, scope? }` and shall not accept `org_id`/`user_id`.
- **FR-UV-011** (event-driven) When the underlying Supabase call returns a PostgREST/Postgres error, the
  DAL function shall throw (errors are not swallowed) so the calling query/mutation surfaces an error.
- **FR-UV-012** (ubiquitous) The `repositories` object shall expose a `userView` entry
  (`list`/`get`/`create`/`update`/`archive`/`delete`) delegating to the DAL, normalizing any thrown value
  to a shared `AppError` whose `code` preserves the Postgres/PostgREST `code` (ADR-0017 seam contract).

### Hook (ADR-0005)

- **FR-UV-013** (ubiquitous) `useUserViews()` (`src/hooks/useUserViews.ts`) shall key its list query
  `['user_views', orgId]` where `orgId` is the signed-in user's `profile.org_id`, and shall be
  `enabled` only while an `orgId` is present (disabled until org resolves), so cache identity is
  tenant-scoped (no cross-tenant cache bleed).
- **FR-UV-014** (ubiquitous) A `useUserView(id)` query shall key `['user_view', orgId, id]` and be enabled
  only while both `orgId` and `id` are present.
- **FR-UV-015** (event-driven) When a `userView` create/update/archive/delete mutation succeeds, the hook
  shall invalidate the `['user_views']` and `['user_view']` query families so open lists and record reads
  refetch.

## 4. Non-functional requirements

- **NFR-UV-SEC-001** (tenancy) Org isolation and owner-privacy shall be enforced **server-side by RLS**,
  independent of any client check (ADR-0001/0016). The FE may be stricter than RLS but never the authority.
- **NFR-UV-PERF-001** (indexes) The table shall carry indexes supporting the hot access paths: a composite
  index on `(org_id, user_id)` (owner lists) and on `(org_id, scope)` (shared-org lists), so list reads
  are not full scans as row counts grow. (Final index set confirmed in the plan; these are the baseline.)
- **NFR-UV-REV-001** (reversibility) The migration shall be reversible (table + policies + indexes
  droppable), follow the additive migration discipline (`supabase/migrations/NNNN_*.sql`), and ship with a
  pgTAP proof; `seed.sql` changes (if any) are local-only, never prod (CLAUDE.md / `docs/environments.md`).
- **NFR-UV-TEST-001** The DAL and hook shall be unit-tested against a **mocked** Supabase client; no Vitest
  test shall require a live database. RLS/tenancy/scope/soft-archive contracts are proven by **pgTAP**
  (`supabase test db`) per ADR-0010.
- **NFR-UV-CACHE-001** View reads shall be cached client-side with background revalidation + request dedup
  via TanStack Query, consistent with the app's `QueryClient` defaults (ADR-0005).

## 5. Acceptance criteria (Given/When/Then)

> AC-UV-001..006 are **pgTAP** (RLS/tenancy/scope/soft-archive contracts, run on the local stack via
> `supabase test db`). AC-UV-007..008 are **Vitest** (DAL/repository/hook logic, mocked Supabase client).
> No e2e this issue (no UI). Each AC is owned by exactly one test at its lowest sufficient layer (ADR-0010).

- **AC-UV-001** — Owner reads only their own private views.
  **Given** users Ann and Bob are in the same org, Ann owns a `private` view "Ann-Only", and Bob owns a
  `private` view "Bob-Only",
  **When** Ann selects from `user_views`,
  **Then** she sees "Ann-Only" and does **not** see Bob's `private` "Bob-Only". (FR-UV-005)

- **AC-UV-002** — Cross-org SELECT returns zero (tenant isolation).
  **Given** Carol in org B and a view (any scope, including `shared_org`) owned by Ann in org A,
  **When** Carol selects from `user_views`,
  **Then** zero of Ann's rows are returned — `org_id` is the wall regardless of scope. (FR-UV-005, NFR-UV-SEC-001)

- **AC-UV-003** — A `shared_org` view is visible to same-org members but not to other orgs.
  **Given** Ann (org A) owns a view "Team Board" with `scope = 'shared_org'`,
  **When** Bob (same org A) selects from `user_views`, **then** he sees "Team Board";
  **and when** Carol (org B) selects, **then** she does **not** see it. (FR-UV-005)

- **AC-UV-004** — A non-owner non-Admin cannot UPDATE or DELETE another user's view.
  **Given** Ann owns a view and Bob is a same-org non-Admin (e.g. Engineer),
  **When** Bob attempts to UPDATE that view's `name`, **then** the write is denied (`42501`);
  **and when** Bob attempts to DELETE it, **then** the delete is denied (`42501`). (FR-UV-007)

- **AC-UV-005** — INSERT stamps the caller's org via default + `WITH CHECK`; a spoofed cross-org INSERT is rejected.
  **Given** Ann in org A,
  **When** Ann inserts a `user_views` row supplying only `name`/`spec` (no `org_id`), **then** the row is
  created with `org_id` = org A (Ann's org, from the column default) and `user_id` = Ann (`auth.uid()`);
  **and when** Ann attempts to insert a row with `org_id` set to org B (a spoof), **then** the insert is
  rejected (`42501`). (FR-UV-003, FR-UV-006)

- **AC-UV-006** — Soft-archive hides the row from the default list.
  **Given** Ann owns a view and then archives it (`archived_at` set to a non-null timestamp),
  **When** Ann lists via the default DAL path (`archived_at is null`),
  **Then** the archived view is **not** returned (the row still exists in the table, not hard-deleted). (FR-UV-009, ADR-0018)

- **AC-UV-007** — The `userView` repository returns correct shapes and maps Postgres errors to `AppError`.
  **Given** a mocked Supabase client backing `userViews.ts`,
  **When** `repositories.userView.list()`/`get(id)`/`create(input)`/`update(id, input)`/`archive(id)`/
  `delete(id)` are called against the mock, **then** each returns the expected row shape(s) (list →
  array; get → row or `null`) and sends no `org_id`/`user_id`; **and** when the mock returns
  `{ error: { code } }`, the call rejects with an `AppError` whose `code` equals the Postgres/PostgREST
  `code`. (FR-UV-009..012)

- **AC-UV-008** — `useUserViews()` is org-keyed, org-gated, and invalidates on mutation.
  **Given** the `useUserViews()` / `useUserView(id)` hooks under a test `QueryClient`,
  **When** rendered with no `orgId` present, **then** the list/record queries are `disabled` (do not fetch);
  **and when** an `orgId` is present, **then** the list query keys `['user_views', orgId]` and the record
  query keys `['user_view', orgId, id]`; **and when** a create/update/archive/delete mutation succeeds,
  **then** the `['user_views']` and `['user_view']` query families are invalidated. (FR-UV-013..015)

## 6. Traceability

| AC | Requirement(s) | Owning layer | Planned test file |
|---|---|---|---|
| AC-UV-001 | FR-UV-005 | pgTAP | `supabase/tests/user_views_rls.test.sql` |
| AC-UV-002 | FR-UV-005, NFR-UV-SEC-001 | pgTAP | `supabase/tests/user_views_rls.test.sql` |
| AC-UV-003 | FR-UV-005 | pgTAP | `supabase/tests/user_views_rls.test.sql` |
| AC-UV-004 | FR-UV-007 | pgTAP | `supabase/tests/user_views_rls.test.sql` |
| AC-UV-005 | FR-UV-003, FR-UV-006 | pgTAP | `supabase/tests/user_views_rls.test.sql` |
| AC-UV-006 | FR-UV-009 (ADR-0018) | pgTAP | `supabase/tests/user_views_rls.test.sql` |
| AC-UV-007 | FR-UV-009..012 | Vitest | `pmo-portal/src/lib/db/userViews.test.ts` |
| AC-UV-008 | FR-UV-013..015 | Vitest | `pmo-portal/src/hooks/useUserViews.test.tsx` |

> FR-UV-001/002/004/008, NFR-UV-PERF-001/REV-001/CACHE-001 are structural/enabling requirements proven
> transitively (schema/CHECK/index existence and RLS-enabled are preconditions exercised by the pgTAP
> rows above; `spec`-opacity by FR-UV-004 is exercised by AC-UV-007's verbatim round-trip).

## 7. Open questions / owner-decision flags

- **[OWNER-DECISION] OD-1 — `shared_roles` enforcement is deferred (known limitation).** This issue
  **stores** `scope = 'shared_roles'` (permitted by the FR-UV-002 CHECK) but its **row-level** visibility
  is **not** enforced here: a `shared_roles` row is treated by RLS exactly like `private` (owner-only
  visible) until I6 adds role-scoped sharing. This is the ADR-0036 §6 deferral. Owner to confirm that
  storing-but-not-yet-enforcing `shared_roles` is acceptable for I1 (the alternative — reject the value
  until I6 — would force a later CHECK migration). **Defaulting to: store now, enforce in I6.**
- **[OWNER-DECISION] OD-2 — Admin reach on writes.** FR-UV-007 lets an org **Admin** UPDATE/DELETE any
  same-org member's view (mirrors the `profiles_admin_write` pattern in `0002_rls.sql`). This is a genuine
  product choice: an Admin can clean up/repair other users' saved views within their org. **Defaulting to:
  Admin may write any same-org view.** (Note: Admin **read** of another user's `private` view is **not**
  granted by FR-UV-005 — Admins can manage/delete but the SELECT policy does not expose private contents.
  Owner to confirm this read/write asymmetry is intended, or whether Admin should also read private rows.)
- **[OWNER-DECISION] OD-3 — Hard delete vs archive-only.** The DAL exposes both `archiveUserView` (default,
  ADR-0018 soft-archive) and `deleteUserView` (hard delete, owner/Admin). ADR-0018 prefers soft-archive;
  hard delete is offered for a user truly discarding their own view. **Defaulting to: both exposed, FE
  prefers archive.** Owner may restrict hard-delete to Admin-only if desired (a one-line policy change).
- **OQ-1 — `name` uniqueness.** No uniqueness constraint on `(user_id, name)` is specified; a user may have
  two views with the same name. Assumed acceptable (views are id-addressed); flag if the owner wants
  per-owner name uniqueness.
- **OQ-2 — `updated_at` maintenance.** Whether `updated_at` is bumped by an explicit `set updated_at =
  now()` in `updateUserView` or by a DB trigger is an implementation detail for the plan; the spec only
  requires it reflects the last write. (Match whatever the existing entities do for consistency.)
