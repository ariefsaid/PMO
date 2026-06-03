# Spec: Procurement list page on real Supabase data (Issue #5)

Mirror of the shipped Projects template (Issue #4 / `data-layer-projects.spec.md`). READ path only.

- **Grounds:** target-arch §3/§4/§8/§9; ADR-0003 (DAL), ADR-0005 (TanStack Query). Reuses the
  exact pattern of `src/lib/db/projects.ts`, `src/hooks/useProjects.ts`, `pages/Projects.tsx`,
  `src/lib/format.ts`.
- **Schema (verified `supabase/migrations/0001_init_schema.sql` §5.6):** `procurements(id, org_id,
  code, title, project_id, requested_by_id, status procurement_status, total_value numeric, vendor_id,
  created_at, updated_at)`. Joins available: `project_id → projects`, `vendor_id → companies`,
  `requested_by_id → profiles`.
- **Enum parity (verified):** the `ProcurementStatus` TS enum (`types.ts`) values are byte-identical
  to the DB `procurement_status` enum (`'Vendor Quoted'`, `'Quote Selected'`, …). Therefore the DB
  `status` string is a valid `ProcurementStatus` and `ProcurementStatusBadge` / `ProcurementPipeline`
  consume it directly — the Issue #4 anti-pattern (`as unknown as <prototype type>`) is NOT needed.

## Scope

**IN (READ only):** `listProcurements()` db module with SQL joins; `useProcurements()` org-scoped
hook; swap `pages/Procurement.tsx` from mockData → real data (tabs, search, "My Requests" by real
signed-in profile id); remove `mockUserForRole`; loading/empty/error states; `formatCurrency` reuse.

**OUT (flag, don't build):**
- Lifecycle TRANSITIONS / writes (Draft→…→Paid) — needs `[OWNER-DECISION]` role×status authz matrix. `[OWNER-DECISION OD-5]`
- `ProcurementDetails.tsx` drill-down — separate issue, stays on mockData.
- `New Request` modal stays inert (button opens the existing placeholder modal; no DB write).
- Timesheets / Dashboard / SalesPipeline unchanged.

## `[OWNER-DECISION]` flags (non-blocking)
- **OD-5** — "To Approve" / "Active Orders" tabs: these imply approval authority. Lifecycle authz is
  deferred (Scope OUT). For this READ issue the tabs remain pure status FILTERS over the cached list
  (no permission check): "To Approve" = `status = 'Requested'`; "Active Orders" = `status ∈ {Ordered,
  Received, Vendor Invoiced}`. Confirm this read-only filter semantics is acceptable interim.
- **OD-6** — vendor display when `vendor_id IS NULL` (seed row PROC-2026-004 has none): render
  `'Vendor Pending'` (preserves current prototype copy). Confirm.
- **OD-7** — search field: prototype searched `title` + `id` (`P001`-style). `id` is now a uuid, so
  search uses `title` + `code` (e.g. `PROC-2026-004`), mirroring the Projects decision. Confirm.

## Functional requirements (EARS)

- **FR-PROC-001** — When the Procurement page mounts for an authenticated user, the system shall fetch
  procurements for the caller's org via `useProcurements()` and render them (no mockData).
- **FR-PROC-002** — The system shall resolve `project.name`, `vendor.name`, and `requested_by.full_name`
  in the SQL select (no render-time `.find()` over mock arrays).
- **FR-PROC-003** — While the query is pending, the system shall render a loading skeleton
  (`data-testid="procurement-loading"`).
- **FR-PROC-004** — While the query has errored, the system shall render an error message with a Retry
  control that re-runs the query.
- **FR-PROC-005** — Where the filtered result set is empty, the system shall render the empty state.
- **FR-PROC-006** — The "My Requests" tab shall filter to `requested_by_id === currentUser.id` using
  the REAL signed-in profile id (no `mockUserForRole`).
- **FR-PROC-007** — Status tabs and free-text search shall filter the cached list client-side
  (`title`/`code` search; status-group tabs per OD-5/OD-7).
- **FR-PROC-008** — Monetary values shall be rendered via the shared `formatCurrency` (no inline
  `Intl.NumberFormat`).
- **FR-DAL-PROC-001** — `listProcurements()` shall select `*, project:projects(name,code),
  vendor:companies(name), requested_by:profiles(full_name)` and shall NOT send `org_id` (RLS scopes
  rows). On PostgREST error it shall throw `new Error(error.message)`.
- **FR-QRY-PROC-001** — `useProcurements()` shall key the query `['procurements', orgId]` and be
  `enabled` only when `orgId` is present.

## NFR
- **NFR-PROC-PERF-001** — One indexed query per page load (`procurements_org_id_idx`); joins resolved
  server-side; no N+1 / client-side cross-product lookups.

## Acceptance criteria (Given/When/Then)

- **AC-501** — Login renders real seeded procurements with joined refs.
  Given a signed-in PM, When they open `/procurement`, Then the seeded row "Workstations & AV" is
  visible with its project name "Innovate Corp HQ Fit-Out". *(FR-PROC-001/002)*
- **AC-502** — "My Requests" uses the real profile id.
  Given the PM (requester of PROC-2026-004) on `/procurement`, When they select "My Requests", Then
  "Workstations & AV" is visible; And given the Engineer (requester of nothing), When they select "My
  Requests", Then the empty state ("No requests found") is shown. *(FR-PROC-006)*
- **AC-503** — Status-group tab filters real data.
  Given the PM on `/procurement` with seeded row status `Vendor Quoted`, When they select "Active
  Orders" (`Ordered|Received|Vendor Invoiced`), Then "Workstations & AV" is NOT shown (empty state);
  When they select "All", Then it is shown. *(FR-PROC-007, OD-5)*
- **AC-504** — Search filters real data.
  Given the PM on `/procurement`, When they type "Workstations" in search, Then "Workstations & AV"
  is visible; When they type "zzz", Then the empty state is shown. *(FR-PROC-007, OD-7)*
- **AC-505** — Loading skeleton.
  Given the procurements query is pending, When the page renders, Then `procurement-loading` is shown
  and no procurement cards. *(FR-PROC-003)*
- **AC-506** — Empty state.
  Given the query resolves to zero rows, When the page renders, Then "No requests found" is shown.
  *(FR-PROC-005)*
- **AC-507** — Error + retry.
  Given the query errors, When the page renders, Then an error message with a Retry button is shown;
  When Retry is clicked, Then the query re-runs. *(FR-PROC-004)*
- **AC-508** — Engineer reads org procurements (RLS read path).
  Given a signed-in Engineer (non-requester), When they open `/procurement` and select "All", Then the
  org's seeded procurement "Workstations & AV" is visible (RLS permits org-scoped read).
- **AC-509** — `listProcurements()` unit contract.
  Given the db module, When called, Then it queries `from('procurements')` with the joined select, sends
  no `org_id`, returns rows, and throws on PostgREST error. *(FR-DAL-PROC-001)*

## Traceability
Each AC → exactly one Playwright/Vitest spec. e2e: AC-501/502/503/504/508 (local stack). Component
(Vitest): AC-505/506/507 (+ AC-501..504 fast mirror). Unit (Vitest): AC-509.
