# Spec: Executive Dashboard on real Supabase data — READ path (Issue #7)

Swaps `pages/ExecutiveDashboard.tsx` from in-memory `mockData` aggregation to **server-side SQL
aggregation** (target-arch §8.4 / FR-API-003). Last consumer of `mockUserForRole` → that module + its
test are deleted here. READ path only.

- **Grounds:** target-arch §8.4 (views/RPC replace in-memory aggregation), §4.1 (joins/aggregates in
  SQL, queries keyed by `org_id`), FR-API-003; ADR-0003 (DAL), ADR-0005 (TanStack Query),
  ADR-0001 (`org_id` seam). Reuses the exact pattern of `src/lib/db/procurements.ts`,
  `src/hooks/useProcurements.ts`, `src/lib/format.ts`, `e2e/helpers.ts` `login`.
- **KPI source DECISION — (a) one Postgres RPC `get_executive_dashboard()`** returning a single JSON
  payload (KPIs + all chart aggregates), consumed by a `useDashboard()` hook via `src/lib/db/dashboard.ts`.
  Chosen over (b) client-side compute because: (1) §8.4/FR-API-003 mandate SQL aggregation and flag the
  baseline in-memory aggregation as a smell (`OBS-DASH-*`); (2) every KPI/chart is a simple aggregate
  (`count`, `sum`, `avg`, `group by status`) — no client join needed; (3) one round trip, no fetching
  all rows to the browser, scales to millions of projects (only the aggregate crosses the wire);
  (4) the RPC inherits RLS from base tables (org-scoped) without sending `org_id`.
- **Security shape (RLS):** `get_executive_dashboard()` is **`security invoker`** (the default — do NOT
  mark it `security definer`). Invoker means every base-table read inside the function runs under the
  caller's RLS policies (`projects_select`/`procurements_select`/… = `org_id = auth_org_id()`), so the
  aggregates are automatically scoped to the caller's org. It takes **no `org_id` argument** (the seam:
  org comes from `auth_org_id()` inside the existing policies, never from the client). `auth_org_id()`
  itself stays `security definer` (its recursion guard, 0002) — that is unchanged. The function is
  `granted execute to authenticated`. *(security-auditor must confirm: invoker + no-arg + base-table RLS
  ⇒ no cross-org leakage and no definer-bypass — see Risks.)*
- **Schema (verified `0001_init_schema.sql`):** aggregates read `projects(status, contract_value,
  budget, spent, org_id)` and `procurements(status, org_id)`. "At-risk" uses `spent/budget` (budget>0).
  Indexes `projects_org_status_idx`, `procurements_org_status_idx` already cover the GROUP BYs.

## Scope

**IN (READ only):**
- Migration `supabase/migrations/0003_dashboard_views.sql`: RPC `get_executive_dashboard()` (`security
  invoker`, no args, returns `json`) computing the Executive KPIs + chart aggregates in SQL; grant
  execute to `authenticated`. Reversible per pre-production contract (ADR-0006: `supabase db reset`).
- `src/lib/db/dashboard.ts`: typed `getExecutiveDashboard(): Promise<ExecutiveDashboard>` calling
  `supabase.rpc('get_executive_dashboard')`; sends no `org_id`; throws on error.
- `src/hooks/useDashboard.ts`: org-scoped `useDashboard()` (queryKey `['dashboard', orgId]`,
  enabled on `orgId`).
- Swap the **Executive view** of `pages/ExecutiveDashboard.tsx` to real data: 4 KPI cards, Project
  Pipeline (projects-by-status bar), a procurement-by-status chart, a budget-vs-spent (Top Projects by
  Value) table — all backed by the RPC; `useMemo` for any view-shaping; loading/empty/error+retry states.
- **Remove `mockUserForRole` entirely** once Dashboard no longer needs it (Dashboard is the last
  consumer — verified): delete `src/auth/mockUserForRole.ts` + `src/auth/mockUserForRole.test.ts` after
  grep confirms no other importer.
- Seed enrichment: add procurement-status + project-status spread already sufficient (verified below);
  add **one extra Ongoing project** so "active projects" KPI is ≥2 and at-risk math is demonstrable.

**OUT (flag, don't build):**
- Any dashboard WRITES; drill-down navigation beyond what exists today.
- The **role-branched sub-dashboards** (`EngineerDashboard`, `PMDashboard`, `FinanceDashboard`): these
  stay on `mockData` *for their own data* but no longer depend on `mockUserForRole` — see OD-D3. Their
  real-data migration is a separate issue (one view per role per §8.4: `v_pm_dashboard`,
  `v_finance_dashboard`, `v_engineer_workload`).
- `ProjectDetails` / `ProcurementDetails` / `SalesPipeline` stay mockData (separate issues).
- The "Monthly Performance (YTD)" line chart and KPI `change`/`changeType` deltas: these are
  hard-coded fakes (`F-11`) with no time-series source in the schema. Deferred — see OD-D2.

## `[OWNER-DECISION]` flags (non-blocking; defaults applied)

- **OD-D1 (win-rate / at-risk definition)** — The current Exec view has **no** win-rate KPI; its four
  KPIs are Active Projects, Total Contract Value, Average Gross Margin, Projects at Risk. Default carried
  forward: **Average Gross Margin** = `avg((budget - spent)/budget)` over Ongoing projects with
  `budget>0`; **Projects at Risk** = count of Ongoing projects with `budget>0 and spent/budget > 0.9`
  (the prototype hard-coded "3"/"budget usage > 90%" — now computed). Confirm both definitions, and
  whether a true **win-rate** KPI (won ÷ (won+lost) tenders) should replace one of these later.
- **OD-D2 (KPI deltas + YTD line chart)** — `change`/`changeType` (e.g. "+2", "+5.2%") and the Monthly
  Performance line chart are prototype fakes with no historical source. Default: **drop the delta
  arrows** (render KPI value + description only) and **drop the YTD line chart** this issue. Confirm
  whether a period-over-period snapshot table is wanted in a later issue.
- **OD-D3 (non-Executive role dashboards)** — Engineer/PM/Finance sub-dashboards keep their `mockData`
  for now but must drop the `mockUserForRole` dependency. Default: branch on `useAuth().role`
  (real session role) instead of `mockUserForRole(effectiveRole)?.role`; the sub-dashboards that need a
  user id (`EngineerDashboard`, `PMDashboard`) fall back to a stable mock id constant until their own
  real-data issue. Confirm this interim is acceptable, or whether the sub-dashboards should show a
  "coming soon" placeholder instead of mock numbers.
- **OD-D4 (procurement chart)** — The current Exec view has no procurement chart; the issue asks for
  "procurement-by-status". Default: **add** a procurement-by-status bar chart to the Exec view backed by
  the RPC aggregate. Confirm placement (replacing the YTD line chart slot per OD-D2).

## Functional requirements (EARS)

- **FR-DASH-001** — When the Executive Dashboard mounts for an authenticated user, the system shall
  fetch KPIs + chart aggregates via `useDashboard()` and render the Executive view from them (no
  `mockData`, no `mockUserForRole`).
- **FR-DASH-002** — The system shall compute all KPIs and chart aggregates **in SQL** (the
  `get_executive_dashboard` RPC), not by aggregating fetched rows in the browser (FR-API-003).
- **FR-DASH-003** — While the dashboard query is pending, the system shall render a loading skeleton
  (`data-testid="dashboard-loading"`).
- **FR-DASH-004** — While the dashboard query has errored, the system shall render an error message with
  a Retry control that re-runs the query (`data-testid="dashboard-error"`, button name `Retry`).
- **FR-DASH-005** — Where the org has zero projects and zero procurements, the system shall render an
  empty state (`data-testid="dashboard-empty"`), not crash or show NaN.
- **FR-DASH-006** — The system shall display four Executive KPI cards: Active Projects (count of Ongoing),
  Total Contract Value (Σ contract_value of Ongoing, formatted), Average Gross Margin (avg
  `(budget-spent)/budget` of Ongoing with budget>0, as a %), Projects at Risk (count of Ongoing with
  `spent/budget > 0.9`).
- **FR-DASH-007** — The system shall render a Project Pipeline bar chart of project count grouped by
  `project_status`, and a Procurement-by-Status bar chart of procurement count grouped by
  `procurement_status`, both from the RPC aggregates (OD-D4).
- **FR-DASH-008** — The system shall render a "Top Projects by Value" table (top 5 by contract_value)
  with client name, contract value, status, and a budget-vs-spent progress bar — values from the RPC
  (joins resolved in SQL, no render-time `.find()`).
- **FR-DASH-009** — The page shall determine the rendered dashboard from the REAL session role
  (`useAuth().role`); all use of `mockUserForRole` shall be removed and the module + its test deleted
  (no remaining importer).
- **FR-DASH-010** — Currency shall be rendered via the shared `formatCurrency` (`src/lib/format.ts`);
  percentages via `toFixed(1)` — preserving prototype output. No inline `Intl.NumberFormat`.
- **FR-DAL-DASH-001** — `getExecutiveDashboard()` shall call `supabase.rpc('get_executive_dashboard')`,
  send no `org_id`, return the typed payload, and throw `new Error(error.message)` on RPC error.
- **FR-QRY-DASH-001** — `useDashboard()` shall read `currentUser` from `useAuth`, key the query
  `['dashboard', orgId]`, and be `enabled` only when `orgId` is present.

## OBS (legacy behavior being replaced)

- **OBS-DASH-001** — Baseline computes KPIs/pipeline/margins in render from `mockData`
  (`ExecutiveDashboard.tsx` lines 275-305) and uses hard-coded deltas + a fake YTD series (`F-11`).
  Replaced by FR-DASH-002 (SQL aggregation) and OD-D2 (deltas/YTD dropped).
- **OBS-DASH-002** — Baseline resolves client name per row via `companies.find(c => c.id ===
  project.clientId)` (render-time O(n) `.find()`, `F-7`). Replaced by SQL join in the RPC (FR-DASH-008).

## NFR

- **NFR-DASH-PERF-001** — One RPC round trip per dashboard load returning only aggregates (bytes ∝ number
  of statuses + top-5 rows, not total project/procurement count); GROUP BYs hit the existing
  `projects_org_status_idx` / `procurements_org_status_idx`. No client-side full-table aggregation, no
  N+1, no render-time `.find()` (NFR-PERF-002).
- **NFR-DASH-PERF-002** — Any view-shaping (e.g. mapping aggregate arrays to recharts data) is memoized
  with `useMemo` keyed on the RPC payload.
- **NFR-DASH-SEC-001** — `get_executive_dashboard()` is `security invoker`, takes no `org_id` arg, and is
  granted only to `authenticated`; cross-org isolation is enforced by base-table RLS, not by the
  function. The `org_id` seam is not client-spoofable (no org param exists).

## Acceptance criteria (Given/When/Then)

- **AC-701** — Executive sees real KPI values from seeded data.
  Given the Executive signed in (seed below: 2 Ongoing projects — P001 $5,000,000 + the new P003
  $3,000,000), When they open `/`, Then the **Active Projects** card shows `2` and **Total Contract
  Value** shows `$8,000,000` — assertions target RENDERED computed values. *(FR-DASH-001/002/006)*
- **AC-702** — Average Gross Margin + Projects at Risk are computed, not hard-coded.
  Given the Executive on `/` (P001 budget 4,700,000 / spent 2,100,000 ⇒ margin 0.5532; P003 budget
  2,000,000 / spent 1,900,000 ⇒ margin 0.05, spent/budget 0.95 > 0.9 ⇒ at-risk), When the page renders,
  Then **Average Gross Margin** shows `30.2%` (avg of 55.32% and 5.0% = 30.16%, `toFixed(1)`) and
  **Projects at Risk** shows `1`. *(FR-DASH-006, OD-D1)*
- **AC-703** — Project Pipeline chart reflects real status aggregates.
  Given the Executive on `/`, When the Project Pipeline renders, Then it shows a non-zero bar for
  "Ongoing Project" with count `2` (asserted via the rendered pipeline test region, e.g.
  `data-testid="dashboard-pipeline"` containing the count). *(FR-DASH-007)*
- **AC-704** — Procurement-by-Status chart reflects real aggregates.
  Given the Executive on `/` (seed: 5 procurements across Draft/Requested/Vendor Quoted/Ordered/Paid),
  When the chart renders, Then the procurement-by-status region (`data-testid="dashboard-proc-status"`)
  shows 5 distinct statuses each with count `1`. *(FR-DASH-007, OD-D4)*
- **AC-705** — Top Projects by Value table shows real joined client names.
  Given the Executive on `/`, When the table renders, Then the top row is "Innovate Corp HQ Fit-Out"
  with client "Innovate Corp" and value `$5,000,000`, with the name/client resolved server-side (no
  mock `companies` array). *(FR-DASH-008)*
- **AC-706** — Loading skeleton.
  Given the dashboard query is pending, When the page renders, Then `dashboard-loading` is shown and no
  KPI numbers. *(FR-DASH-003)*
- **AC-707** — Error + retry.
  Given the query errors, When the page renders, Then `dashboard-error` with a Retry button is shown;
  When Retry is clicked, Then the query re-runs. *(FR-DASH-004)*
- **AC-708** — Empty state (no business data).
  Given an org with zero projects and zero procurements, When the Executive opens `/`, Then
  `dashboard-empty` is shown and no NaN/crash. *(FR-DASH-005)* — covered by component test (mocked
  empty payload); the seeded org is non-empty so this is not an e2e.
- **AC-709** — Org-scoped KPIs via RLS (RPC invoker).
  Given an Engineer signed in (same org as seed), When they open `/`, Then the dashboard still renders
  org-scoped KPI numbers (the RPC, being `security invoker`, returns the same org's aggregates because
  Engineer's `projects_select` is read-in-org), proving the aggregates are RLS-scoped and not
  client-supplied. *(NFR-DASH-SEC-001, FR-QRY-DASH-001)*
- **AC-710** — `getExecutiveDashboard()` unit contract.
  Given the db module, When called, Then it invokes `supabase.rpc('get_executive_dashboard')` with no
  `org_id` argument, returns the payload, and throws on RPC error. *(FR-DAL-DASH-001)*
- **AC-711** — `mockUserForRole` removed; no importer remains.
  Given the repo after this issue, When `mockUserForRole` is searched under `pmo-portal/`, Then there is
  no importer and the module + its test no longer exist; typecheck + the suite are green.
  *(FR-DASH-009)*

## RPC contract (`get_executive_dashboard` → `json`)

Single JSON object (snake_case keys; numbers as JSON numbers):
```json
{
  "active_projects": 2,
  "total_contract_value": 8000000,
  "avg_gross_margin": 0.30162,
  "projects_at_risk": 1,
  "projects_by_status": [{ "status": "Ongoing Project", "count": 2 }, ...],
  "procurements_by_status": [{ "status": "Paid", "count": 1 }, ...],
  "top_projects": [
    { "id": "...", "name": "Innovate Corp HQ Fit-Out", "client_name": "Innovate Corp",
      "contract_value": 5000000, "budget": 4700000, "spent": 2100000, "status": "Ongoing Project" }
  ]
}
```
- `active_projects` = count(status='Ongoing Project'); `total_contract_value` = sum(contract_value)
  where status='Ongoing Project'; `avg_gross_margin` = avg((budget-spent)/budget) where
  status='Ongoing Project' and budget>0 (null→0 if none); `projects_at_risk` = count where
  status='Ongoing Project' and budget>0 and spent/budget>0.9.
- `projects_by_status` / `procurements_by_status` = `count(*) group by status` (only present statuses).
- `top_projects` = top 5 by contract_value, client_name via `left join companies`.
- All reads run under the caller's RLS (invoker) ⇒ org-scoped automatically.

## Seed enrichment required (verified `supabase/seed.sql`)

Current seed: 3 projects (P001 Ongoing, P002 Tender Submitted, P010 PQ Submitted) — only **one**
Ongoing, so "active projects" = 1 and "at risk" has no demonstrable case. Procurements already span 5
statuses (Vendor Quoted, Ordered, Requested, Draft, Paid) — sufficient for AC-704, no change.

**Enrich** — add ONE Ongoing project that triggers the at-risk path, so AC-701/702/703 have stable
numbers:
- Add project `('40000000-…-004','P003','Acme Internal Platform','Ongoing Project',
  client_id 'c0000000-…-002' (Innovate Corp), pm '…a2', contract_value 3000000, budget 2000000,
  spent 1900000, start '2026-02-01', end '2026-11-30')`.
- Result: 2 Ongoing (P001 + P003); Total Contract Value (Ongoing) = 5,000,000 + 3,000,000 = **8,000,000**;
  margins 0.5532 (P001) and 0.05 (P003) ⇒ avg **0.30162 → 30.2%**; at-risk = 1 (P003, 0.95 > 0.9).
- Referential integrity: reuses existing client/PM ids; respects `unique(org_id, code)` (P003 is new).
- Top Projects by value unchanged at the top: P001 (5M) > P003 (3M) > P002 (1.2M) > P010 (0.8M).

## Traceability
Each AC → exactly one Playwright/Vitest spec. e2e (local stack): AC-701, AC-702, AC-705, AC-709.
Component (Vitest): AC-701/702 fast mirror, AC-703, AC-704, AC-706, AC-707, AC-708. Unit (Vitest):
AC-710. Repo-search gate: AC-711.

## Risks / open questions for the Director
- **R1 (RLS + RPC — security review required).** A new RPC is a new surface. The design is `security
  invoker` + no `org_id` arg, so base-table RLS (`org_id = auth_org_id()`) scopes every read — the safe
  default. The risk is a future maintainer "fixing performance" by switching it to `security definer`
  (to skip per-row RLS) without re-adding an explicit `org_id = auth_org_id()` filter, which would leak
  cross-org aggregates. **security-auditor must verify invoker + no-arg before this ships** and the
  migration must carry an inline comment forbidding the definer switch without an org filter.
- **R2 (`avg_gross_margin` null/zero).** If no Ongoing project has budget>0, `avg(...)` is null and
  at-risk is 0; the RPC coalesces to 0 and the empty-state (FR-DASH-005) covers the wholly-empty org.
  Confirm 0% (not "—") is acceptable display for the no-data margin case.
- **R3 (regenerating `database.types.ts`).** The RPC adds a `Functions.get_executive_dashboard` entry;
  types are normally regenerated from the live DB. Since the DAL types the payload locally
  (`ExecutiveDashboard` interface) and calls `rpc('get_executive_dashboard')` (string-keyed), the build
  does not require the generated entry. Plan regenerates types in the build phase if the local stack is
  up; otherwise the local interface is the contract. Flagged so the implementer regenerates when able.
