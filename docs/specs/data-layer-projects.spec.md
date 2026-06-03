# Spec: Data-access layer + Projects list on real Supabase data (Issue #4)

> **Status:** Approved-to-plan. Phase 4 (data-access layer) + first slice of Phase 5 (Projects swap)
> of `docs/specs/target-architecture.spec.md` §13. Conforms to house conventions (EARS + `FR-`/`OBS-`/
> `NFR-`/`AC-` ids; Given/When/Then). Grounds: target-arch §3, §4, §8, §9; ADR-0003, ADR-0005.
>
> **Scope (locked, Director):** READ path only. Build `src/lib/db/*` (projects + minimal companies,
> profiles) + TanStack Query hooks + provider, and swap **`pages/Projects.tsx`** from `mockData` to
> real data. Resolve baseline `F-6` (centralize `formatCurrency`) and `F-7` (kill render-time `.find()`
> joins) **for this page's reads only**.
>
> **Out of scope (later issues, unchanged):** `ProjectDetails.tsx` + sub-aggregates, Procurement,
> Timesheets, Dashboard, SalesPipeline (all stay on `mockData` + the `mockUserForRole` bridge). Project
> create/edit/status-change **writes**. The `New Project` button stays inert (dead per baseline `F-10`).

---

## 1. Context (AS-IS)

`pages/Projects.tsx` renders `mockData` arrays (`projects`, `companies`, `users`), resolves client/PM
names with render-time `.find()` (`F-7`), defines a local `formatCurrency` (one of ~7 dups, `F-6`), and
derives "My Projects" from `mockUserForRole(effectiveRole)` — a temporary bridge mapping the real role to
a representative mock user (`src/auth/mockUserForRole.ts`). Identity/role are already real (Issue #3:
`useAuth()` → `{ currentUser: Profile, role }`). The schema, RLS, and a seed of 3 real projects (PM =
Alice `…a2`, client = Innovate Corp) exist (Issue #2; `supabase/seed.sql`). `database.types.ts` is
generated. TanStack Query is **not yet installed**; there is no `QueryClientProvider`, no `src/lib/db/`,
no `src/hooks/`, no `src/lib/format.ts`.

Status-string parity (load-bearing): the prototype `ProjectStatus` enum values (`types.ts`) are byte-equal
to the DB `project_status` enum strings (e.g. `'Ongoing Project'`, `'PQ Submitted'`). So a DB status string
**is** a valid `ProjectStatus`. `ProjectStatusBadge`/`ProjectKanbanBoard` consume the prototype `Project`
shape (numeric ids) and are **out of scope to edit**; `Projects.tsx` adapts real rows to their props.

## 2. Goals

- **G-1** A typed, reusable data-access layer (`src/lib/db/projects.ts`,`companies.ts`,`profiles.ts`)
  per ADR-0003: components never import supabase-js; joins resolved in SQL (`F-7`); `org_id` never sent.
- **G-2** TanStack Query installed + `QueryClientProvider` at app root, with org/user-aware `queryKey`s
  (ADR-0005); reusable across all later modules.
- **G-3** `Projects.tsx` reads real data through hooks, with loading / empty / error states (Frontend
  DoD, target-arch §4.3); `mockUserForRole` removed from this page.
- **G-4** `formatCurrency` centralized to `src/lib/format.ts` (`F-6`); client/PM names resolved by a SQL
  join, not `.find()` (`F-7`).
- **G-5** RLS read path proven: any authenticated org member (incl. Engineer) reads the org's projects.

## 3. Functional requirements (EARS)

- **FR-DAL-001** (ubiquitous) The system shall expose a typed `listProjects()` function in
  `src/lib/db/projects.ts` that selects projects with their client name and project-manager name resolved
  via a single PostgREST embedded-resource join (not client-side `.find()`).
- **FR-DAL-002** (ubiquitous) Data-access functions shall import the Supabase client only from
  `@/src/lib/supabase/client`; no React component shall import supabase-js directly.
- **FR-DAL-003** (event-driven) When a data-access function receives a PostgREST error, it shall throw so
  the calling query surfaces an error state (errors are not swallowed).
- **FR-DAL-004** (ubiquitous) Data-access functions shall never send `org_id`; org-scoping is enforced by
  RLS (`org_id = auth_org_id()`), so callers cannot widen or spoof tenant scope.
- **FR-DAL-005** (ubiquitous) `src/lib/db/companies.ts` shall expose `listClientCompanies()` returning
  companies of type `Client` (for the client filter dropdown); `src/lib/db/profiles.ts` shall expose
  `listProjectManagers()` returning profiles eligible to appear in the PM filter dropdown.
- **FR-QRY-001** (ubiquitous) The application root shall provide a single `QueryClient` via
  `QueryClientProvider` with defaults `staleTime: 30_000`, `gcTime: 300_000`, `retry: 1` (ADR-0005, §9).
- **FR-QRY-002** (ubiquitous) `useProjects()` shall key its query `['projects', orgId]` where `orgId` is
  the signed-in user's `profile.org_id`, so cache identity is tenant-scoped (no cross-tenant bleed when
  multi-tenant lands).
- **FR-PROJ-001** (event-driven) When the Projects page mounts for an authenticated user, the system shall
  fetch and render the real seeded projects for that user's org via `useProjects()`.
- **FR-PROJ-002** (state-driven) While the projects query is pending, the Projects page shall render a
  loading skeleton/spinner and shall not render the list, kanban, or empty state.
- **FR-PROJ-003** (event-driven) When the projects query fails, the Projects page shall render an inline
  error surface with a Retry control and shall not crash the route.
- **FR-PROJ-004** (event-driven) When the projects query succeeds with zero rows, the Projects page shall
  render the empty state.
- **FR-PROJ-005** (event-driven) When the user selects the "My Projects" tab, the system shall show only
  projects whose `project_manager_id` equals the signed-in user's real `profile.id` (from `useAuth()`),
  not a mock-user id.
- **FR-PROJ-006** (event-driven) When the user types in search or changes the status tab / client filter /
  PM filter, the system shall filter the already-fetched real rows accordingly (client-side filtering of
  the cached list is acceptable for this issue).
- **FR-PROJ-007** (ubiquitous) The Projects page shall render each project's client name and PM name from
  the joined query result, not by `.find()` over separate collections (`F-7`/NFR-PERF-002).
- **FR-FMT-001** (ubiquitous) Currency display shall use `formatCurrency` exported from
  `src/lib/format.ts`; the Projects page shall not define its own currency formatter (`F-6`).

## 4. Non-functional requirements

- **NFR-PERF-002** (target-arch §11) Client/PM name resolution shall be O(1) per row via the SQL join, not
  O(n) `.find()` per render.
- **NFR-CACHE-001** Project reads shall be cached client-side with background revalidation + request dedup
  (TanStack Query; ADR-0005).
- **NFR-SEC-001** Org isolation + read authorization shall be enforced server-side by RLS, independent of
  any client check (target-arch §6).
- **NFR-DAL-TEST-001** The db modules and hooks shall be unit-tested against a mocked Supabase client; no
  test shall require a live database.

## 5. Acceptance criteria (Given/When/Then)

> AC-401..AC-407 are Playwright-testable against the **local Supabase stack** (`supabase start` + seed) —
> note this stack dependency; CI e2e remains deferred per CLAUDE.md. AC-408..AC-410 are unit-level
> (Vitest, mocked Supabase client) and need no stack.

- **AC-401** — Projects list renders real seeded data.
  **Given** the local stack is seeded and I am signed in as `pm@acme.test`,
  **When** I navigate to `/projects`,
  **Then** I see the three seeded projects ("Innovate Corp HQ Fit-Out", "Northwind ERP Rollout",
  "Regional Services Program") with their real client name "Innovate Corp" and PM name "Alice Manager".
  (FR-PROJ-001, FR-PROJ-007)

- **AC-402** — "My Projects" uses the real signed-in profile id.
  **Given** I am signed in as `pm@acme.test` (Alice, PM of all three seeded projects),
  **When** I select the "My Projects" tab,
  **Then** all three projects remain visible; **and given** I instead sign in as `engineer@acme.test`
  (Dave, PM of none), **when** I select "My Projects", **then** the empty state is shown. (FR-PROJ-005)

- **AC-403** — Status tab filters real data.
  **Given** I am on `/projects` signed in as `pm@acme.test`,
  **When** I select the "Leads" tab,
  **Then** I see only "Regional Services Program" (`PQ Submitted`) and not the `Ongoing Project` row.
  (FR-PROJ-006)

- **AC-404** — Search filters real data.
  **Given** I am on `/projects`,
  **When** I type "Northwind" in the search box,
  **Then** only "Northwind ERP Rollout" remains. (FR-PROJ-006)

- **AC-405** — Loading state while fetching.
  **Given** the projects request has not yet resolved,
  **When** the Projects page mounts,
  **Then** a loading skeleton/spinner is shown and neither the list nor the empty state is shown.
  (FR-PROJ-002)

- **AC-406** — Empty state when no projects.
  **Given** the query resolves with zero projects (e.g. a filter matches nothing, or an empty org),
  **When** the page renders,
  **Then** the empty state ("No projects found") with its clear-filters action is shown. (FR-PROJ-004)

- **AC-407** — Engineer (RLS read-all-in-org) still sees the org's projects.
  **Given** I am signed in as `engineer@acme.test`,
  **When** I navigate to `/projects` (default "All" tab),
  **Then** I see all three org projects, confirming the RLS read path grants org-wide read. (FR-PROJ-001,
  NFR-SEC-001)

- **AC-408** — Error state on fetch failure (unit/component).
  **Given** `useProjects()` is mocked to reject,
  **When** the Projects page renders,
  **Then** an inline error surface with a Retry control is shown and the route does not throw.
  (FR-PROJ-003)

- **AC-409** — `listProjects()` resolves joins in SQL and throws on error (unit).
  **Given** a mocked Supabase client whose `.from('projects').select(...)` returns embedded
  `client:companies(name)` and `pm:profiles(full_name)`,
  **When** `listProjects()` is called,
  **Then** it returns rows carrying `client` and `pm` objects and sends no `org_id`; **and** when the
  mock returns `{ error }`, `listProjects()` throws. (FR-DAL-001, FR-DAL-003, FR-DAL-004)

- **AC-410** — `formatCurrency` formats from one module (unit).
  **Given** `formatCurrency` from `src/lib/format.ts`,
  **When** called with `5000000`,
  **Then** it returns `"$5,000,000"` (USD, no fraction digits) — matching the prototype's prior output.
  (FR-FMT-001)

## 6. `[OWNER-DECISION]` flags (non-blocking)

- **[OWNER-DECISION] OD-1 — Currency.** `formatCurrency` keeps the prototype's hard-coded USD /
  no-fraction-digits behavior to preserve `F-6` parity for this issue. Multi-currency / tenant-configurable
  currency is deferred (NFR-I18N-001, target-arch §14.2). No action needed now.
- **[OWNER-DECISION] OD-2 — PM filter population.** The PM dropdown is populated from
  `listProjectManagers()` returning profiles with `role = 'Project Manager'` (matches seed). If the owner
  wants "anyone who manages a project" instead, that is a one-query change later. Defaulting to role-based.
- **[OWNER-DECISION] OD-3 — Server-side vs client-side filtering.** This issue filters the cached list
  client-side (FR-PROJ-006) since the org's project count is small. Server-side `status`/`pmId` params
  exist in `listProjects(params?)` for later scale but are unused by the page now. Acceptable for MVP.
- **[OWNER-DECISION] OD-4 — Local-stack e2e.** AC-401..AC-407 require `supabase start` + seed locally; CI
  e2e is deferred (CLAUDE.md). Owner confirms running e2e locally for acceptance this issue.

## 7. Traceability

| Concern | Target-arch / baseline | This spec |
|---|---|---|
| Typed data-access layer | §8, ADR-0003, `F-6`/`F-7` | FR-DAL-001..005 |
| TanStack Query cache | §9, ADR-0005, `NFR-008` | FR-QRY-001/002, NFR-CACHE-001 |
| Loading/error/empty | §4.3 Frontend DoD | FR-PROJ-002/003/004, AC-405/408/406 |
| Real "My Projects" | `F-8`-adjacent; removes `mockUserForRole` | FR-PROJ-005, AC-402 |
| Kill `.find()` joins | `F-7`, NFR-PERF-002 | FR-PROJ-007, AC-401/409 |
| Centralize currency | `F-6`, NFR-I18N-001 | FR-FMT-001, AC-410 |
| RLS read path | §6, NFR-SEC-001 | AC-407 |
