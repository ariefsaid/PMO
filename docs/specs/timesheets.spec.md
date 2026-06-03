# Spec: Timesheets page on real Supabase data — READ path (Issue #6)

Mirror of the shipped Projects (Issue #4) / Procurement (Issue #5) template. READ path only.

- **Grounds:** target-arch §5.8/§8.4; ADR-0003 (DAL), ADR-0005 (TanStack Query). Reuses the exact
  pattern of `src/lib/db/procurements.ts`, `src/hooks/useProcurements.ts`, `src/lib/format.ts`.
- **Schema (verified `supabase/migrations/0001_init_schema.sql` §5.8):**
  `timesheets(id, org_id, user_id, week_start_date date, status timesheet_status, submitted_at,
  approved_by, approved_at)` with `unique(user_id, week_start_date)` and CHECK
  `week_is_monday` (`extract(dow from week_start_date) = 1`).
  `timesheet_entries(id, org_id, timesheet_id, project_id, entry_date date, hours numeric(5,2)
  check 0..24, notes)`. Join available: `project_id → projects(name, code)`.
- **CRITICAL field-name mismatch (verified):** the DB entry date column is **`entry_date`**, but the
  prototype `pages/Timesheets.tsx` and `types.ts TimesheetEntry` use `date`. The real page consumes
  snake_case rows directly (`entry_date`, `week_start_date`, `user_id`) — NO `as unknown as
  TimesheetEntry`/`Timesheet` prototype cast (Issue #5 lesson).
- **RLS (verified `0002_rls.sql` §timesheets):** `timesheets_select` = `org_id = auth_org_id() AND
  (user_id = auth.uid() OR role ∈ {Admin,Executive,Project Manager,Finance})`. So an Engineer reads
  ONLY their own timesheets; a PM/Exec/Finance/Admin can read all org timesheets. `timesheet_entries`
  select mirrors this via the parent timesheet. This shapes AC-606 below.

## Scope

**IN (READ only):** `listTimesheets()` db module that fetches the **signed-in user's** timesheets with
their entries (`entries:timesheet_entries(*, project:projects(name,code))`) ordered by week; sends no
`org_id` (RLS scopes rows); throws on error. `useTimesheets()` org+user-scoped hook. Swap
`pages/Timesheets.tsx` from mockData → real data for the signed-in user: week view / entries grid /
daily + weekly totals, `useMemo` for derived totals, loading/empty/error+retry states. Remove the
hard-coded `CURRENT_USER_ID = 1` and all `mockData`/`users`/`projects`/`mockTimesheets` usage on this
page; identity comes from `useAuth().currentUser.id`. `formatDate`/`getWeekStartDate` helpers stay
local (date math, not data).

**OUT (flag, don't build):**
- Timesheet **SUBMIT / APPROVE / REJECT writes** — `[OWNER-DECISION OD-T1]` approval rule deferred.
- **Editing entries** (hours/notes/add-row/delete-row writes) — deferred.
- The **Approvals tab** (manager view) — depends on the deferred approval rule; left inert.
- Dashboard / other modules unchanged.

## `[OWNER-DECISION]` flags (non-blocking)

- **OD-T1 (approval/submit authz)** — Submit/Approve/Reject is deferred. For this READ issue the
  Submit button and the entire Approvals tab become **inert/disabled** with a "coming soon" note; no
  DB write, no status mutation. Confirm the approval rule for a later issue: per-project PM vs
  line-manager; whole-timesheet vs per-entry approval. *(blocks the write issue, not this one)*
- **OD-T2 (entry editing)** — The hours/notes inputs become **read-only displays** this issue (no
  optimistic mock mutation). Confirm read-only is acceptable interim until the write issue.
- **OD-T3 (week navigation source)** — Prototype lets the user page prev/next weeks and synthesizes an
  empty Draft for weeks with no data. READ issue keeps prev/next navigation but renders only what RLS
  returns; a week with no timesheet shows the empty grid (no synthetic Draft row persisted). Confirm.
- **OD-T4 (entry-grouping key)** — Prototype groups grid rows by `project_id + notes`. Preserved
  as-is over real rows (notes still drive separate task lines). Confirm.

## Functional requirements (EARS)

- **FR-TS-001** — When the Timesheets page mounts for an authenticated user, the system shall fetch
  that user's timesheets + entries via `useTimesheets()` and render them (no mockData).
- **FR-TS-002** — The system shall resolve each entry's `project.name`/`project.code` in the SQL
  select (no render-time `.find()` over a mock `projects` array).
- **FR-TS-003** — While the query is pending, the system shall render a loading skeleton
  (`data-testid="timesheets-loading"`).
- **FR-TS-004** — While the query has errored, the system shall render an error message with a Retry
  control that re-runs the query.
- **FR-TS-005** — Where the signed-in user's current week has no entries, the system shall render the
  empty grid / empty state (`data-testid="timesheets-empty"`), not crash.
- **FR-TS-006** — The page shall scope all data to the REAL signed-in profile id
  (`useAuth().currentUser.id`); the hard-coded `CURRENT_USER_ID = 1` and `mockData` imports shall be
  removed.
- **FR-TS-007** — The system shall compute the weekly total and each daily/row total from the fetched
  entries inside `useMemo` keyed on the entries + selected week (no recompute on unrelated renders, no
  `.reduce` inline in JSX) (Issue #5 lesson).
- **FR-TS-008** — Hours values shall be rendered to two-decimal fixed (`hours.toFixed(2)` /
  weekly total `toFixed(1)`), preserving prototype output.
- **FR-DAL-TS-001** — `listTimesheets(userId)` shall select
  `*, entries:timesheet_entries(*, project:projects(name,code))` from `timesheets`, filter
  `eq('user_id', userId)`, order by `week_start_date` desc, and shall NOT send `org_id` (RLS scopes
  rows). On PostgREST error it shall throw `new Error(error.message)`.
- **FR-QRY-TS-001** — `useTimesheets()` shall read `currentUser` from `useAuth`, key the query
  `['timesheets', orgId, userId]`, and be `enabled` only when both `orgId` and `userId` are present.

## NFR

- **NFR-TS-PERF-001** — One indexed query per page load (`timesheets_user_week_idx`); entries +
  project names resolved server-side in a single nested select; no N+1 / client-side cross-product
  lookups.
- **NFR-TS-PERF-002** — Derived totals memoized (FR-TS-007); week-grid date array memoized.

## Acceptance criteria (Given/When/Then)

- **AC-601** — Signed-in user sees their own real timesheet entries with project names.
  Given the PM signed in (seeded a timesheet for the current week — see Seed below), When they open
  `/timesheets`, Then the seeded entry's project name "Innovate Corp HQ Fit-Out" is visible in the
  grid. *(FR-TS-001/002)*
- **AC-602** — Correct rendered weekly hours total.
  Given the PM on `/timesheets` for the seeded current week (entries 6 + 4 = 10 hours), When the page
  renders, Then a weekly total of `10.0` (and a "10.00" daily/total cell) is shown — assertion targets
  a RENDERED computed value, not mere presence. *(FR-TS-007/008)*
- **AC-603** — Different user sees only their own rows (RLS / own-rows).
  Given the Engineer signed in (seeded a different timesheet, 8 + 8 = 16 hours, current week), When
  they open `/timesheets`, Then their own total `16.0` is shown and the PM's "10.0" total is NOT
  present. *(FR-TS-006, RLS timesheets_select)*
- **AC-604** — Empty state when the signed-in user has no timesheet that week.
  Given Finance signed in (no seeded timesheet), When they open `/timesheets`, Then the empty state
  (`timesheets-empty`) is shown and the page does not crash. *(FR-TS-005)*
- **AC-605** — Loading skeleton.
  Given the timesheets query is pending, When the page renders, Then `timesheets-loading` is shown and
  no grid totals. *(FR-TS-003)*
- **AC-606** — Error + retry.
  Given the query errors, When the page renders, Then an error message with a Retry button is shown;
  When Retry is clicked, Then the query re-runs. *(FR-TS-004)*
- **AC-607** — Derived totals memoized and correct.
  Given the page with the seeded entries, When the weekly total is computed, Then it equals the sum of
  the week's entry hours (`10.0` for PM) and is produced by a memoized selector (no inline JSX
  `.reduce`). *(FR-TS-007)*
- **AC-608** — `listTimesheets()` unit contract.
  Given the db module, When called with a userId, Then it queries `from('timesheets')` with the nested
  entries+project select, filters `user_id`, sends no `org_id`, returns rows, and throws on PostgREST
  error. *(FR-DAL-TS-001)*

## Seed enrichment required (verified `supabase/seed.sql`)

Current seed has exactly ONE timesheet — owned by the **Engineer** (`…a4`), week `2026-06-01`
(a Monday), entries 8 + 8 = 16h. Two problems for the ACs:
1. The PM (`pm@acme.test`, `…a2`) — the protagonist of AC-601/602 — has **no** timesheet, so the page
   would render empty for the PM.
2. AC-603 needs two distinct users with distinct totals in the same week to prove own-rows isolation.

**Enrich** (current week = `2026-06-01`, already a Monday, passes `week_is_monday`):
- Add a **PM timesheet** `('70000000-…-002', user_id = …a2, week_start_date '2026-06-01', 'Draft')`
  with entries: `(project 40000000-…-001 'Innovate Corp HQ Fit-Out', '2026-06-01', 6, 'Client workshop')`
  and `(…001, '2026-06-02', 4, 'Status report')` → PM weekly total = 10.0.
- Engineer timesheet stays 8 + 8 = 16.0 (already seeded) — used by AC-603.
- Finance (`…a3`) gets **no** timesheet (used by AC-604 empty state).
Referential integrity: reuse existing project/profile ids; keep the Monday `week_start_date`; respect
`unique(user_id, week_start_date)` (PM row is the only one for a2/that week).

## Traceability
Each AC → exactly one Playwright/Vitest spec. e2e (local stack): AC-601/602/603/604. Component
(Vitest): AC-605/606/607 (+ AC-601/602 fast mirror). Unit (Vitest): AC-608.
