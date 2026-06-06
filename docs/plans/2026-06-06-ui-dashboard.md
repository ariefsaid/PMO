# UI Design-Plan — Dashboard + per-role sub-dashboards → IA-3 (Issue 5)

**Date:** 2026-06-06
**Author:** design-architect
**Status:** Design+Plan (per-surface). Implements §4.4 of `docs/plans/2026-06-06-ui-realignment.md`.
**Authorities:** `DESIGN.md` (token/identity authority) · `docs/design-mockups/proposal-IA-3-hybrid.html` (layout/IA authority) · `docs/plans/2026-06-06-ui-realignment.md` §4.4 + §5 (master plan + cross-cutting acceptance) · `docs/product-expectations.md` Part C (charter).
**Method applied:** `impeccable shape` (UX/UI shaped before code) + `ui-ux-pro-max plan` (layout + 99-guideline checklist, incl. §10 Charts & Data a11y) + `taste` required-states / a11y / anti-slop folded into the acceptance list. Identity preserved — **no new aesthetic, palette, font, or token invented.** Reference/gap-analysis only.

> Scope note. This builds on §4.4 of the master plan; it does **not** re-derive the program. It is the implementer-ready, no-placeholder, token-named, TDD-task version of that section, scoped to the one source file being migrated (`pages/ExecutiveDashboard.tsx`) plus its co-located tests and the Foundation primitives already merged on `main`. This issue is mostly **chart work on already-built KPI/seg primitives** (master §2) plus the per-role data-sourcing decision.

---

## 0. What is already done (do NOT rebuild)

Foundation (Issue 1) is merged. The following are **present on `main` and reused verbatim** — the implementer imports them, never re-authors them:

- **Primitives** (`pmo-portal/src/components/ui/`): `KPITile` (with the **dual-lens** `dual` prop already implemented — `KPITile.tsx`, props `icon/tone/label/value/negative/help/delta/vs/loading/dual`), `Card`/`CardPad` (`Card.tsx`), `ViewToggle` (the segmented `seg` control — `ViewToggle.tsx`, used both standalone and as the dual-lens toggle inside `KPITile`), `ProgressBar` (`ProgressBar.tsx`, threshold-colored), `ListState` (loading skeleton / empty / error+retry — `ListState.tsx`), `DataTable` + `TableFoot` (`DataTable.tsx`), `StatusPill` (`StatusPill.tsx`), `Button`, `Icon` + `IconName` (`icons.tsx`/`iconPaths.tsx`), `Tooltip` (`Tooltip.tsx`, the KPI `?` help affordance).
- **Chart theming — PRESERVE EXACTLY:** `pmo-portal/src/components/ui/chartTheme.ts` — `chartTheme.axis` (`muted-foreground`), `chartTheme.grid` (`border`), `chartTheme.series.{primary,success,warning,destructive,violet}` (token-resolved `hsl(var(--…))` strings), and `chartTheme.categorical[]` (the 6 frozen sanctioned literals, Open Q2 of the master plan). **Every recharts color in this issue must come from `chartTheme`** — no new chart colors, no raw hex.
- **Data layer — PRESERVE EXACTLY:** `useDashboard()` (`src/hooks/useDashboard.ts`) → `get_executive_dashboard` RPC (returns the full `ExecutiveDashboard` payload, `src/lib/db/dashboard.ts`); `useWinRate(range)` → `get_win_rate(p_from,p_to)`; the win-rate **period + count/value** logic (`buildWinRateRange`, `PeriodKey`, the `mode` state) is correct and AC-1117-covered — preserve its behavior, re-skin only its chrome. Other DALs available for per-role sourcing (see §4): `useProjects()` → `listProjects` (`projects.ts`), `useProcurements()` → `listProcurements` (`procurements.ts`), `useTimesheets()` → `listTimesheets` (own-user, `timesheets.ts`), `useTimesheetsAwaitingApproval()` → `listTimesheetsAwaitingApproval` (manager queue, `useTimesheetApproval.ts`).
- **Role model — REUSE, do NOT invent:** `useEffectiveRole()` (`src/auth/impersonation`) returns the impersonation-aware `effectiveRole` (`'Engineer' | 'Project Manager' | 'Finance' | 'Executive' | 'Admin'`). The current file already branches on it (lines 524-533). This is the existing permission model (ADR-0008 — never touches RLS); the per-role dashboard is a **presentation selection** off this, not a new permission system.

**Files this issue creates/replaces (presentation only):**
- `pmo-portal/pages/ExecutiveDashboard.tsx` (rewrite — re-skin the Exec view; rewrite the three role sub-dashboards off real data / deferred placeholders; **delete all `data/mockData` imports and the `MOCK_ENGINEER_ID`/`MOCK_PM_ID` constants**).
- New small presentational helpers as needed (co-located or in `src/components/dashboard/`): `BvACard`, `WinRateCard` (re-skin in place), `CommittedDonut`, `ProjectedMarginBars`, `ChartFrame` (the shared loading/empty/error chart wrapper — see §6). Keep them thin; they consume `chartTheme` + the existing hooks.
- co-located Vitest specs + the AC table below (§9).

> **mockData is being eliminated here.** This issue clears the OD-D3 debt for the dashboard surface: no `data/mockData` import survives in `ExecutiveDashboard.tsx`. The legacy `EngineerDashboard`/`PMDashboard`/`FinanceDashboard` (which read `tasks`/`projects`/`procurements` from mock and fabricate `weeklyHours`/`spendByCategory`/`pendingTimesheets`) are deleted and replaced per the §4 split.

---

## 1. Feature summary

The Dashboard is the **leadership landing surface**: an executive opens the app and reads portfolio health at a glance — margin on hand, weighted pipeline forecast, delivery exposure — then the same surface, gated by `effectiveRole`, narrows to what a PM / Finance / Engineer needs. IA-3 makes it a **single pane with no view toggle** (master §2): page head → KPI band → two chart rows. The win-rate basis (count/value) and time-frame toggles, and the dual-lens margin toggle, are the only interactive controls.

**Primary user action:** scan the KPI band and two chart rows to assess portfolio health; toggle win-rate basis/window and the margin lens to interrogate a figure. No drill-to-detail route on this surface (it links *out* to the record surfaces via the rail, not via row clicks).

**Identity:** "The Quiet Control Surface" (DESIGN.md §1). One blue does all interactive work; KPI values are `23px/700 tabular`; status/series color is data-driven only; categorical violet/cyan are non-interactive accents; borders not shadows; Inter + tabular figures everywhere; charts themed from tokens (DESIGN.md §"How to use … Charts"). The current file's `text-gray-*`/`dark:*`/`text-primary-600`/`bg-blue-50`/raw-hex chart fills (`#3b82f6`, `#10b981`, `#8b5cf6`, `#ef4444`, the `COLORS` array, the `rgba(31,41,55,.8)` tooltip) are **legacy and must be migrated out** (token table §8).

---

## 2. Layout strategy (Exec pane — the reference composition)

Vertical flow inside the existing `AppShell` main region (rail+header+tabstrip are already chrome — this surface renders only the page body), mirroring the mockup `surfDashboard` (lines 1188-1257):

1. **Page head** — `page-title` "Executive Dashboard" + `body`/`muted-foreground` sub "Portfolio health across the contracting book — margin on hand, pipeline forecast, and delivery exposure." + trailing actions: a **Win-rate window** `control` chip (cal icon + label + chevron; this is the *global* window selector from the mockup) and a `Button` outline "Board pack" export.
   - *Decision:* the mockup has a single global win-rate window in the page head **and** a per-card window seg inside the Win-rate card. To avoid two competing controls (`primary-action` / `state-clarity`), **keep the per-card window+basis seg as the single source** (it is the AC-1117-covered behavior) and make the page-head "Board pack" the only head action. The page-head win-rate `control` is **deferred** (it would duplicate the card's control); flag in Open Questions. *(If the owner wants the global control, it drives the same `period` state the card uses — one state, two surfaces — but default to the card-only control to keep One-Primary-Action.)*
   - Board-pack export is a **non-functional CTA** this issue (the export pipeline is out of scope, like Pipeline's New-Deal): wire to a toast "Generating board pack…" or disabled-with-tooltip; do not build export.
2. **KPI band** — 6-up `KPITile` grid (`grid-cols-6` desktop), each tile token-mapped (§3.1). Tiles 1-6 map to the mockup's six (On-hand margin / Pipeline weighted / **dual-lens Projected margin** / Active projects / Budget vs actual / Committed spend). `aria-label="Portfolio KPIs"` on the band.
3. **Chart row 1** (`grid-2`): **Budget vs Actual — Active Projects** card (left) + **Win Rate** card (right).
4. **Chart row 2** (`grid-2`): **Committed Spend by Category** donut card (left) + **Pipeline — Projected Margin** stage-bars card (right).

**Responsive (DESIGN.md §Mobile + mockup breakpoints, lines 778-800).** The KPI band reflow is the load-bearing responsive behavior:
- `>1180px`: `repeat(6,1fr)` (`.kpi-band.six`).
- `≤1180px`: `repeat(3,1fr)` (mockup line 778).
- `≤920px`: `repeat(2,1fr)` (mockup line 790) — also the rail-hide breakpoint (shell-owned, this surface does nothing extra).
- `≤560px`: `1fr` single column (mockup line 800).
- Chart rows: `grid-2` → single column under ~900px. Charts use `ResponsiveContainer` (already the pattern) so they reflow; donut + projected-margin bars stack. No body-level horizontal scroll (`horizontal-scroll` guideline) — charts shrink, they don't scroll.

Implement the KPI reflow with a Tailwind-mapped responsive grid: `grid grid-cols-1 sm:grid-cols-2 min-[920px]:grid-cols-3 min-[1180px]:grid-cols-6` (or the project's existing breakpoint tokens). The exact px breakpoints (1180/920/560) come from the mockup and are the system's dashboard breakpoints — name them as Tailwind `min-[…]` arbitrary variants mapped to those, not invented values.

---

## 3. Component breakdown (Exec pane)

### 3.1 KPI band — 6 tiles via `KPITile`

All six are the **already-built `KPITile`** primitive. Tones are the `KPITone` union (`blue|violet|amber|red|green|cyan`); icons are `IconName`. Every `value` is `tabular`. `negative` flips the value to `destructive` for negative margin/delta. Each tile carries a `help` tooltip (the metric definition) — keyboard-focusable `?` is built into `KPITile`.

| # | tone | icon | label | value (from RPC) | foot | source field |
|---|---|---|---|---|---|---|
| 1 | `green` | `dollar` | On-hand margin | `formatCurrency(data.on_hand_value)` | delta `up`/`down` + `(on_hand_margin*100).toFixed(1)% realized` | `on_hand_value`, `on_hand_margin` |
| 2 | `violet` | `pipe` | Pipeline (weighted) | `formatCurrency(data.pipeline_weighted_value)` | vs `of {formatCurrency(pipeline_total_value)} gross` | `pipeline_weighted_value`, `pipeline_total_value` |
| 3 | `blue` | `up` | Projected margin **(dual-lens)** | on-hand: `(on_hand_margin*100).toFixed(1)%` / weighted: `(pipeline_projected_margin*100).toFixed(1)%` | `dual` ViewToggle: On-hand \| Weighted | `on_hand_margin`, `pipeline_projected_margin` |
| 4 | `cyan` | `folder` | Active projects | `String(data.active_projects)` | vs `{projects_at_risk} at-risk` | `active_projects`, `projects_at_risk` |
| 5 | `amber` | `grid` | Budget vs actual | `{budgetVsActualPct}%` (derived — see note) | vs `{formatCurrency(actual)} actual` | derived from `top_projects` (see note) |
| 6 | `red` | `cart` | Committed spend | `formatCurrency(committedTotal)` (derived — see note) | vs `{pctOfBudget}% of budget` | derived from `top_projects` (see note) |

> **Tiles 5 & 6 — derivation, NOT a new RPC.** The mockup shows "Budget vs actual %" and "Committed spend". The `get_executive_dashboard` payload exposes `top_projects[]` with `{ budget, spent, contract_value }` per project. Portfolio actual % = `Σspent / Σbudget`; committed-spend total has **no dedicated field** in the payload (the payload has `spent`, not `committed`). **Decision:** tile 5 (Budget vs actual) is derivable now from `top_projects` (`Σspent/Σbudget`). Tile 6 (Committed spend) — the payload has no `committed` aggregate. Two options, owner to confirm (Open Q1): **(a)** relabel tile 6 to **"Total project spend"** = `Σ top_projects.spent` (real now, honest label), or **(b)** keep "Committed spend" as a **deferred placeholder** (`KPITile` with `loading={false}` showing an em-dash + a "Coming soon" help tip) until a `committed` aggregate is added to the RPC. **Recommend (a)** — it is real, on-brand, and the "committed" concept already lives on the Projects budget surface; a portfolio committed-spend aggregate is a genuine new backend slice and should not block this re-skin. Do NOT fabricate a committed figure. The delta chips in the mockup (`+2.1pt`, `+6.8%`) are **mockup decoration** — the RPC exposes no period-over-period comparison, so **omit the delta chip** (or show only the `vs` foot line) until a trend query exists; do not fabricate a delta. *(Open Q2.)*

`tnum`/tabular is mandatory on every value and foot figure (`number-tabular`, DESIGN.md Tabular-Numbers Rule). `formatCurrency` from `src/lib/format` (already used).

### 3.2 Chart row 1 — Budget vs Actual + Win Rate

**Budget vs Actual — Active Projects** (`BvACard`). The mockup (`dashBvac`, lines 1275-1289) renders, per active project, two stacked `ProgressBar`-style rows: Committed (`warning/.55`) and Actual (the project's categorical color), with a `{actual} / {contract}` tabular readout and an "At risk" `StatusPill` when applicable. **Recommendation:** render this as the **mockup's dual-bar list** (reusing `ProgressBar`), NOT a recharts bar chart — it is more legible, on-brand (borders/bars not chart chrome), and matches the mockup exactly. Source = `data.top_projects` (real). Per row:
- project name (`13px/600`) + categorical dot (sanctioned literal / `chartTheme.categorical[i]`) + optional At-risk `StatusPill` (`warn`) when `status` is the at-risk value.
- `{formatCurrency(spent)} / {formatCurrency(contract_value)}` (`tabular`, `muted-foreground`).
- Committed bar: `ProgressBar` fill `warning/.55` (token), `committed/contract` — *but* `top_projects` exposes `spent` not `committed`; until a committed field exists, render **one Actual bar** (`spent/contract`, threshold-colored) and label the legend "Actual / Contract", dropping the committed bar. This keeps it real (no fabricated committed value). Legend: Actual (`primary` or categorical) · Contract track (`secondary`). *(Same committed-field gap as tile 6 — Open Q1.)*
- `aria-label="Budget vs actual by project"` on the section; each bar pair has an accessible `{name}: {pct}% of contract` label (`screen-reader-summary`, `color-not-only`).

**Win Rate** (`WinRateCard` — re-skin in place). Preserve `useWinRate` + `mode` (count/value) + `period`/`buildWinRateRange` logic exactly (AC-1117). Re-skin chrome to the mockup (`winRateBody`, lines 1309-1318):
- two `seg` controls (`ViewToggle`): **By count | By value** (`role="group" aria-label="Win-rate basis"`) and **90d | 12 mo | All time** (`aria-label="Time frame"`). Map the existing `PeriodKey` (`all|ytd|q|t12`) onto the three mockup frames; **decision:** the mockup shows 90d/12mo/all; the live code has `all/ytd/q/t12`. Keep the live four-option set as the source of truth (it is RPC-backed and AC-1117-covered) but render them in the seg as the live labels (All time · YTD · Last quarter · Trailing 12mo) — do NOT silently drop YTD to match the mockup's three. *(Open Q3 — reconcile frame labels with owner; default = keep the four real options.)*
- big rate number: `34px/700 tabular` (`{(rate*100).toFixed(1)}%`); won/closed readout (`{wins} won of {total} closed`, basis-aware).
- a single `ProgressBar` (`12px` height) won%, fill `chartTheme.series.success`, track `secondary` (= "Lost").
- legend: Won (`success` dot) · Lost (`secondary` dot) — `color-not-only` (dot + text label).
- `aria-label="Win rate"` on the section; `aria-live="polite"` on the rate value so basis/frame toggles announce.

### 3.3 Chart row 2 — Committed-spend donut + Projected-margin bars

**Committed Spend by Category** (`CommittedDonut`). The mockup (`dashDonut`, lines 1291-1306) is an SVG donut over `BUDGET_CATS` (per-category committed + categorical color) with a center total and a legend (name + value). **Data gap (the crux for this card):** the `get_executive_dashboard` payload has **no per-category committed breakdown** — `procurements_by_status` is a status count, not a category-value breakdown, and there is no budget-category aggregate. **Decision:** this donut needs a genuinely new aggregate (committed-spend grouped by cost category across the portfolio) that no current RPC returns. **Defer it** — render the card as a `ListState` **empty** ("Category breakdown coming soon" + a one-line note that per-category committed spend requires a portfolio budget rollup), flagged as a follow-up backend slice (Open Q4). Do NOT fabricate `spendByCategory` percentages (the legacy `FinanceDashboard` did exactly this — `totalSpent * 0.4` etc. — and that is the anti-pattern we are removing).
  - *Alternative the owner may prefer (Open Q4):* repurpose this card to a **Procurement-by-status** donut/bar driven by the real `procurements_by_status` (which IS in the payload), recoloring it status-toned (see §5). That is real now. **Recommend the alternative** over an empty card if the owner wants row 2 populated: a status breakdown is genuinely useful and real, whereas a category breakdown is a new backend slice. Default until decided: render the Procurement-by-status chart (real) here, donut or bar, status-toned.

**Pipeline — Projected Margin** (`ProjectedMarginBars`). The mockup (lines 1241-1256) shows a 30px headline % + per-stage weighted-value bars. **Data gap:** the per-stage weighted breakdown comes from `get_sales_pipeline` (`stages[].weighted_value`), NOT from `get_executive_dashboard`. `useSalesPipeline()` already exists and is RPC-backed. **Decision:** wire this card to `useSalesPipeline()` (real, no new query) — headline % = `data.pipeline_projected_margin` (from the exec payload, already loaded) + per-open-stage bars from `salesPipeline.stages` (`weighted_value` per stage, excluding Won/Lost). Bar fill = the stage categorical color (`chartTheme.categorical[i]`), track `secondary`. `aria-label="Pipeline projected margin"`; each bar `{stage}: {formatCurrency(weighted)}`. This is real now.

---

## 4. Per-role sub-dashboards — DATA-SOURCING DECISION (the crux)

The Exec/Admin pane is §2-§3 (real, re-skinned). The other three are gated by `effectiveRole` and are the **same primitives, different selection** (master §4.4). The decision below is grounded in exactly what `dashboard.ts` + the other DALs return.

**Hard rule applied (from the brief):** wire REAL where an existing query/payload supports it; **defer as an on-brand placeholder** where a KPI needs a genuinely new RPC/RLS slice; **never keep mockData and never fabricate.**

### 4.1 Project Manager — MOSTLY REAL, one deferred

| KPI / widget | Real-now? | Source |
|---|---|---|
| My projects (count) | **REAL** | `useProjects()` filtered by `project_manager_id === currentUser.id` (the `listProjects` `pmId` param exists, or filter the cached list client-side) |
| My total contract value | **REAL** | `Σ contract_value` over my projects (`useProjects`) |
| At-risk (my projects) | **REAL** | count of my projects whose `status` is the at-risk value (`useProjects`) |
| Budget vs Actual (my projects) | **REAL** | the §3.2 `BvACard` fed my-projects subset (`useProjects` → `budget`/`spent`/`contract_value`) |
| Project status overview list | **REAL** | `useProjects` (my subset): name + `StatusPill` + margin% (`(contract-spent)/contract`) — reuses `DataTable` |
| **Pending approvals** (timesheets+procurements) | **DEFERRED** | the legacy figure (`pendingTimesheets=3 + pendingProcurements=2`) was **fabricated**. Timesheet approvals queue count IS real via `useTimesheetsAwaitingApproval()` (manager queue). **Procurement** pending-approval count has **no per-PM query** (SoD/approval-state isn't exposed as a PM-scoped count). **Decision:** show **"Timesheets awaiting approval"** REAL via `useTimesheetsAwaitingApproval().length`; **defer** the procurement-approvals half (omit, or "—" with a "coming soon" tip). Do not sum a real count with a fabricated one. *(Open Q5.)* |

**PM verdict:** real-now via `useProjects` + `useTimesheetsAwaitingApproval`. The only deferred piece is the procurement-approvals count. No new RPC required for the PM dashboard.

### 4.2 Finance — MOSTLY REAL, one deferred (donut)

| KPI / widget | Real-now? | Source |
|---|---|---|
| Total contracted revenue | **REAL** | `data.total_contract_value` (exec RPC) OR `Σ contract_value` over `useProjects` |
| Total project spend | **REAL** | `Σ top_projects.spent` (exec RPC) or `useProjects` |
| Margin / on-hand margin | **REAL** | `data.on_hand_margin`, `data.on_hand_value` (exec RPC) |
| Budget utilization emphasis | **REAL** | the §3.2 BvA list (full portfolio) + per-project utilization `ProgressBar` (`spent/budget`) |
| Top projects by spend | **REAL** | `top_projects` sorted by `spent` (exec RPC) — reuses `DataTable` + `ProgressBar` utilization cell |
| Outstanding invoices | **DEFERRED** | legacy summed `procurements` where status `VendorInvoiced` from mock. Real source = `useProcurements()` filtered by the invoiced status (`Σ value`). This **IS derivable** from `listProcurements` (real). **Decision:** wire it REAL via `useProcurements` (filter invoiced status, sum value). Only defer if the invoiced-status enum value is ambiguous — confirm the status string (Open Q6); default = wire real. |
| Cost distribution **donut** | **DEFERRED** | same per-category gap as §3.3 — no per-category committed/spend breakdown in any current query. **Defer** (placeholder) OR repurpose to the real Procurement-by-status chart (recommend, per §3.3). Do not fabricate `spendByCategory`. |

**Finance verdict:** KPIs + top-projects table are real-now via the exec RPC + `useProcurements`. Only the **cost-distribution donut** is deferred (new per-category aggregate); recommend repurposing to the real status chart.

### 4.3 Engineer — PARTIALLY REAL, charts deferred

| KPI / widget | Real-now? | Source |
|---|---|---|
| Active tasks | **DEFERRED** | there is **no tasks DAL/RPC** in `src/lib/db/` (the legacy `tasks` came entirely from mockData; the real schema's task surface is not exposed). A per-engineer task count needs a **new query + RLS**. **Defer** — omit or "coming soon" tile. |
| Completed tasks | **DEFERRED** | same — no tasks query. |
| Hours this week | **REAL** | `useTimesheets()` (own-user) → current-week timesheet → `Σ entries.hours`. The hooks scope to the signed-in user already. |
| My active tasks table | **DEFERRED** | no tasks query (new RPC + RLS). |
| Weekly hours chart | **REAL** | `useTimesheets()` → current-week entries grouped by day → a small recharts bar (themed `chartTheme.series.primary`, NOT the legacy `#8b5cf6`) OR the on-brand `ProgressBar`-per-day list. Real. |
| My timesheets status (draft/submitted) | **REAL** | `useTimesheets()` → latest sheet `status` → `StatusPill`. |

**Engineer verdict:** the **timesheet/hours** half is real-now via `useTimesheets`. The **tasks** half (active/completed/task-list) is **deferred** — there is no tasks query/RLS in the codebase, so it is a genuine new backend slice (like the project Timesheets tab deferral). **Recommendation:** ship the Engineer dashboard as a **hours-and-assignment-light pane** (hours-this-week tile + weekly-hours chart/list + my-timesheet-status), and render the tasks tiles/table as a single on-brand `ListState` **empty/coming-soon** block ("Task tracking is coming soon") — do NOT keep the mock tasks. Flag the tasks RPC as the follow-up (Open Q7).

### 4.4 Recommended real-now vs deferred split (summary)

| Role | Real-now (this issue) | Deferred placeholder (follow-up backend slice) |
|---|---|---|
| **Executive/Admin** | All 6 KPIs (tile 6 = "Total project spend" per Open Q1) · BvA list · Win-rate card · Projected-margin bars (via `useSalesPipeline`) | Per-category committed donut → render the **real Procurement-by-status chart** instead (recommend) or a coming-soon card |
| **Project Manager** | My-projects count/value/at-risk · BvA (my subset) · project-status list · **timesheets** awaiting approval | **procurement** approvals count |
| **Finance** | Revenue · spend · margin · utilization · top-projects-by-spend · outstanding invoices (via `useProcurements`) | cost-distribution **donut** (repurpose to status chart, recommend) |
| **Engineer** | Hours this week · weekly-hours chart/list · my-timesheet status | **tasks** (active/completed/list) — no tasks query exists; new RPC+RLS |

**Net new backend slices flagged (NOT built here):** (1) portfolio committed-spend-by-category aggregate (Exec/Finance donut); (2) per-PM procurement-approvals count; (3) per-engineer **tasks** query + RLS. Each is a follow-up issue, not part of this re-skin. Everything else is real-now off existing RPCs/DALs.

---

## 5. The charting bug fix (Procurement-by-status)

**Bug.** `pages/ExecutiveDashboard.tsx` lines 463-476 — the "Procurement by Status" `BarChart` renders **every** bar with `fill="#10b981"` (solid green), regardless of status. The "Project Pipeline" chart has the same shape (single `fill="#3b82f6"`). A bar chart whose bars all encode the same color when each bar IS a distinct status is a `color-not-only` / `trend-emphasis` failure (color carries no information) and uses raw hex (token-fidelity failure).

**Fix.** Status-tone each bar via `chartTheme`, using a per-status → token mapping, rendered with recharts `<Cell>` (one `<Cell fill={…}>` per datum, the same pattern the legacy donut already uses at line 337):

```
// status → chartTheme token (NOT raw hex). Map the ProcurementStatus enum values:
//   terminal-good (Paid / Completed)      → chartTheme.series.success
//   in-flight (PO / GR / approved)        → chartTheme.series.primary
//   awaiting / caution (VendorInvoiced…)  → chartTheme.series.warning
//   rejected / cancelled                  → chartTheme.series.destructive
//   neutral / draft / requested           → chartTheme.series.violet (categorical) or chartTheme.categorical[i]
```

- Implement a small `procurementStatusTone(status): keyof typeof chartTheme.series` (or direct token) helper, co-located + unit-tested, that maps each real `ProcurementStatus` enum value to a `chartTheme` token. **The mapping must cover every enum value** (exhaustive `switch` with a `never` default) so a new status can't silently fall back to green. Confirm the exact enum values from `Tables<'procurements'>['status']` (database.types) — do not guess; the helper is enum-driven.
- Render `<Bar dataKey="count">{data.map((d,i) => <Cell key={i} fill={tokenFor(d.status)} />)}</Bar>`.
- Same treatment available for "Project Pipeline" (per `ProjectStatus`) if kept as a chart — but per §3/§4 the dashboard's project visualization is the BvA list, so the pipeline-count bar may be dropped in favor of the status-toned procurement chart in row 2 (§3.3 alternative). If the project-pipeline bar is kept, status-tone it the same way; do not leave it single-fill `#3b82f6`.
- Axis/grid → `chartTheme.axis` / `chartTheme.grid`; tooltip restyled to `card` bg + `border` + `popover` shadow (NOT `rgba(31,41,55,.8)`); legend uses status text labels (`color-not-only`). Add an `aria-label` chart summary (§6).
- **A11y:** because color now carries the status meaning, the chart MUST also expose the status as text — the x-axis labels already name each status, and the per-chart `aria-label` summary (§6) names the top status by count. That satisfies `color-not-only` (color + axis text + aria).

---

## 6. Chart states + shared `ChartFrame` (ui-ux-pro-max §10 Charts & Data)

Every chart/visual card gets the full async cycle via a thin shared wrapper `ChartFrame` (loading / empty / error), so no card ever shows a bare axis frame or a blank chart (`loading-chart`, `empty-data-state`, `error-state-chart`):

- **Loading** (`isPending`): `ListState variant="loading"` (skeleton matching the card body height) — NOT an empty recharts axis (`loading-chart` guideline). KPI tiles use `KPITile loading` (built-in skeleton).
- **Empty** (query ok, zero rows for that card): `ListState variant="empty"` with a card-specific title + guidance ("No procurement activity yet", etc.) and, where relevant, a populating CTA. Never a blank chart (`empty-data-state`).
- **Error** (`isError`): `ListState variant="error"` with cause + `onRetry={refetch}` (`error-state-chart`, `error-recovery`).
- The page-level Exec view keeps its existing top-level `dashboard-loading` / `dashboard-error` / `dashboard-empty` gate (re-skinned off `text-gray-*`/`dark:*`/dashed borders to `ListState` + tokens), AND each chart card additionally handles its own state when it has an independent query (`useSalesPipeline` for the projected-margin bars; `useProcurements`/`useTimesheets` for role panes) — so one slow query doesn't blank the whole pane.

**Chart a11y (ui-ux-pro-max §10 + master §4.4):**
- `screen-reader-summary`: every chart/visual carries an `aria-label` summarizing its key insight (e.g. donut/status chart: "Procurement by status, {n} requests, most in {topStatus}"; projected-margin: "Projected margin {x}% across {n} open stages"; win-rate: announced live). The mockup's donut already models this (`role="img" aria-label="Committed spend by category, total {money}"`).
- `data-table` / table-alternative: the **BvA list IS the table-alternative** for the portfolio (per master §4.4) — it's text+bars, screen-reader friendly by construction. The Top-projects `DataTable` is the table-alternative for any project chart.
- `legend-visible` + `color-not-only` + `pattern-texture`: legends sit beside the chart with dot + **text** label (never color-only); status is dot + text everywhere.
- `tooltip-keyboard` / `focusable-elements`: recharts tooltips are hover-only by default — the **value is also rendered as a direct text label** (`direct-labeling`) on the BvA readouts, donut legend, and projected-margin bars, so no datum is hover-gated for keyboard/SR users. The seg/dual toggles are `role="tablist"`/`aria-selected` and keyboard-reachable (built into `ViewToggle`).
- `animation-optional`: chart entrance animation respects `prefers-reduced-motion` (recharts `isAnimationActive={!prefersReducedMotion}` or disable globally) — data is readable immediately (master §5 anti-slop: reduced-motion honored).
- `contrast-data`: data bars/lines vs background ≥3:1; data text labels ≥4.5:1. The token series (`primary`/`success`/`warning`/`destructive`/`violet`) and the frozen categorical literals already meet this on `card` white (verified in DESIGN.md a11y posture); status **pill** text uses the darkened variants.

---

## 7. All states (taste Rule 5 + ui-ux-pro-max §8/§10) — per widget

| Widget | Loading | Empty | Error | Edge |
|---|---|---|---|---|
| KPI band | `KPITile loading` skeletons (6) | tiles show `—` (em-dash) when a field is 0/absent, never blank | top-level `ListState error` (whole pane) | negative margin/delta → `KPITile negative` (`destructive` value) + `down` delta chip; minus glyph `−` not hyphen |
| BvA list | `ListState loading` (skeleton rows) | `ListState empty` ("No active projects yet") | inherits pane error | utilization >100% → `ProgressBar` fill `destructive`; At-risk → `warn` `StatusPill`; missing field → `—` |
| Win-rate card | `KPITile`-style skeleton on the rate number | "No closed deals in this window" when total=0 (don't show 0% as if real) | `ListState error` + retry on the card | basis/frame toggle preserves selection; value `aria-live` announced; 0 wins → 0.0% only when total>0 |
| Procurement-by-status (status-toned) | `ListState loading` | `ListState empty` ("No procurement activity yet") | `ListState error` + retry | every status toned via `chartTheme`; new enum value → exhaustive helper (no silent green) |
| Projected-margin bars | `ListState loading` | `ListState empty` ("No open pipeline") | `ListState error` + retry (own `useSalesPipeline`) | Won/Lost excluded; bars sorted/ordered by stage |
| Committed donut (if deferred) | n/a — renders coming-soon `ListState empty` | the coming-soon state IS the empty | n/a | flagged Open Q4 |
| PM: timesheets-awaiting | `ListState loading` | "Nothing awaiting approval" | `ListState error` + retry | count badge; procurement half deferred (`—`) |
| Engineer: hours/weekly | `ListState loading` | "No hours logged this week" (+ Log hours CTA → /timesheets) | `ListState error` + retry | tasks block → single coming-soon `ListState empty` |

**Edge — role gate.** While `effectiveRole` is resolving (auth not yet hydrated), render the Exec pane skeleton, not a flash of the wrong role pane. The `switch(effectiveRole)` stays at the component tail (after hooks, per hooks-rules) exactly as the current file does (lines 524-533) — preserve that structure; all hooks called unconditionally at top.

---

## 8. Token migration table (legacy → DESIGN.md token)

Every legacy utility in the current file maps to a named token. Zero raw hex/px survives (master §5 tokens-only).

| Legacy (current file) | DESIGN.md token / utility | Where |
|---|---|---|
| `text-gray-500 dark:text-gray-400` | `text-muted-foreground` | KPI labels, sub-text, table cells |
| `text-gray-900 dark:text-white` | `text-foreground` | values, headings |
| `text-2xl/3xl font-bold` (KPI value) | `KPITile` value (`23px/700 tabular tracking-[-0.02em]`) | all KPI values |
| `text-lg font-semibold` (card title) | `heading` (`20px/700`) or section-title `13.5px/600` per mockup | card heads |
| `bg-blue-50 border-l-4 border-blue-500` etc. (role tiles) | **deleted** — replaced by `KPITile` tones (`blue/green/violet/amber/red/cyan`); **side-stripe `border-l-4` is an impeccable absolute ban** | role panes |
| `text-primary-600` / `bg-primary-600` | `text-primary` / `bg-primary` (the `primary-NNN` ramp is removed, master §1) | win-rate toggle, links |
| chart `fill="#3b82f6"` | `chartTheme.series.primary` | pipeline/BvA bars |
| chart `fill="#10b981"` (the bug) | per-status `chartTheme` token via `<Cell>` (§5) | procurement chart |
| chart `fill="#8b5cf6"` | `chartTheme.series.primary` (Engineer hours) — NOT violet for an action-adjacent metric | weekly hours |
| `COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444']` | `chartTheme.categorical[]` (frozen) | donut/categorical |
| tooltip `rgba(31,41,55,.8)` | `card` bg + `border` + `popover` shadow tokens | all chart tooltips |
| `bg-gray-200 dark:bg-gray-600` progress track | `ProgressBar` (track `secondary`, fill threshold-colored) | top-projects progress |
| `rounded-xl` skeleton | `rounded-lg` (10px) per DESIGN.md scale (no `xl`) | loading skeleton |
| dashed `border-red-200`/`border-gray-200` empty/error | `ListState` empty/error (tokenized) | pane states |
| `divide-gray-200 dark:divide-gray-700` table | `DataTable` (`border/70` dividers) | all tables |

Colors consumed: `primary` (links/active/series), `success`/`warning`/`destructive` (deltas/series/status), `violet` + frozen `categorical` (non-interactive series/dots), `secondary` (tracks/lost), `muted-foreground` (labels/sub), `border` (grid/dividers), `card` (surfaces). Type: `KPITile` value class (`23px/700`), `heading`, `label`, `overline`, `body`, `mono` (none expected here — dashboard has no IDs), `tnum` mandatory on every figure. Radius `md`/`lg`/`full`. **One Blue Rule** (blue only on interactive: toggles/links/focus, not as a default series unless it IS the primary series) + **Tinted-Status Rule** + **Flat-By-Default** (cards get `border`, hover `state lift` only) enforced.

---

## 9. TDD task breakdown (2-5 min each, red→green→refactor)

Each task: write the failing test first, then the minimum code. Tests assert behavior/tokens, not snapshots. AC-ids in titles (CLAUDE.md traceability). Preserve AC-701 + AC-1117 throughout.

**T1 — Delete mockData, lift role panes to a switch shell (refactor-safe).**
Test: `ExecutiveDashboard` renders without importing `data/mockData` (grep guard test: assert no `mockData`/`MOCK_ENGINEER_ID`/`MOCK_PM_ID` symbols; a unit test that the four role branches render their respective testid roots). Remove the mock imports + constants. (No behavior change yet — panes still render, fed by real hooks stubbed in tests.)

**T2 — Re-skin KPI band to `KPITile` (Exec). [AC-701]**
Test (`ExecutiveDashboard.test.tsx`, preserve `AC-701` title): with the existing mocked RPC payload, `kpi-active-projects` = active count, `kpi-total-contract-value` = `$8,000,000`, on-hand/pipeline/projected tiles render their values; assert no `text-gray-*`/`dark:` classes on the band; assert `tabular` on values. Replace the six `KpiCard`s with `KPITile` (tones/icons per §3.1). Keep the existing `data-testid`s (AC-701 depends on them).

**T3 — Dual-lens projected-margin tile. [AC-1117]**
Test: toggling the tile's On-hand/Weighted seg switches the value between `on_hand_margin` and `pipeline_projected_margin`; `role="tablist"`/`aria-selected` present. Wire `KPITile dual` to local lens state off the loaded payload.

**T4 — Win-rate card re-skin (preserve logic). [AC-1117]**
Test: preserve `kpi-win-rate`, `win-rate-toggle-count/value`, `win-rate-period` testids; count→value toggle changes the rate; period change re-queries (assert `useWinRate` called with the new range key); assert `aria-live` on the rate, `role="group"` on the seg, NO `bg-primary-600`/`dark:`. Re-skin chrome to §3.2; keep `buildWinRateRange`/`mode`/`period` verbatim.

**T5 — `procurementStatusTone` helper (the bug fix core). [new AC — chart status-tone]**
Test (unit): every `ProcurementStatus` enum value maps to a defined `chartTheme.series.*` token; exhaustive (a `never` default throws/asserts at type-check). Implement the enum-driven mapping (§5).

**T6 — Status-toned procurement chart. [new AC]**
Test (RTL): with a payload of 3 distinct statuses, the chart renders 3 `<Cell>`s with **distinct** fills (not all `success`); axis labels name each status; chart has an `aria-label` summary naming the top status; no raw hex in the rendered fills (assert via the helper). Replace the single-fill `<Bar>` with `<Cell>`-per-datum; restyle axes/tooltip to `chartTheme`.

**T7 — BvA list (Exec, real). **
Test: renders one row per `top_projects` entry with `{spent}/{contract}` tabular + threshold-colored `ProgressBar`; At-risk row shows `warn` `StatusPill`; `aria-label="Budget vs actual by project"`; per-row accessible `{name}: {pct}%`. Build `BvACard` off `data.top_projects` (no committed bar until field exists, §3.2).

**T8 — Projected-margin bars (real, via `useSalesPipeline`). **
Test: headline % = `pipeline_projected_margin`; one bar per open stage from `salesPipeline.stages` (Won/Lost excluded) with `weighted_value` label; own loading/empty/error via `ChartFrame`. Wire `useSalesPipeline`.

**T9 — `ChartFrame` wrapper + per-card states. **
Test: `ChartFrame` renders `ListState` loading/empty/error per its props; chart cards show skeleton (not empty axis) while pending, empty-state when zero rows, error+retry on error. Wrap each chart card.

**T10 — Committed-spend card decision (deferred → real status chart OR coming-soon). **
Test: per Open Q4 default — renders the real Procurement-by-status chart (reuse T6) in row 2; OR if owner picks defer, renders `ListState empty` "coming soon" (no fabricated category data; grep guard: no `spendByCategory`/`* 0.4` literals).

**T11 — PM dashboard (real). **
Test: with mocked `useProjects` (2 mine, 1 other) + `useTimesheetsAwaitingApproval` (2), renders my-projects count=2, my contract value, at-risk count, BvA(my subset), status list, timesheets-awaiting=2; procurement-approvals shown as `—`/coming-soon (not summed). No `mockData`.

**T12 — Finance dashboard (real). **
Test: with mocked exec payload + `useProcurements`, renders revenue/spend/margin/utilization tiles, top-projects-by-spend `DataTable`, outstanding-invoices = `Σ value` of invoiced-status procurements; cost-distribution card = real status chart or coming-soon (no `* 0.4` fabrication).

**T13 — Engineer dashboard (real hours + deferred tasks). **
Test: with mocked `useTimesheets` (current-week entries), renders hours-this-week tile = `Σ hours`, weekly-hours chart/list themed `chartTheme.series.primary` (not `#8b5cf6`), my-timesheet status pill; tasks tiles/table → single `ListState empty` "Task tracking is coming soon" (no `tasks` import).

**T14 — Responsive KPI reflow + a11y sweep. **
Test (where feasible in jsdom: class assertions; visual reflow verified in `/design-review`): KPI band has the `grid-cols-1 sm:grid-cols-2 min-[920px]:grid-cols-3 min-[1180px]:grid-cols-6` reflow classes; every chart card has an `aria-label`; seg/dual toggles `role="tablist"`+`aria-selected`; no body horizontal scroll; `prefers-reduced-motion` disables chart animation.

**T15 — e2e regression (Playwright — AC-701 + AC-1117 must stay green).**
The existing `e2e/AC-701-dashboard-smoke.spec.ts` asserts real org-scoped KPI values render; `e2e/AC-1117-dashboard-pipeline.spec.ts` asserts dual-lens KPIs + weighted pipeline. **Do NOT change the e2e to chase the UI** — preserve the `data-testid`s the e2e depends on (`kpi-active-projects`, `kpi-total-contract-value`, `kpi-win-rate`, the dual-lens tile, the pipeline weighted ids). Run both green after the re-skin.

**Traceability (owning layer per ADR-0010):**

| AC | Owning layer | Test |
|---|---|---|
| AC-701 (exec KPI smoke) | e2e (real RPC) + Vitest fast mirror | `e2e/AC-701-…`, `ExecutiveDashboard.test.tsx` T2 |
| AC-1117 (dual-lens + win-rate + weighted pipeline) | e2e + Vitest | `e2e/AC-1117-…`, T3/T4 |
| new: procurement chart status-tone | Unit (helper) + Vitest (render) | T5/T6 |
| new: per-role real-data sourcing | Vitest (mocked hooks) | T11/T12/T13 |
| new: chart states + a11y | Vitest | T9/T14 |

---

## 10. Acceptance checklist (this PR inherits master §5 + folds taste/ui-ux-pro-max)

- [ ] **AC-701 e2e green** (real org-scoped KPI values, testids preserved).
- [ ] **AC-1117 e2e green** (dual-lens + win-rate basis/frame + weighted pipeline, testids preserved).
- [ ] **No `data/mockData` import** survives in `ExecutiveDashboard.tsx`; no fabricated figures anywhere (grep guard: no `weeklyHours`, `spendByCategory`, `pendingTimesheets`, `* 0.4`, `MOCK_*`).
- [ ] **Charting bug fixed:** procurement-by-status bars are status-toned via `chartTheme` (`<Cell>`-per-datum, exhaustive enum helper); no single-fill `#10b981`; project chart not single-fill either.
- [ ] **States (taste Rule 5):** every KPI/chart/list widget has loading skeleton (not spinner, not empty axis), composed empty (with CTA where relevant), and inline error+retry — via `KPITile loading` / `ListState` / `ChartFrame`.
- [ ] **Chart a11y (ui-ux-pro-max §10):** every chart has an `aria-label` insight summary; legends are dot+text (`color-not-only`); values direct-labeled (not hover-gated); table-alternative present (BvA list / DataTable); `prefers-reduced-motion` disables animation; data contrast ≥3:1, label text ≥4.5:1.
- [ ] **WCAG-AA (master §5):** `:focus-visible` ring on every toggle; seg/dual `role="tablist"`+`aria-selected`; win-rate value `aria-live`; status pills use darkened text variants; KPI `?` help keyboard-focusable (built into `KPITile`).
- [ ] **Responsive:** KPI band reflows 6→3→2→1 at 1180/920/560; chart rows stack; no body horizontal scroll.
- [ ] **Anti-slop (taste §7 / impeccable bans):** SVG icons only; no emoji; `tnum` on every figure; one `primary` blue (charts use it as a series only where it IS the primary metric, ≤10% interactive); borders-not-shadows; minus `−` for negatives; **no `border-l-4` side-stripe** (the legacy role tiles violated this — deleted); no `rounded-xl` (off-scale).
- [ ] **Tokens-only:** zero raw hex/px; every color names a token or `chartTheme`; the only literals are the frozen `chartTheme.categorical[]` (sanctioned, master §5).
- [ ] **Behavior preserved:** `useDashboard`/`useWinRate`/`useSalesPipeline` hooks, win-rate range logic, the `effectiveRole` switch (hooks-rules order), and all RPC/RLS contracts unchanged — presentation swap only.
- [ ] `npm run typecheck` + ESLint (`--max-warnings=0`) clean; ≥80% line coverage on changed code; `/design-review` passed before merge.

---

## 11. Open questions (for owner / taste gate)

1. **Committed-spend KPI (tile 6) + committed bar (BvA).** The exec RPC has `spent`, not `committed`. **Recommend:** relabel tile 6 to "Total project spend" (`Σspent`, real now) and drop the committed bar from BvA (Actual/Contract only) until a portfolio `committed` aggregate is added. Confirm relabel vs deferred-placeholder.
2. **KPI delta chips.** The mockup shows period-over-period deltas (`+2.1pt`); the RPC exposes no comparison/trend. **Recommend:** omit delta chips (keep the `vs` foot line) until a trend query exists. Do not fabricate deltas. Confirm.
3. **Win-rate frame labels.** Mockup shows 90d / 12mo / All; live code has All / YTD / Last-quarter / Trailing-12mo (RPC-backed, AC-1117). **Recommend:** keep the four real options, render with live labels. Confirm we don't drop YTD to match the mockup's three.
4. **Row-2 left card (Committed donut).** Per-category committed breakdown needs a **new backend aggregate** (no current query returns it). **Recommend:** repurpose this card to the **real Procurement-by-status chart** (status-toned, §5) rather than ship an empty/coming-soon card or fabricate categories. Confirm: real status chart vs coming-soon placeholder.
5. **PM procurement-approvals count.** Timesheet approvals are real (`useTimesheetsAwaitingApproval`); a per-PM **procurement** approvals count has no query. **Recommend:** show timesheets-awaiting real, defer the procurement half (`—`/coming-soon), do not sum real+fabricated. Confirm.
6. **Finance "Outstanding invoices" status value.** Derivable from `useProcurements` filtered by the invoiced status — confirm the exact `ProcurementStatus` enum string for "vendor invoiced / awaiting payment" so the filter is correct (don't guess the enum).
7. **Engineer tasks.** There is **no tasks DAL/RPC/RLS** in the codebase (legacy tasks were 100% mock). Active/completed-tasks tiles + task list are a genuine new backend slice. **Recommend:** ship Engineer as hours-only (real via `useTimesheets`) + a single "Task tracking coming soon" `ListState`. Confirm tasks is a separate follow-up issue.
8. **Page-head global win-rate window control.** The mockup duplicates the win-rate window in the page head and the card. **Recommend:** keep the card-level control as the single source (One-Primary-Action), drop the page-head one. Confirm, or wire both to one shared `period` state.

> **Net new backend slices this issue flags (NOT built here):** (1) committed-spend-by-category portfolio aggregate; (2) per-PM procurement-approvals count; (3) per-engineer tasks query + RLS. Each is a follow-up issue gated on owner sign-off, exactly like the deferred project Timesheets tab.
