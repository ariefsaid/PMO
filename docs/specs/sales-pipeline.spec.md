# SalesPipeline — real Supabase data (read path) · Spec

**Issue:** #12 — SalesPipeline page → real Supabase data (read path).
**Type:** mirror/refactor of the shipped Projects/Procurement read-swap template (#4/#5).
**Status:** draft → awaiting owner sign-off on the `[OWNER-DECISION]` flags (defaults applied in
autonomous mode; see §6).

## 1. Context & current behavior (reverse-engineered)
`pmo-portal/pages/SalesPipeline.tsx` is the last module page still bound to the in-memory prototype
`mockData` (`import { projects } from '../data/mockData'`). It renders a sales-funnel view of projects
whose `status` is an active bid/tender stage, plus four KPI cards (total pipeline value, weighted
forecast, active-deal count + avg deal size, historical win-rate), and a Kanban board
(`components/SalesKanbanBoard.tsx`) grouped by stage with per-column total/weighted value.

The data already lives in Postgres: the `projects` table (migration `0001`) with `org_id` tenancy +
`projects_select` RLS (`0002`), seeded by `supabase/seed.sql`. The Projects and Procurement pages
already consume it via the `src/lib/db/*` + `src/hooks/*` + page template. This issue applies that
same template to SalesPipeline. **No schema, RLS, or new DB contract is introduced.**

### OBS — observed legacy behavior to preserve (the prototype contract)
- **OBS-001** The funnel includes projects in exactly these stages: `Leads`, `PQ Submitted`,
  `Quotation Submitted`, `Tender Submitted`, `Negotiation`, `Won, Pending KoM`. All other statuses
  (`Ongoing Project`, `On Hold`, `Close Out`, `Loss Tender`, `Internal Project`) are excluded.
- **OBS-002** Per-stage win probabilities: Leads 10%, PQ Submitted 20%, Quotation Submitted 40%,
  Tender Submitted 60%, Negotiation 80%, Won Pending KoM 100%.
- **OBS-003** Total pipeline value = Σ `contract_value` of funnel projects. Weighted forecast =
  Σ (`contract_value` × stage probability).
- **OBS-004** Active deals = funnel projects excluding `Won, Pending KoM`. Avg deal size = Σ
  `contract_value` of active deals ÷ active-deal count (0 when none).
- **OBS-005** Historical win-rate = won ÷ (won + lost) × 100, computed over **all** projects (not just
  the funnel), where won = {`Won, Pending KoM`, `Ongoing Project`, `Close Out`} and lost =
  {`Loss Tender`}; 0 when the denominator is 0.
- **OBS-006** The Kanban board groups funnel projects into six stage columns, each showing count,
  Σ `contract_value`, and the weighted (Σ × probability) subtotal; cards link to `/projects/:id`.

## 2. Scope
**In:** swap SalesPipeline + SalesKanbanBoard from `mockData` to the live org-scoped `projects` read;
add loading / empty / error states; migrate the shared board component to the snake_case DB shape;
reuse `formatCurrency`; memoize derived lists. **Out:** any write/create ("Add Lead" stays a no-op
button as in the prototype), new KPIs, server-side filtering, multi-currency, schema/RLS changes.

## 3. Functional requirements (EARS)
- **FR-SP-001** (ubiquitous) The system SHALL fetch the caller's projects through the existing
  org-scoped data-access layer, never sending `org_id` (RLS scopes rows).
- **FR-SP-002** (ubiquitous) The SalesPipeline page SHALL derive the funnel project list from the
  fetched rows by `status` membership per OBS-001, using `useMemo`.
- **FR-SP-003** (ubiquitous) The page SHALL compute total pipeline value, weighted forecast, active
  deal count, avg deal size, and historical win-rate per OBS-002…005 from the fetched rows.
- **FR-SP-004** (event-driven) When the projects query is pending, the page SHALL render a loading
  skeleton (not stale/empty content).
- **FR-SP-005** (event-driven) When the projects query errors, the page SHALL render an error state
  with a retry affordance.
- **FR-SP-006** (state-driven) While the fetched funnel list is empty, the board SHALL render its six
  empty stage columns (count 0, $0) without crashing — the funnel has no separate empty placeholder
  (mirrors prototype: the board itself is the empty state).
- **FR-SP-007** (ubiquitous) All currency SHALL be rendered via the shared `formatCurrency`
  (`src/lib/format.ts`), not an inline `Intl.NumberFormat`.
- **FR-SP-008** (ubiquitous) The page and `SalesKanbanBoard` SHALL consume snake_case DB rows
  (`ProjectWithRefs`) directly. No `as unknown as <prototype Project>` cast (string→enum widening of
  `status` only is permitted).
- **FR-SP-009** (ubiquitous) Board cards SHALL navigate to `/projects/:id` using the project's real
  uuid `id`, and SHALL show the joined client name (not the raw `client_id`).

## 4. Non-functional
- **NFR-SP-001** Reuses the existing `useProjects` hook + `listProjects` DAL (org-scoped `queryKey`);
  no new query module. Cache is shared with the Projects page (same key) — zero extra round-trips.
- **NFR-SP-002** Derived lists/KPIs memoized; no render-time `.find()` against other collections.
- **NFR-SP-003** Typecheck 0 errors, lint 0 warnings, ≥80% line coverage on changed code.

## 5. Acceptance criteria (Given/When/Then) + owning test layer
| AC | Given / When / Then | Owning layer |
|---|---|---|
| **AC-SP-001** | Given seeded projects incl. funnel + non-funnel statuses, When the page loads, Then only funnel-stage projects (OBS-001) appear on the board and non-funnel ones do not. | Unit (page) |
| **AC-SP-002** | Given funnel projects, When KPIs render, Then Total Pipeline Value = Σ contract_value of funnel projects (formatted via formatCurrency). | Unit (page) |
| **AC-SP-003** | Given funnel projects, When KPIs render, Then Weighted Forecast = Σ(contract_value × stage probability per OBS-002). | Unit (page) |
| **AC-SP-004** | Given funnel projects, When KPIs render, Then Active Deals count excludes `Won, Pending KoM` and Avg deal size = Σ active contract_value ÷ active count. | Unit (page) |
| **AC-SP-005** | Given a project mix with won & lost statuses, When the win-rate card renders, Then win-rate = won/(won+lost)×100 per OBS-005, and shows 0% when denominator is 0. | Unit (page) |
| **AC-SP-006** | Given funnel projects in a stage, When the board renders that column, Then the column shows the count and Σ contract_value for that stage. | Unit (board) |
| **AC-SP-007** | Given the projects query is pending, When the page renders, Then a loading skeleton (`data-testid="sales-loading"`) is shown. | Unit (page) |
| **AC-SP-008** | Given the projects query errors, When the page renders, Then an error message + Retry button are shown. | Unit (page) |
| **AC-SP-009** | Given zero funnel projects, When the board renders, Then all six stage columns show count 0 / $0 and no crash. | Unit (board) |
| **AC-SP-010** | Given a board card, When clicked, Then it navigates to `/projects/:id` using the project's real uuid and shows the joined client name (no `as unknown as` cast; no raw client_id). | Unit (board) |
| **AC-407** *(reused)* | An in-org reader reads all in-org projects via `projects_select`; cross-org blocked. | pgTAP `supabase/tests/0006_read_path.test.sql` — **already covered, not duplicated** |

## 6. `[OWNER-DECISION]` flags (defaults applied in autonomous mode)
- **`[OWNER-DECISION]` OD-SP-1 — Which `ProjectStatus` values constitute the sales pipeline?**
  *Default applied:* preserve the prototype set (OBS-001). *Risk:* `Negotiation` is a prototype-added
  stage and `Won, Pending KoM` sits at the funnel tail; the owner may want "Won" excluded from the
  open pipeline or `On Hold` deals surfaced. Cosmetic-only; safe to default.
- **`[OWNER-DECISION]` OD-SP-2 — Stage win probabilities (OBS-002).** *Default:* preserve prototype
  (10/20/40/60/80/100%). *Risk:* these drive the Weighted Forecast KPI shown to execs — real
  forecasting weights are a business calibration. Flagged, not invented.
- **`[OWNER-DECISION]` OD-SP-3 — Win-rate definition (OBS-005).** *Default:* preserve prototype
  `won/(won+lost)`, won = {Won Pending KoM, Ongoing, Close Out}, lost = {Loss Tender}. *Risk:* counting
  `Ongoing`/`Close Out` as "won" conflates delivery status with sales outcome; a cleaner definition is
  won = closed-won tenders only. Relates to backlog "OD — Win-rate metric". Flagged.
- **Note:** the current generic seed has **no** `Loss Tender` and no `Leads`/`Negotiation` projects, so
  live win-rate denominator = won-count only (rate shows 100% or 0%). Cosmetic for the demo; the unit
  tests assert the *formula* with a controlled fixture that includes lost rows.

## 7. Out-of-scope / deferred
Write path ("Add Lead"), server-side stage filtering, drag-to-advance-stage, configurable
probabilities/win-rate (the owner decisions above), and the shared `<ListState>` extraction
(backlog item) all remain deferred.
