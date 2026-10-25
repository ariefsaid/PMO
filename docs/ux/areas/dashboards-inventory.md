# Dashboard inventory and builder evidence

Current-code baseline: `123d2ec9`. All routes below are role variants of `/` selected in `pmo-portal/pages/ExecutiveDashboard.tsx`; Engineer is included in this area despite its later area-map order. `FinanceDashboard.tsx`, `PMDashboard.tsx`, `EngineerDashboard.tsx` and `MobileExecutiveDashboard.tsx` live in `pmo-portal/src/components/dashboard/`, not `pages/`. This inventory describes current code, not approval of its composition. No live client data was read.

## Source and language conventions

`pmo-portal/src/lib/i18n/index.ts` decides namespace loading: default/fallback namespace `common`, with feature namespace `dashboard`. `useTranslation('dashboard')` resolves unqualified keys there then falls back to common; `dashboard:finance.*`, `dashboard:pmRow.*`, `dashboard:risk.*`, `dashboard:spend.*` explicitly select it. `useTranslation()` uses common. EN/ID files are `pmo-portal/public/locales/{en,id}/{common,dashboard}.json`. The exact key → both catalogue values index below covers every static translation call in the inventoried components. Missing locale key falls back to English catalogue/source text, not proof of L-02 compliance. New composition labels require paired EN/ID copy; preserve business meaning rather than historical prose.

Roles: E = Executive and Admin's default body, F = Finance, P = Project Manager, G = Engineer. Role preview chooses the body through effective role; action gates use existing real-role predicates. Preserve all permissions and feature gates. Human record names/statuses are data, not translation keys; status labels come from `useProjectStatusLabel` / `useProcurementStatusLabel`, backed by the localized status registry. Do not reproduce client names or figures in fixtures or docs.

## Current page blocks, in render order

| Page / position | Block and carried fact/action | Who sees it | EN/ID label source (key families; exact index below) |
|---|---|---|---|
| Executive 0 | Pending: six KPI skeletons only; query error: ListState with Retry; no project/procurement evidence: one No data yet state. These return before page heading. | E, either width | `dashboard.error.*`, `dashboard.empty.*`, `dashboard.kpiBand.label` via dashboard namespace |
| Executive desktop 1 | Heading/subtitle, Board pack doorway to `/reports`; feature-off button is disabled with tooltip/intent reporting. | E desktop; reports capability controls action | `dashboard.title`, `dashboard.subtitle.desktop`; BoardPackAction uses common `dashboard.boardPack.*` |
| 2 | At-risk project link (positive count), nothing at known zero, or unchecked-risk note; AwaitingApprovalTile combining eligible purchase decisions and timesheet weeks, omitted at settled zero. | E | dashboard `dashboard.atRisk.*`, explicit `risk.uncheckedNote`; common `dashboard.kpi.awaitingApproval.*` |
| 3a | Contract value on hand, one value per currency when provided; remainder after known Actual, margin on billed work, mapping/coverage details; permitted accounting-mapping link. | E | dashboard/common fallback `uxs03.contractValueOnHand`, `contractRemaining`, `realizedMargin*`, `coverage*`, `openAccountingMap`; common metric help |
| 3b | Pipeline weighted value with gross subvalue, help and `/sales` link. | E | dashboard/common `dashboard.kpi.pipelineWeighted.*` |
| 3c | Pipeline forecast-margin percentage and probability-weighted basis/help, only when non-null. | E | dashboard/common `dashboard.kpi.pipelineMargin.*` |
| 3d | Active contract value + active-project count, help and `/projects?filter=Ongoing`. | E | `uxs03.activeContractValue`, explicit `dashboard:kpi.activeProjectsCount`, `dashboard.kpi.totalContractValue.*` |
| 3e | Recorded spending/Partial + project coverage, help and `/projects?filter=Ongoing`. | E | `dashboard.kpi.totalSpend.*`, explicit `spend.partial`, `uxs03.coverage` |
| 4 | StillToInvoiceCard: currency totals, tax basis/count; incomplete count and linked evidence; work-order rows with project/PO, age since closure, exact remaining amount. | E if `salesInvoice.view` | common `dashboard.stillToInvoice.*`, shared TaxBasisLabel catalogue |
| 5 left | Spending vs contract scope, BvACard project links, risk, Actual/contract figures and comparable spending bars; empty delivery state. | E | `uxs03.spendingContract`, `deliveryChartScope`, `deliveryChartEmpty`; BvA common keys |
| 5 right | WinRateCard: basis toggle, four periods, rate/bar or per-currency prose, shared legend, declined count, recorded-outcomes qualification; empty/error/retry. | E | common `dashboard.winRate.*`, `uxs03.recordedOutcomesOnly` |
| 6 left | PMO purchasing requests scope/count chart, empty state, status drill links to `/procurement?status=…`. | E | dashboard/common `uxs03.pmoPurchasing*`, `dashboard.chart.procStatus.*`, `uxs19.dashboardEmpty`; localized status hook |
| 6 right | Pipeline margin/weighted heading; ProjectedMarginBars headline + open-stage weighted-value links; pipeline error/loading/empty or mixed-currency unavailable text. | E | `dashboard.chart.pipelineMargin.*`, `dashboard.kpi.pipelineWeighted.label`, `uxs03.mixedCurrencyTotalUnavailable`; common `dashboard.projectedMargin.*` |
| Executive phone 1 | Mobile heading/subtitle then quiet Board pack on its own end-aligned row. | E <768px | `dashboard.title`, `dashboard.subtitle.mobile`; common `dashboard.boardPack.*` |
| 2 | Needs attention overline; risk count/unknown + active-project context, risk link when positive; one spending drill cell with Partial/project/category coverage and Breakdown link. | E phone | dashboard/common `dashboard.mobile.*`, `risk.uncheckedNote`, `dashboard.kpi.totalSpend.label`, `spend.partial`, `uxs03.coverage*` |
| 3 | Approvals band with combined count/unknown and Review; omitted if known zero. | E phone | dashboard/common `dashboard.mobile.approvals*`, `awaitingApproval`, `review` |
| 4 | Contract book: Contracted revenue (on-hand values per currency, remainder and billed-work margin) then Total contract value with active-project context/help. Labels differ from desktop in current source. | E phone | `dashboard.mobile.contractBook`, `uxs03.contractedRevenue`, `contractRemaining`, `realizedMargin*`, `dashboard.kpi.totalContractValue.*` |
| 5 | Same chartsSection as desktop: Still to invoice → Spending vs contract → Win rate → PMO requests → Pipeline margin/weighted bars, stacked. Desktop's separate pipeline weighted/forecast KPI tiles are absent in this branch. | E phone | Same component sources as desktop 4–6 |
| Finance 0/1 | Dashboard query error gives heading + Retry only; otherwise heading/subtitle. | F | dashboard/common `uxs03.financeDashboard*`, explicit `finance.dashboardError` |
| 2 | Purchase requests awaiting your decision, procurement-only AwaitingApprovalTile; no timesheets. | F | explicit dashboard `finance.awaiting`; common approval keys |
| 3a–d | Contract value in progress (active projects link); recorded spending/Partial/coverage (same link); margin-to-date amount with remaining and billed-work-margin subline (no drill); vendor payables from Vendor Invoiced PMO requests (filtered Procurement link, mixed-currency total unknown). | F | explicit `finance.contractValue*`, `recordedSpending`, `spending*`, `margin*`, `payables*`; `uxs03.contractRemaining`, `realizedMargin*`, `coverage*` |
| 4 | StillToInvoiceCard, identical feature/data contract to Executive. | F with revenue view | common `dashboard.stillToInvoice.*` |
| 5 | Ready to pay: Vendor Invoiced requests only; Request/title+code → Project → Value → Invoiced age. Whole row opens `/procurement/:id`. Input order retained; only Value declares a sort key. Empty/loading/error/retry. | F | explicit dashboard `finance.request`, `value`, `invoiced*`, `days*`, `openRequest`, empty/error; `uxs03.financeReadyToPay`, `financeProjectColumn` |
| 6 | Budget review, portfolio-wide ranked data; top five after selected sort, default variance descending, unknowns last with ID tie. Project (+budget link/risk) → Active budget → Actual (source/coverage/as-of help) → Variance → Utilization. Error Retry independent of dashboard. | F | `uxs03.financeBudgetReviewTitle`, `activeBudget`, `actual*`, `variance`, `utilization`, `activeBudgetReviewEmpty*`; explicit `finance.budgetReviewLoadError` |
| 7a | Ledger Actuals snapshot: provenance + Project → Account → Cost center → Fiscal year → Net. Null Net is dash with reason; project link or unattributed. Pending/error/empty. | F; mounted with default showActuals=true | AccountingSnapshotsSection dashboard `finance.actualsTitle`, `account`, `costCenter`, `fiscalYear`, `net*`, `project*`, `unattributed`; `dashboard.actualsSnapshotEmpty`, `snapshots.*` |
| 7b | Vendor payables (AP): provenance + one report-date/ageing-basis line, Party → Current → 0–30 → 31–60 → 61–90 → 90+ → Total outstanding. Null money/currency is unavailable. | F; default showApAging=true | explicit dashboard `finance.apTitle`, `party`, `current`, `totalOutstanding`, `apError`; dashboard `dashboard.uxs36*`, `agingSnapshotEmpty`, `snapshots.guidance` |
| 7c | Customer collections (AR), same aging columns/provenance; mapped customer opens `/companies/:id#collections`, unmapped party plain text. | F | dashboard `dashboard.uxs36CustomerCollectionsTitle`; explicit `finance.arError`, same aging labels |
| 8 | PMO purchasing request count chart from all returned procurements; no hrefFor (unlike Executive). Error/loading/empty. | F | `uxs03.pmoPurchasing*`, `dashboard.chart.procStatus.*`; error title currently literal English “Couldn't load procurement”; region “Finance ledger” also literal English |
| PM 1 | My Dashboard heading/subtitle. | P | dashboard/common `dashboard.pm.title`, `subtitle` |
| 2 | Combined approval tile; unchecked-risk note only when settled, risk uncheckable and known at-risk count zero. | P | common approval keys; explicit dashboard `risk.uncheckedNote` |
| 3a–c | My projects/count and My contract value (both My Projects link); At risk/count + >90% budget usage/risk-filter link when checkable/positive/loading/error. Mixed currency total unknown. | P | dashboard/common `dashboard.pm.myProjects`, `contractValue`, `atRisk`, `budgetUsage`, `open*`, help; explicit `pm.myProjectsHelp` |
| 4 left | Spending vs contract over all assigned delivery projects; own loading/error/empty and BvACard. | P | `uxs03.spendingContract`; `dashboard.pm.loadError`; explicit `pm.noProjects*` |
| 4 right | Project Status with Margin to date heading; known risks first, stable original secondary order. Each row: project link/full title → risk badge → optional delivery chip → localized status → labeled margin %. Unknown margin currently prose. Separate loading/error/empty. | P | `dashboard.pm.statusTitle`, `atRisk`, `nothingToShow`; `uxs03.marginToDate`, `notAvailableYet`; explicit dashboard `pmRow.delivery`, `margin`, `marginAria` |
| Engineer 1 | My Dashboard/subtitle; primary Log this week's hours → `/timesheets`, available through loading/error. | G | common `dashboard.engineer.title`, `subtitle`, `logHours` |
| 2a–b | Hours this week total + week-of from latest returned sheet, and Timesheet status (or None this period), both `/timesheets` links. KPI props use pending but not error. | G | common `dashboard.engineer.hoursThisWeek`, `weekOf`, `timesheetStatus`, `noneThisPeriod`, `openTimesheets*`, help; common `timesheets.status.*` |
| 3 left | Hours This Week: Sun–Sat positive day totals/bars, current max scale; empty Log hours action, query error Retry, loading. | G | common `dashboard.engineer.weeklyHoursCardTitle`, `day.*`, `dayHours`, `hoursByDay`, `noHours*`, `logHoursShort`, `loadError` |
| 3 right | This week by project: summed hours per project, descending hours, HoursBar label/code/value; independent representation of same latest sheet. Empty/loading/error. | G | common `dashboard.engineer.byProject`, `projectBreakdownSub`, `noHours`, `loadError`; missing project label in derive helper currently literal “Unknown” |
| 4 | Recent entries: flatten all returned sheets, newest entry_date first, latest eight; date → project/code/note → hours; no-note/unknown-project and empty labels. Loading/error Retry. | G | common `dashboard.engineer.recentEntries`, `recentError`, `noNote`, `unknownProject`, `entriesEmptySub`, `noHours` |

## Shared component facts

| Component | Current contract / relevance |
|---|---|
| `pmo-portal/src/components/ui/KPITile.tsx` | Caller supplies fact/label; icon+label+help → optional subtitle → loading/error/value (FigureContent exact/unavailable support) → optional lens toggle or delta/vs. Link body and help are independent focus targets. Optional ctaLabel, dual and error support; no page currently passes a dual lens here. Never put an interactive mapping link inside an already-linked figure. |
| `pmo-portal/src/components/dashboard/WinRateCard.tsx` | Default count/all; period key includes local from/to dates. `q` computes rolling three months despite Last quarter label: retain business-window semantics in this docs task, do not silently switch to calendar quarter. Value currency rows currently take prose-only branch; count/legacy takes bar branch. Null rate and declined outcomes have explicit contracts. |
| `pmo-portal/src/components/dashboard/BvACard.tsx` | Input order retained; project link + labeled risk + exact Actual/contract; only complete, same-currency, positive-contract comparison draws a progress bar. Incomplete category coverage is repeated per row. It does not draw an active-budget comparison; budget only informs risk. |
| `pmo-portal/src/components/dashboard/StillToInvoiceCard.tsx` | Query mounts only with revenue-view permission. Totals are server-wide per currency, not sum of displayed subset; not-totalled evidence excluded from totals. Canonical Work orders deep link includes `?wo=…`. Keep tax basis, incomplete remedy, total scope and all fields when regrouping. |
| `pmo-portal/src/components/dashboard/ProjectedMarginBars.tsx` | Optional percentage headline, open-stage weighted money bars normalized by max, terminal stages excluded; each stage links to `/sales?status=…`. Current visible bar money is compact with exact title. Apply S-05 visible exact amounts when recomposed. |
| `pmo-portal/src/components/ui/Funnel.tsx` | NOT mounted by these role dashboards (searched ExecutiveDashboard and dashboard component directory; HydratedPrimitive is a separate consumer). Supports stage name/probability/value/weighted/bar, selection keyboard/aria-pressed and contained horizontal scrolling. Preserve its other consumers; do not add a duplicate pipeline-stage summary here. |
| `pmo-portal/src/components/dashboard/AccountingSnapshotsSection.tsx` | Actuals → AP → AR, each with independent loading/error/empty and provenance. Actuals/AP flags default true. Snapshot rows display source values, not recomputed buckets. Dates/basis are per snapshot, not global; missing currency cannot inherit org currency for aging. Shared aging width identity is distinct from actuals identity. |
| `pmo-portal/src/components/dashboard/StatusBarChart.tsx` | Categorical count bars with text/count labels, reduced-motion and narrow axes; only Executive supplies hrefFor. Maintain role-specific interaction reachability. |

## Design method applied

`/shape`: one discovery round from PRODUCT and the role routes establishes operational daily prioritization, real contracts/requests/weeks as evidence, mixed novice/expert users (builder assumption), and first useful action without leaving scope. The resulting per-role jobs/questions are in the short brief; no new visual identity or product feature is proposed. `/critique`: source-based hierarchy/IA/state assessment; `/layout`: a full-width decision path with row lists on phone; `/distill`: each aggregate/figure/caveat has one home; `/onboard`: first value is a real project, billable work order, assigned delivery project or logged week, not a tutorial.

First-run composition: Executive with no portfolio shows what projects will reveal and a permitted Projects/create doorway; Finance with no work shows billing/payment clear rows plus one accounting-availability remedy; PM without assignments sees one assignment explanation and Projects doorway; Engineer sees the current calendar week's absence and the existing Log hours action. Returning users with settled queues get compact clear status, never onboarding again. Filtered/period-empty views keep controls and Clear/widen action. Permission-ineligible features are omitted; do not suggest an action the role cannot use. A first-step primary replaces, never competes with, the normal primary when appropriate.

Taste hierarchy/repetition/truncated-identity/anti-slop lenses: lead with decision evidence, make peer rows repeat predictably, wrap recognizable project/party names before shortening money, remove decorative icon-tile walls, avoid orphan grid cells and fake trend/sparkline decoration. Keep tokens authoritative over skill palette/type recipes.

UI UX Pro Max searches executed for dashboard, KPI tile, bar chart, comparison chart, segmented control and sparkline. Dashboard/KPI retries matched Data-Dense Dashboard; bar and narrowed comparison matched Compare Categories; trend retry matched Trend Over Time. Adopt direct labels, readable alignment, keyboard access and explicit loading. Reject radar/maps returned by broad comparison query as irrelevant. Segmented-control retry had no verified pattern match: phone select decision comes from UX-STANDARD and source constraints. No historical time series is present for these KPIs: do not invent sparklines. Search palette/density suggestions do not override ADR-0068.

## Builder evidence

Use synthetic, reproducible fixtures, not production captures. All following role variants use `/`; preserve URL params on changes and prove return pairs to destination links. Every named state gets 390×844 and 1440×900, EN/ID, light/dark captures; combine independent states into fixtures rather than generating arbitrary record permutations. No full unrelated-route screenshot sweep.

| Role | Decision-relevant fixture / transition set |
|---|---|
| Executive | Rich portfolio with risks and pending decisions; same fixture known-clear queues; partial Actual/no active budgets and mixed currencies; entirely empty portfolio; dashboard loading/error Retry plus independent pipeline/approval/work-order errors. Open measurement and purchasing disclosures and return from risk, sales stage, work order and Board pack. |
| Executive Win rate | One-currency and two-currency value sets; before/after both bases × all four periods. Include measured single-outcome, zero-outcomes, declined-only and null-rate/no-recorded-loss cases; loading/error/retry inside unchanged plot frame. Verify phone select exposes all four choices. Capture keyboard focus/selected state without colour dependence. |
| Admin | Same composition; first-run and missing-accounting evidence with authorized remedy; contrast with Executive remedy rather than repeating all data permutations. |
| Finance | Rich unbilled, payable, overdue collection and budget data; settled queues; partial/null Actual/Net/currency; no accounting snapshots and all-empty queues; independent accounting/budget/procurement loading/error Retry; open financial/purchasing and row disclosures. Return pairs from invoiceable work order, payment case, budget and customer collections. |
| PM | Assigned delivery projects with known risk, missing risk/margin, long localized names, delivery present/absent, one/two currencies; no assignments; loading/error and approval failure; open comparison evidence, sort, project/budget/risk return. |
| Engineer | Calendar-current draft/submitted/approved/rejected week; older-most-recent sheet with no current-week sheet; no entries/known zero; loading/error Retry; long project/note; Log hours return. Daily and project breakdowns plus latest-eight ordering. |

Machine and owner checks: brief's rule IDs, source detector count, ux-proof/axe, one h1, visible full money/currency, contained plot/table, 44px targets, URL restoration, first-screen answer, readable EN/ID and both themes. Source scanning is not rendered proof. Expandable evidence preserves keyboard focus, name, state and all data fields. The proposed per-currency win rows preserve RPC null meaning; never change financial or date calculations to make a screenshot nicer.

## Test disposition

Paths below are relative to the repo root. Mixed suites are split at assertion level: delete composition locks, keep semantic oracles. No test changes in this docs task. A formerly duplicated fact may move; update selectors/steps to its new home, never weaken the outcome. Existing overflow/readability assertions express a11y, not pixel styling: keep those goals.

| Existing path(s) | Delete on recompose | Keep / adapt to new homes |
|---|---|---|
| `pmo-portal/pages/ExecutiveDashboard.test.tsx` | KPI breakpoint class-string block; tone-class assertions and exact tile count/order locks | RPC facts, error/retry/empty, help and drill destinations, correct scope and monetary truth |
| `pmo-portal/pages/__tests__/ExecutiveDashboard.mobile.test.tsx` | CW-3b icon-size/type-scale DOM queries; AC-MOBILE block-order locks | Single accessible representation, risk/approval semantics, per-currency facts, canonical links and role selection |
| `pmo-portal/src/components/dashboard/FinanceDashboard.test.tsx`; `PMDashboard.test.tsx`; `EngineerDashboard.test.tsx` (same directory) | “KPI grid — monotonic arbitrary breakpoints” blocks; PM AC-1238-002 min-width/flex-class assertions and AC-1238-003 outline-class query | Assigned delivery filtering, real sum/status/unknowns, Engineer Log hours reachability, scoped links, labeled margin/delivery, risk-first order |
| `pmo-portal/src/components/dashboard/__tests__/FinanceDashboard.w5b.test.tsx` | J4 class/style checks, N17 title-placement “portfolio-wide” wording lock, colour-class assertions | Vendor Invoiced filtering/age fallback, variance truth and portfolio ranking/nulls last, sortable headers, budget links, error retry. New plain scope preserves top-five meaning. |
| `pmo-portal/src/components/dashboard/__tests__/StillToInvoiceCard.polish.test.tsx` | UIP-010 computed padding limit and no-SVG assertion | Clear vs loading/error/incomplete, exact currency totals/tax basis, canonical Work orders links |
| `pmo-portal/src/components/dashboard/__tests__/PMDashboard.deliveryMiniBar.test.tsx` | `h-1.5`/`w-12` DOM query | Delivery percentage and accessible label/status |
| `pmo-portal/src/components/dashboard/__tests__/BvACard.d2.test.tsx`; `BvACard.link.test.tsx` (same directory) | Trailing-chevron/test-id absence locks | Project links, risk text, no ambiguous row/child navigation |
| `pmo-portal/src/components/dashboard/__tests__/StatusBarChart.mobileAxis.test.tsx`; `StatusBarChart.compactYAxis.test.tsx` (same directory) | Fixed axis height/width, tick-angle/visibility prop locks if chart is recomposed | Readable category/count information, accessible labels, keyboard drill-through; use rendered containment/readability checks for geometry |
| `pmo-portal/src/components/dashboard/WinRateCard.test.tsx` | Prose-only branch shape expectations (`kpi-win-rate` absence in value mode) | AC-1117 defaults/local range keys, AC-1106 currency isolation and null-loss semantics, AC-DEC-002 declined denominator, percentages, locale and live announcements. Replace currency-prefixed-percentage text assertions with separate currency-heading and percent-value oracles: deliberate #1380 copy correction, not deleting calculation tests. Group/select semantics adapt to phone control. |
| `pmo-portal/src/components/dashboard/ProjectedMarginBars.test.tsx`; `BvACard.test.tsx` (same directory) | Only exact presentation-class/order locks if retained blocks change | Open-stage exclusion, real weighted values, null completeness/currency guards, exact money and meaningful labels |
| `pmo-portal/pages/__tests__/Dashboard.drillthrough.test.tsx`; `ExecutiveDashboard.honesty.test.tsx`; `ExecutiveDashboard.atRiskLink.test.tsx`; `ExecutiveDashboard.approvalError.test.tsx`; `ExecutiveDashboard.bahasa.test.tsx` (same directory) | None of their behaviour goals | Drill destinations, no false risk/zero, actual coverage, unknown approvals, role and Bahasa labels; rebind moved facts/disclosures |
| `pmo-portal/src/components/dashboard/__tests__/WinRateCard.error.test.tsx`; `FinanceDashboard.budgetError.test.tsx`; `FinanceDashboard.actualAlignment.test.tsx`; `PMDashboard.kpiError.test.tsx`; `PMDashboard.shortName.test.tsx`; `MobileExecutiveDashboard.locale.test.tsx`; `StillToInvoiceCard.test.tsx`; `ProjectedMarginBars.d1.test.tsx` (same directory) | Do not preserve old DOM placement as an oracle | Retry, unavailable not empty/zero, correct currency/basis, recognizable short/full names, translation, permission, stage/project and work-order links |
| `pmo-portal/src/components/dashboard/AccountingSnapshotsSection.test.tsx`; `AccountingSnapshotsSection.tableIds.test.tsx`; `AwaitingApprovalTile.test.tsx`; `AtRiskProjectsLink.test.tsx`; `StatusBarChart.test.tsx` (same directory) | Card-class selectors are rewritten, not semantic assertions deleted | Source values/provenance/grain, unique width-state shapes, real-role approval predicates, zero/unknown, risk links, count and reduced-motion/a11y behaviour |
| `pmo-portal/e2e/AC-1238-pm-dashboard-status-geometry.spec.ts`; `AC-RD-GEOM-001-dashboard-figure-overflow.spec.ts`; `AC-FAA-010-dashboard-money-geometry.spec.ts` (same directory) | No need to delete readable identity/containment goals; remove only obsolete Project Status/ul selectors | Rebind to merged worklist; keep visible names/full currency figures and no document/figure overflow |
| `pmo-portal/e2e/AC-701-dashboard-smoke.spec.ts`; `AC-1117-dashboard-pipeline.spec.ts`; `UXS-013-dashboard-signal-levers.spec.ts` (same directory) | None of the journey goals | Real data smoke, win-rate control/range correctness and risk→project / budget→evidence journey; steps may open disclosures |

Preserve DAL/hook/derivation tests: `pmo-portal/src/lib/db/dashboard.test.ts`, `src/lib/db/__tests__/dashboard.winRateBoundary.test.ts`, `src/hooks/useDashboard.test.tsx`, `src/lib/dashboardMoney.test.ts`, `src/lib/dashboardConstants.test.ts`, `src/lib/dashboardConstants.sqlParity.test.ts`, `src/lib/dashboardCatalogue.test.ts` (all latter paths under `pmo-portal/`). Preserve shared KPITile/Funnel/figure/a11y suites for their other consumers. New tests bind #1380 to persistent named bar rows and correct separate units/percentages at all periods; test user-visible semantics, not class strings or screenshot beauty.

## Exact static label index

Resolved against the two locale catalogues at the code baseline; “common fallback” marks a dashboard key supplied there, not a new translation. Missing ID is explicitly marked; source fallback remains English. Dynamic project/procurement status labels use their shared registry, timesheet statuses use `common:timesheets.status.{Draft,Submitted,Approved,Rejected}`. Number/date/currency formatting comes from shared format helpers.

| Namespace:key | EN | ID | Call sites |
|---|---|---|---|
| `common:dashboard.boardPack.ariaLabel` | Board pack (coming soon) | Board pack (segera hadir) | `BoardPackAction.tsx` |
| `common:dashboard.boardPack.label` | Board pack | Board pack | `BoardPackAction.tsx` |
| `common:dashboard.boardPack.tooltip` | Board pack export arrives with Reports | Ekspor board pack hadir bersama Laporan | `BoardPackAction.tsx` |
| `common:dashboard.bva.atRisk` | At risk | Berisiko | `BvACard.tsx` |
| `common:dashboard.engineer.byProject` | This week by project | Minggu ini menurut proyek | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.day.fri` | Fri | Jum | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.day.mon` | Mon | Sen | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.day.sat` | Sat | Sab | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.day.sun` | Sun | Min | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.day.thu` | Thu | Kam | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.day.tue` | Tue | Sel | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.day.wed` | Wed | Rab | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.dayHours` | {{day}}: {{hours}} hours | {{day}}: {{hours}} jam | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.entriesEmptySub` | Hours you log will show up here. | Jam yang Anda catat akan muncul di sini. | `EntryList.tsx` |
| `common:dashboard.engineer.hoursByDay` | Hours this week by day | Jam minggu ini menurut hari | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.hoursHelp` | Total hours on your most recent timesheet. | Total jam pada timesheet terbaru Anda. | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.hoursShort` | {{hours}}h | {{hours}} jam | `HoursBar.tsx` |
| `common:dashboard.engineer.hoursSpoken` | {{hours}} {{unit}} | {{hours}} {{unit}} | `HoursBar.tsx` |
| `common:dashboard.engineer.hoursThisWeek` | Hours this week | Jam minggu ini | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.hoursUnit` | hours | jam | `HoursBar.tsx` |
| `common:dashboard.engineer.kpiBand` | My KPIs | KPI saya | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.loadError` | Couldn't load your timesheets | Gagal memuat timesheet Anda | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.logHours` | Log this week's hours | Catat jam kerja minggu ini | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.logHoursShort` | Log hours | Catat jam kerja | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.noHours` | No hours logged this week | Belum ada jam kerja minggu ini | `EngineerDashboard.tsx`, `EntryList.tsx` |
| `common:dashboard.engineer.noHoursSub` | Log your hours to see your weekly breakdown. | Catat jam kerja untuk melihat ringkasan mingguan. | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.noNote` | No note | Tidak ada catatan | `EntryList.tsx` |
| `common:dashboard.engineer.noneThisPeriod` | None this period | Tidak ada untuk periode ini | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.openTimesheetsLog` | Open your timesheets to log this week's hours | Buka timesheet untuk mencatat jam kerja minggu ini | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.openTimesheetsStatus` | Open your timesheets to see your current status | Buka timesheet untuk melihat status terbaru | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.projectBreakdownSub` | Log your hours to see a project breakdown. | Catat jam kerja untuk melihat rincian proyek. | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.recentEntries` | Recent entries | Entri terbaru | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.recentError` | Couldn't load recent entries | Gagal memuat entri terbaru | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.statusHelp` | The status of your most recent timesheet. | Status timesheet terbaru Anda. | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.subtitle` | Your hours this week and timesheet status. | Jam kerja minggu ini dan status timesheet Anda. | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.timesheetStatus` | Timesheet status | Status timesheet | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.title` | My Dashboard | Dashboard saya | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.unknownProject` | Unknown | Tidak diketahui | `EntryList.tsx` |
| `common:dashboard.engineer.weekOf` | week of {{date}} | minggu mulai {{date}} | `EngineerDashboard.tsx` |
| `common:dashboard.engineer.weeklyHoursCardTitle` | Hours This Week | Jam Kerja Minggu Ini | `EngineerDashboard.tsx` |
| `common:dashboard.kpi.awaitingApproval.label` | Awaiting your approval | Menunggu persetujuan Anda | `AwaitingApprovalTile.tsx` |
| `common:dashboard.kpi.awaitingApproval.linkMany` | {{label}}: {{count}} items awaiting | {{label}}: {{count}} item menunggu | `AwaitingApprovalTile.tsx` |
| `common:dashboard.kpi.awaitingApproval.linkOne` | {{label}}: {{count}} item awaiting | {{label}}: {{count}} item menunggu | `AwaitingApprovalTile.tsx` |
| `common:dashboard.kpi.awaitingApproval.linkUnavailable` | {{label}}: unavailable | {{label}}: tidak tersedia | `AwaitingApprovalTile.tsx` |
| `common:dashboard.kpi.awaitingApproval.many` | {{count}} items waiting | {{count}} item menunggu | `AwaitingApprovalTile.tsx` |
| `common:dashboard.kpi.awaitingApproval.one` | {{count}} item waiting | {{count}} item menunggu | `AwaitingApprovalTile.tsx` |
| `common:dashboard.kpi.awaitingApproval.review` | Review | Tinjau | `AwaitingApprovalTile.tsx` |
| `common:dashboard.kpi.awaitingApproval.unavailable` | unavailable — check connection | tidak tersedia — periksa koneksi | `AwaitingApprovalTile.tsx` |
| `common:dashboard.kpi.helpLabel` | Help: {{label}} | Bantuan: {{label}} | `KPITile.tsx` |
| `common:dashboard.procurementStatus.summary` | {{label}}, {{total}} {{noun}}, most in {{status}}. | {{label}}, {{total}} {{noun}}, terbanyak pada {{status}}. | `StatusBarChart.tsx` |
| `common:dashboard.projectedMargin.barLabel` | {{stage}}: {{value}} weighted | {{stage}}: {{value}} tertimbang | `ProjectedMarginBars.tsx` |
| `common:dashboard.projectedMargin.group` | Pipeline projected margin | Margin proyeksi pipeline | `ProjectedMarginBars.tsx` |
| `common:dashboard.projectedMargin.stage` | stage | tahap | `ProjectedMarginBars.tsx` |
| `common:dashboard.projectedMargin.stages` | stages | tahap | `ProjectedMarginBars.tsx` |
| `common:dashboard.projectedMargin.summary` | probability-adjusted across {{count}} open {{stageNoun}} | disesuaikan dengan peluang pada {{count}} {{stageNoun}} aktif | `ProjectedMarginBars.tsx` |
| `common:dashboard.stillToInvoice.clientPo` | Client PO {{po}} | PO klien {{po}} | `StillToInvoiceCard.tsx` |
| `common:dashboard.stillToInvoice.count` | Work orders: {{n}} | Work Order: {{n}} | `StillToInvoiceCard.tsx` |
| `common:dashboard.stillToInvoice.daysSinceClosed` | Days since closed: {{days}} | Hari sejak ditutup: {{days}} | `StillToInvoiceCard.tsx` |
| `common:dashboard.stillToInvoice.empty` | Nothing left to invoice on issued work orders | Tidak ada lagi yang perlu ditagih pada Work Order yang diterbitkan | `StillToInvoiceCard.tsx` |
| `common:dashboard.stillToInvoice.error` | Couldn't load what is still to invoice | Gagal memuat yang belum ditagih | `StillToInvoiceCard.tsx` |
| `common:dashboard.stillToInvoice.incomplete` | Work orders not totalled (an invoice on them has no amount or is in another currency): {{n}} | Work Order yang tidak dijumlahkan (fakturnya tanpa jumlah atau bermata uang lain): {{n}} | `StillToInvoiceCard.tsx` |
| `common:dashboard.stillToInvoice.incompleteMore` | and {{n}} more | dan {{n}} lainnya | `StillToInvoiceCard.tsx` |
| `common:dashboard.stillToInvoice.title` | Still to invoice on work orders | Belum ditagih per Work Order | `StillToInvoiceCard.tsx` |
| `common:dashboard.winRate.basis` | Win-rate basis | Dasar tingkat kemenangan | `WinRateCard.tsx` |
| `common:dashboard.winRate.basisCount` | By count | Menurut jumlah | `WinRateCard.tsx` |
| `common:dashboard.winRate.basisValue` | By value | Menurut nilai | `WinRateCard.tsx` |
| `common:dashboard.winRate.currencyResult` | {{currency}} {{percent}}% — {{wins}} won of {{total}} closed | {{currency}} {{percent}}% — {{wins}} menang dari {{total}} proyek selesai | `WinRateCard.tsx` |
| `common:dashboard.winRate.declined` | {{n}} declined to bid — not counted in the win rate | {{n}} tidak ikut tender — tidak dihitung dalam win rate | `WinRateCard.tsx` |
| `common:dashboard.winRate.emptySub` | Try a wider time frame to see your win rate. | Pilih periode lebih panjang untuk melihat tingkat kemenangan. | `WinRateCard.tsx` |
| `common:dashboard.winRate.emptyTitle` | No closed projects in this window | Tidak ada proyek selesai dalam periode ini | `WinRateCard.tsx` |
| `common:dashboard.winRate.errorSub` | Something went wrong. Try again. | Terjadi kesalahan. Coba lagi. | `WinRateCard.tsx` |
| `common:dashboard.winRate.errorTitle` | Couldn't load win rate | Gagal memuat tingkat kemenangan | `WinRateCard.tsx` |
| `common:dashboard.winRate.lost` | Lost | Kalah | `WinRateCard.tsx` |
| `common:dashboard.winRate.noRecordedLosses` | {{currency}} — no recorded losses; {{wins}} won | {{currency}} — belum ada kekalahan tercatat; {{wins}} menang | `WinRateCard.tsx` |
| `common:dashboard.winRate.period` | Time frame | Periode | `WinRateCard.tsx` |
| `common:dashboard.winRate.periodAll` | All time | Sepanjang waktu | `WinRateCard.tsx` |
| `common:dashboard.winRate.periodQuarter` | Last quarter | Kuartal terakhir | `WinRateCard.tsx` |
| `common:dashboard.winRate.periodTrailing` | Trailing 12 mo | 12 bulan terakhir | `WinRateCard.tsx` |
| `common:dashboard.winRate.periodYtd` | YTD | Tahun ini | `WinRateCard.tsx` |
| `common:dashboard.winRate.progress` | Win rate {{percent}}% | Tingkat kemenangan {{percent}}% | `WinRateCard.tsx` |
| `common:dashboard.winRate.result` | {{wins}} won of {{total}} closed | {{wins}} menang dari {{total}} proyek selesai | `WinRateCard.tsx` |
| `common:dashboard.winRate.title` | Win rate | Tingkat kemenangan | `WinRateCard.tsx` |
| `common:dashboard.winRate.won` | Won | Menang | `WinRateCard.tsx` |
| `common:funnel.scrollableRegion` | Stage summary, scrollable horizontally | Ringkasan tahap, dapat digulir secara horizontal | `Funnel.tsx` |
| `common:tax.basis.exclusive` | excl. PPN | belum termasuk PPN | `TaxBasisLabel.tsx` |
| `common:tax.basis.inclusive` | incl. PPN | termasuk PPN | `TaxBasisLabel.tsx` |
| `common:tax.details.unknownBase` | DPP not recorded | DPP belum dicatat | `TaxBasisLabel.tsx` |
| `common:tax.details.unknownRate` | rate not recorded | tarif belum dicatat | `TaxBasisLabel.tsx` |
| `common:timesheets.status.Approved` | Approved | Disetujui | `EngineerDashboard.tsx` |
| `common:timesheets.status.Draft` | Draft | Draf | `EngineerDashboard.tsx` |
| `common:timesheets.status.Rejected` | Returned for changes | Dikembalikan untuk diperbaiki | `EngineerDashboard.tsx` |
| `common:timesheets.status.Submitted` | Submitted | Diajukan | `EngineerDashboard.tsx` |
| `common:uxs03.coverageCategories` | Actual coverage: {{known}} of {{total}} mapped cost categories | Cakupan aktual: {{known}} dari {{total}} kategori biaya terpetakan | `BvACard.tsx` |
| `common:uxs03.notAvailableYet` | Not available yet | Belum tersedia | `BvACard.tsx`, `ProjectedMarginBars.tsx` |
| `common:uxs03.recordedOutcomesOnly` | Recorded outcomes only; unrecorded decisions are not counted. | Hanya hasil yang tercatat; keputusan yang belum tercatat tidak dihitung. | `WinRateCard.tsx` |
| `common:uxs03.spendingContract` | Spending vs contract | Pengeluaran dibanding kontrak | `BvACard.tsx` |
| `common:uxs03.spendingContractBar` | {{name}}: {{percent}}% of contract | {{name}}: {{percent}}% dari kontrak | `BvACard.tsx` |
| `common:uxs39.hideTaxDetails` | Hide tax details | Sembunyikan rincian pajak | `TaxBasisLabel.tsx` |
| `common:uxs39.showTaxDetails` | Show tax details | Tampilkan rincian pajak | `TaxBasisLabel.tsx` |
| `dashboard:dashboard.accountingSnapshots` | Accounting snapshots (common fallback) | Snapshot akuntansi (common fallback) | `AccountingSnapshotsSection.tsx` |
| `dashboard:dashboard.actualsSnapshotEmpty` | No actuals snapshot yet (common fallback) | Belum ada snapshot aktual (common fallback) | `AccountingSnapshotsSection.tsx` |
| `dashboard:dashboard.agingSnapshotEmpty` | No aging data to show yet. (common fallback) | Belum ada data umur utang/piutang untuk ditampilkan. (common fallback) | `AccountingSnapshotsSection.tsx` |
| `dashboard:dashboard.atRisk.reviewMany` | Review {{count}} at-risk projects (common fallback) | Tinjau {{count}} proyek berisiko (common fallback) | `AtRiskProjectsLink.tsx` |
| `dashboard:dashboard.atRisk.reviewSingle` | Review {{count}} at-risk project (common fallback) | Tinjau {{count}} proyek berisiko (common fallback) | `AtRiskProjectsLink.tsx` |
| `dashboard:dashboard.budgetReviewLink` | Review {{project}} budget (common fallback) | Tinjau anggaran {{project}} (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:dashboard.chart.pipelineMargin.empty` | No open pipeline (common fallback) | Tidak ada pipeline aktif (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.chart.pipelineMargin.error` | Couldn't load the pipeline (common fallback) | Gagal memuat pipeline (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.chart.pipelineMargin.title` | Pipeline forecast margin (common fallback) | Margin proyeksi pipeline (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.chart.procStatus.chartLabel` | Procurement by status (common fallback) | Pengadaan menurut status (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx` |
| `dashboard:dashboard.chart.procStatus.empty` | No procurement activity yet (common fallback) | Belum ada aktivitas pengadaan (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:dashboard.chart.procStatus.noun` | requests (common fallback) | permintaan (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx` |
| `dashboard:dashboard.empty.sub` | Create your first project to see portfolio KPIs here. (common fallback) | Buat proyek pertama Anda untuk melihat KPI portofolio di sini. (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.empty.title` | No data yet (common fallback) | Belum ada data (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.error.sub` | The dashboard query failed. Retry, or check back shortly. (common fallback) | Kueri dashboard gagal. Coba lagi, atau periksa kembali sebentar lagi. (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.error.title` | Couldn't load the dashboard (common fallback) | Gagal memuat dashboard (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.aboutMetric` | About this metric (common fallback) | Tentang metrik ini (common fallback) | `ExecutiveDashboard.tsx`, `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.pipelineMargin.help` | Probability-adjusted projected margin across the open pipeline (Σ(value − budget) / Σ value, weighted by stage win-probability). (common fallback) | Proyeksi margin yang disesuaikan dengan peluang menang di seluruh pipeline aktif (Σ(nilai − anggaran) / Σ nilai, tertimbang menurut peluang menang tiap tahap). (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.pipelineMargin.label` | Pipeline forecast margin (common fallback) | Margin proyeksi pipeline (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.pipelineMargin.vs` | probability-weighted (common fallback) | tertimbang peluang (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.pipelineWeighted.help` | Sum of (project value × stage win-probability) across all open stages. (common fallback) | Jumlah (nilai proyek × peluang menang tahap) di semua tahap aktif. (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.pipelineWeighted.label` | Pipeline (weighted) (common fallback) | Pipeline (tertimbang) (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.pipelineWeighted.linkLabel` | Open the sales pipeline (common fallback) | Buka pipeline penjualan (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.pipelineWeighted.vs` | of {{gross}} gross (common fallback) | dari {{gross}} bruto (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.revenueOnHand.help` | Contract value across delivery projects. Margin is measured on billed work only: billed-work revenue less Actual. It is not cash received. (common fallback) | Nilai kontrak di seluruh proyek yang sedang berjalan. Margin hanya diukur pada pekerjaan yang telah ditagihkan: pendapatan tertagih dikurangi Aktual. Margin bukan kas yang sudah diterima. (common fallback) | `ExecutiveDashboard.tsx`, `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.totalContractValue.help` | Total contract value across the active portfolio. (common fallback) | Total nilai kontrak di seluruh portofolio aktif. (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.totalContractValue.label` | Total contract value (common fallback) | Total nilai kontrak (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.totalContractValue.linkLabel` | Open active projects to see total contract value (common fallback) | Buka proyek aktif untuk melihat total nilai kontrak (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.totalContractValue.mobileVs` | Signed value of the {{count}} projects still in delivery (common fallback) | Nilai kontrak {{count}} proyek yang masih berjalan (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.totalSpend.help` | On-hand portfolio Actual recorded to date. (common fallback) | Aktual portofolio saat ini yang tercatat hingga kini. (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.totalSpend.label` | Recorded spending (common fallback) | Pengeluaran tercatat (common fallback) | `ExecutiveDashboard.tsx`, `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpi.totalSpend.linkLabel` | Open active projects to see spend breakdown (common fallback) | Buka proyek aktif untuk melihat rincian pengeluaran (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.kpiBand.label` | Portfolio KPIs (common fallback) | KPI portofolio (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.approvals` | Approvals (common fallback) | Persetujuan (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.approvalsLink` | Awaiting your approval: {{count}} items. Open approvals inbox. (common fallback) | Menunggu persetujuan Anda: {{count}} item. Buka kotak masuk persetujuan. (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.approvalsLinkError` | Awaiting your approval. Open approvals inbox. (common fallback) | Menunggu persetujuan Anda. Buka kotak masuk persetujuan. (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.atRiskCount` | {{count}} projects at risk (common fallback) | {{count}} proyek berisiko (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.atRiskRegion` | Projects at risk (common fallback) | Proyek berisiko (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.atRiskZero` | All projects on track (common fallback) | Semua proyek sesuai rencana (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.awaitingApproval` | Awaiting your approval (common fallback) | Menunggu persetujuan Anda (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.breakdown` | Breakdown (common fallback) | Rincian (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.contractBook` | Contract book (common fallback) | Portofolio kontrak (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.needsAttention` | Needs attention (common fallback) | Perlu perhatian (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.noRiskSummary` | of {{count}} active projects · all on track (common fallback) | dari {{count}} proyek aktif · semua berjalan sesuai rencana (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.review` | Review (common fallback) | Tinjau (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.riskSummary` | of {{count}} active projects flagged over budget or behind schedule (common fallback) | dari {{count}} proyek aktif melewati anggaran atau terlambat (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.mobile.spendLink` | Open spend breakdown · {{amount}} spent to date (common fallback) | Buka rincian pengeluaran · {{amount}} hingga kini (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:dashboard.pm.atRisk` | At risk (common fallback) | Berisiko (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.atRiskHelp` | Your projects whose actual spend exceeds 90% of budget. (common fallback) | Proyek Anda dengan realisasi pengeluaran lebih dari 90% anggaran. (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.budgetUsage` | budget usage > 90% (common fallback) | penggunaan anggaran > 90% (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.contractValue` | My contract value (common fallback) | Nilai kontrak saya (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.contractValueHelp` | Total contract value across your projects. (common fallback) | Total nilai kontrak seluruh proyek Anda. (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.kpiBand` | My KPIs (common fallback) | KPI saya (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.loadError` | Couldn't load your projects (common fallback) | Gagal memuat proyek Anda (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.myProjects` | My projects (common fallback) | Proyek saya (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.nothingToShow` | Nothing to show yet (common fallback) | Belum ada yang ditampilkan (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.openAtRisk` | Open my at-risk projects (common fallback) | Buka proyek saya yang berisiko (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.openContractValue` | Open my projects to see contract value (common fallback) | Buka proyek saya untuk melihat nilai kontrak (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.openMyProjects` | Open my projects (common fallback) | Buka proyek saya (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.statusTitle` | Project Status (common fallback) | Status Proyek (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.subtitle` | Your projects, budget health, and approvals queue. (common fallback) | Proyek, kesehatan anggaran, dan antrean persetujuan Anda. (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.pm.title` | My Dashboard (common fallback) | Dashboard saya (common fallback) | `PMDashboard.tsx` |
| `dashboard:dashboard.snapshots.guidance` | Ask your administrator to sync accounting data. (common fallback) | Minta administrator menyinkronkan data akuntansi. (common fallback) | `AccountingSnapshotsSection.tsx` |
| `dashboard:dashboard.snapshots.unavailable` | No accounting snapshot has been synced yet. (common fallback) | Belum ada snapshot akuntansi yang disinkronkan. (common fallback) | `AccountingSnapshotsSection.tsx` |
| `dashboard:dashboard.sr.activeProjects` | active projects (common fallback) | proyek aktif (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.sr.statuses` | statuses (common fallback) | status (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.subtitle.desktop` | Portfolio health across the contracting book — margin on hand, pipeline forecast, and delivery exposure. (common fallback) | Kesehatan portofolio di seluruh kontrak berjalan — margin saat ini, proyeksi pipeline, dan eksposur pelaksanaan. (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.subtitle.mobile` | What needs your attention across the contracting book. (common fallback) | Apa yang perlu perhatian Anda di seluruh kontrak berjalan. (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.title` | Executive Dashboard (common fallback) | Dashboard Eksekutif (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:dashboard.uxs36AgeingBasis` | Ageing basis (common fallback) | Dasar umur piutang (common fallback) | `AccountingSnapshotsSection.tsx` |
| `dashboard:dashboard.uxs36CustomerCollectionsTitle` | Customer collections (AR) (common fallback) | Piutang pelanggan (AR) (common fallback) | `AccountingSnapshotsSection.tsx` |
| `dashboard:dashboard.uxs36ReportDate` | Report date (common fallback) | Tanggal laporan (common fallback) | `AccountingSnapshotsSection.tsx` |
| `dashboard:dashboard.uxs36Unavailable` | Unavailable (common fallback) | Tidak tersedia (common fallback) | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.account` | Account | Akun | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.actualsError` | Couldn't load actuals | Gagal memuat aktual | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.actualsTitle` | Actuals (ERP ledger) | Aktual (buku besar ERP) | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.allInvoicesPaid` | All vendor invoices have been paid or none are awaiting action. | Semua faktur vendor telah dibayar atau tidak ada yang menunggu tindakan. | `FinanceDashboard.tsx` |
| `dashboard:finance.apError` | Couldn't load vendor payables | Gagal memuat utang vendor | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.apTitle` | Vendor payables (AP) | Utang kepada vendor (AP) | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.arError` | Couldn't load customer receivables | Gagal memuat piutang pelanggan | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.awaiting` | Purchase requests awaiting your decision | Permintaan pembelian menunggu keputusan Anda | `FinanceDashboard.tsx` |
| `dashboard:finance.budgetReviewLoadError` | Couldn't load budget review | Tidak dapat memuat tinjauan anggaran | `FinanceDashboard.tsx` |
| `dashboard:finance.contractValue` | Contract value in progress | Nilai kontrak berjalan | `FinanceDashboard.tsx` |
| `dashboard:finance.contractValueHelp` | Total contract value across active projects. | Total nilai kontrak proyek aktif. | `FinanceDashboard.tsx` |
| `dashboard:finance.contractValueLink` | Open active projects to see contract value | Buka proyek aktif untuk melihat nilai kontrak | `FinanceDashboard.tsx` |
| `dashboard:finance.costCenter` | Cost center | Pusat biaya | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.current` | Current | Saat ini | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.dashboardError` | Couldn't load the finance dashboard | Gagal memuat dasbor keuangan | `FinanceDashboard.tsx` |
| `dashboard:finance.days` | {{count}} days | {{count}} hari | `FinanceDashboard.tsx` |
| `dashboard:finance.fiscalYear` | Fiscal year | Tahun fiskal | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.invoiced` | Invoiced | Ditagihkan | `FinanceDashboard.tsx` |
| `dashboard:finance.invoicedHelp` | Days since the vendor invoice was recorded; older records use their last update date. | Jumlah hari sejak faktur vendor dicatat; catatan lama menggunakan tanggal pembaruan terakhir. | `FinanceDashboard.tsx` |
| `dashboard:finance.kpiBand` | Finance KPIs | KPI keuangan | `FinanceDashboard.tsx` |
| `dashboard:finance.loadInvoicesError` | Couldn't load invoices | Gagal memuat faktur | `FinanceDashboard.tsx` |
| `dashboard:finance.margin` | Margin to date | Margin hingga saat ini | `FinanceDashboard.tsx` |
| `dashboard:finance.marginHelp` | Billed-work revenue less recorded spending; this is not cash received. | Pendapatan pekerjaan yang ditagihkan dikurangi pengeluaran tercatat; bukan kas yang diterima. | `FinanceDashboard.tsx` |
| `dashboard:finance.net` | Net | Neto | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.netUnavailableReason` | The source snapshot did not supply a Net value. | Snapshot sumber tidak menyediakan nilai neto. | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.nothingAwaitingPayment` | Nothing awaiting payment | Tidak ada yang menunggu pembayaran | `FinanceDashboard.tsx` |
| `dashboard:finance.oneDay` | 1 day | 1 hari | `FinanceDashboard.tsx` |
| `dashboard:finance.openRequest` | Open {{request}} | Buka {{request}} | `FinanceDashboard.tsx` |
| `dashboard:finance.party` | Party | Pihak | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.payables` | Vendor payables | Utang kepada vendor | `FinanceDashboard.tsx` |
| `dashboard:finance.payablesDetail` | Vendor-invoiced, awaiting payment | Ditagihkan vendor, menunggu pembayaran | `FinanceDashboard.tsx` |
| `dashboard:finance.payablesHelp` | Procurement value owed to vendors in the Vendor Invoiced state. | Nilai pengadaan yang terutang kepada vendor dengan status Ditagihkan Vendor. | `FinanceDashboard.tsx` |
| `dashboard:finance.payablesLink` | Open vendor invoices awaiting payment | Buka faktur vendor yang menunggu pembayaran | `FinanceDashboard.tsx` |
| `dashboard:finance.project` | Project | Proyek | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.projectUnavailableReason` | Project name is unavailable. | Nama proyek tidak tersedia. | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.recordedSpending` | Recorded spending | Pengeluaran tercatat | `FinanceDashboard.tsx` |
| `dashboard:finance.request` | Request | Permintaan | `FinanceDashboard.tsx` |
| `dashboard:finance.spendingHelp` | Actual spending recorded across the delivery portfolio. | Pengeluaran aktual yang tercatat di seluruh portofolio proyek berjalan. | `FinanceDashboard.tsx` |
| `dashboard:finance.spendingLink` | Open active projects to see spending details | Buka proyek aktif untuk melihat rincian pengeluaran | `FinanceDashboard.tsx` |
| `dashboard:finance.today` | Today | Hari ini | `FinanceDashboard.tsx` |
| `dashboard:finance.totalOutstanding` | Total outstanding | Total terutang | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.unattributed` | Not attributed to a project | Tidak terkait dengan proyek | `AccountingSnapshotsSection.tsx` |
| `dashboard:finance.value` | Value | Nilai | `FinanceDashboard.tsx` |
| `dashboard:kpi.activeProjectsCount` | {{count}} active projects | {{count}} proyek aktif | `ExecutiveDashboard.tsx` |
| `dashboard:pm.myProjectsHelp` | Delivery projects where you are the assigned project manager. | Proyek pengiriman yang ditetapkan kepada Anda sebagai manajer proyek. | `PMDashboard.tsx` |
| `dashboard:pm.noProjects` | No delivery projects assigned to you yet | Belum ada proyek pengiriman yang ditetapkan kepada Anda | `PMDashboard.tsx` |
| `dashboard:pm.noProjectsSub` | Projects in the delivery phase will appear here. | Proyek dalam tahap pengiriman akan muncul di sini. | `PMDashboard.tsx` |
| `dashboard:pmRow.delivery` | Delivery | Pengiriman | `PMDashboard.tsx` |
| `dashboard:pmRow.margin` | Margin | Margin | `PMDashboard.tsx` |
| `dashboard:pmRow.marginAria` | {{name}} margin to date: {{pct}}% | Margin sampai saat ini {{name}}: {{pct}}% | `PMDashboard.tsx` |
| `dashboard:risk.uncheckedNote` | Risk can't be checked yet — no active budget. | Risiko belum dapat diperiksa — belum ada anggaran aktif. | `AtRiskProjectsLink.tsx`, `MobileExecutiveDashboard.tsx` |
| `dashboard:spend.partial` | Partial | Parsial | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx`, `MobileExecutiveDashboard.tsx` |
| `dashboard:uxs03.activeBudget` | Active budget (common fallback) | Anggaran aktif (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.activeBudgetReviewEmpty` | No active budgets ready for review (common fallback) | Belum ada anggaran aktif yang siap ditinjau (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.activeBudgetReviewEmptySub` | Active, positive-value budgets appear here. (common fallback) | Anggaran aktif bernilai positif ditampilkan di sini. (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.activeContractValue` | Active contract value (common fallback) | Nilai kontrak aktif (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:uxs03.actual` | Actual (common fallback) | Aktual (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.actualAsOf` | As of {{date}} (common fallback) | Per {{date}} (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.actualIncompleteCategories` | Actual incomplete: {{count}} cost categories not mapped (common fallback) | Aktual belum lengkap: {{count}} kategori biaya belum dipetakan (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:uxs03.actualSourceCurrency` | Source currency: {{currency}} (common fallback) | Mata uang sumber: {{currency}} (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.atRisk` | At risk (common fallback) | Berisiko (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.attentionAndApprovals` | Attention and approvals (common fallback) | Perhatian dan persetujuan (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx`, `PMDashboard.tsx` |
| `dashboard:uxs03.contractRemaining` | Contract remaining after known Actual (common fallback) | Sisa kontrak setelah Aktual yang diketahui (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx`, `MobileExecutiveDashboard.tsx` |
| `dashboard:uxs03.contractValueOnHand` | Contract value on hand (common fallback) | Nilai kontrak dalam portofolio saat ini (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:uxs03.contractedRevenue` | Contracted revenue (common fallback) | Pendapatan terikat kontrak (common fallback) | `MobileExecutiveDashboard.tsx` |
| `dashboard:uxs03.coverage` | Actual available for {{known}} of {{total}} delivery projects (common fallback) | Aktual tersedia untuk {{known}} dari {{total}} proyek pelaksanaan (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx`, `MobileExecutiveDashboard.tsx` |
| `dashboard:uxs03.coverageCategories` | Actual coverage: {{known}} of {{total}} mapped cost categories (common fallback) | Cakupan aktual: {{known}} dari {{total}} kategori biaya terpetakan (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx`, `MobileExecutiveDashboard.tsx` |
| `dashboard:uxs03.deliveryChartEmpty` | No delivery projects to compare yet (common fallback) | Belum ada proyek pelaksanaan untuk dibandingkan (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:uxs03.deliveryChartScope` | Won, on-hold, delivery and closed-out projects, plus internal work. (common fallback) | Proyek menang, ditahan, dalam pelaksanaan atau selesai, serta proyek internal. (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:uxs03.financeBudgetReviewTitle` | Budget review — top 5 by variance (portfolio-wide) (common fallback) | Tinjauan anggaran — 5 teratas berdasarkan selisih (seluruh portofolio) (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.financeDashboardSubtitle` | Portfolio revenue, spend, margin, and budget utilization. (common fallback) | Pendapatan, pengeluaran, margin, dan pemakaian anggaran portofolio. (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.financeDashboardTitle` | Finance Dashboard (common fallback) | Dasbor Keuangan (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.financeProjectColumn` | Project (common fallback) | Proyek (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.financeReadyToPay` | Ready to pay (common fallback) | Siap dibayar (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.marginToDate` | Margin to date (common fallback) | Margin hingga saat ini (common fallback) | `PMDashboard.tsx` |
| `dashboard:uxs03.mixedCurrencyTotalUnavailable` | Unavailable for mixed currencies (common fallback) | Tidak tersedia untuk mata uang campuran (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:uxs03.notAvailableYet` | Not available yet (common fallback) | Belum tersedia (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx`, `MobileExecutiveDashboard.tsx`, `PMDashboard.tsx` |
| `dashboard:uxs03.openAccountingMap` | Review accounting mappings (common fallback) | Tinjau pemetaan akuntansi (common fallback) | `ExecutiveDashboard.tsx` |
| `dashboard:uxs03.pmoPurchasing` | PMO purchasing requests (common fallback) | Permintaan pembelian PMO (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx` |
| `dashboard:uxs03.pmoPurchasingScope` | ERP-native purchases are outside this PMO request chart. (common fallback) | Pembelian langsung melalui ERP tidak termasuk dalam grafik permintaan PMO ini. (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx` |
| `dashboard:uxs03.realizedMargin` | Margin on billed work (common fallback) | Margin atas pekerjaan yang ditagihkan (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx`, `MobileExecutiveDashboard.tsx` |
| `dashboard:uxs03.realizedMarginKnown` | Known margin on billed work (common fallback) | Margin yang diketahui atas pekerjaan yang ditagihkan (common fallback) | `ExecutiveDashboard.tsx`, `FinanceDashboard.tsx`, `MobileExecutiveDashboard.tsx` |
| `dashboard:uxs03.spendingContract` | Spending vs contract (common fallback) | Pengeluaran dibanding kontrak (common fallback) | `ExecutiveDashboard.tsx`, `PMDashboard.tsx` |
| `dashboard:uxs03.utilization` | Utilization (common fallback) | Pemakaian (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs03.variance` | Variance (common fallback) | Selisih (common fallback) | `FinanceDashboard.tsx` |
| `dashboard:uxs19.dashboardEmpty` | No PMO requests to show (common fallback) | Tidak ada permintaan PMO untuk ditampilkan (common fallback) | `ExecutiveDashboard.tsx` |

## PA-00 block ownership and removal decisions

All five personas have an arrival/job answer for `/` in the short brief; no dashboard route is retired: each has an evidenced persona job. The inventory role column assigns every existing block a persona. Block ownership is intentional: Executive/Admin use risk, approvals and delivery position to choose intervention; their pipeline/win outcomes inform pursuit decisions and Board pack supports period review. Finance uses unbilled/payable/collection evidence to select a case, budget evidence to select a variance to inspect, and source snapshots to verify that choice. PM uses assignment, delivery/risk/margin and approval evidence to select the next intervention. Engineer uses dated totals/status, daily/project breakdown and recent entries to check time and reach correction/logging. Error/empty/help blocks serve the same persona's recovery or understanding job.

| Block without a distinct additional job | Decision and reason (preserve records/data, remove duplicate block code) |
|---|---|
| Separate Executive forecast-margin KPI and chart headline | **Merge into `/` Pipeline section**; one margin figure beside its evidence, retain weighted/gross values and stage links. |
| PM's duplicate project presentations | **Merge into `/` My delivery projects worklist**; keep delivery, status, risk, spending comparison, margin and all links in one project home. |
| Engineer's repeated week-hours headline | **Merge into `/` dated timesheet summary**; daily and project breakdowns keep their distinct analytical jobs. |
| Finance's repeated margin/remainder subline and multiple missing-snapshot panels | **Merge into `/` Financial position and accounting evidence**; one labeled row per fact and one scoped remedy, preserve Actuals/AP/AR evidence. |
| Empty PMO purchasing plot frame | **Merge into `/` Purchasing requests disclosure**; compact zero status keeps the capability discoverable; populated counts retain their current role-specific interactions. |

Static detector acceptance baseline: `impeccable detect pmo-portal/pages --json` = **0**; `impeccable detect pmo-portal/src/components/dashboard --json` = **0**; scans of `KPITile.tsx` and `Funnel.tsx` = **0** each. No deterministic findings to list or waive. These results establish source-scan evidence only; builder must rerun on changed source and rendered routes with `scripts/ux-proof.sh`.

Impeccable critique provenance: isolated source assessment and detector assessment, no app/server/overlay launched for this docs-only scope. Source review prompted explicit first-screen position figure, state-based next-case action and Engineer unavailable-on-error requirement. Visual aesthetics, live a11y and performance remain unscored until rendered. Questions skipped: owner requested one discovery round from PRODUCT/routes and continuation, with explicit docs-only scope. The method follows `docs/ux/impeccable-map.md`; no full product-design interview or implementation is implied.

Build removal ledger (PA-00 owner amendment): remove the redundant standalone blocks named above and their dead composition code/tests; retain each distinct data field, calculation and reachable action in its named merged home. Retire the empty purchasing plot block in favour of its compact disclosure status. List each block removal, destination and reason in the implementation PR body. No role dashboard route or navigation item is removed; `/` remains canonical. If a later build removes another route, add a redirect to its named home and preserve records/schema; no data deletion.

Collection ordering clarification: Still to invoice uses closed work orders oldest closure first, then issued work orders, stable work-order ID ties; show the active sort and preserve server-wide currency totals independently of displayed rows. Executive spending comparison remains scoped to the returned top-project set, never claims a portfolio-wide risk ranking. Finance source dates are shown only when supplied, never inferred from a render timestamp.
