# Spec — Delivery Bahasa, batch A (UXS-006, #1011)

**Status: SIGNED — Director, 2026-10-14**, under the owner's "do the UX follow-ups" mandate. Built in five runs: A1 AC-UXA-001..004+017+FIN-002 · A2 005..007 · A3 008..010 · A4 011..014 · A5 015..016.

Sources: UXD-A-002/005/009, B-08 in `docs/reviews/2026-10-10-ux-discover-{A,B}.md`; GitHub #1011;
Director-supplied planner recon. 
Job: when PMs, Engineers and Executives read delivery work in their saved language, they can recognize
states and act without mentally translating system copy. Preserve the existing design and workflows.
Binding: DD-VOCAB-1, DD-RISK-1, ADR-0010 and `docs/qa-portfolio.md`.

## Scope: surfaces × states

Paths below are relative to `pmo-portal/`. P/L/E/X/C = populated/loading/empty/error/confirmation;
cover each existing branch, not new states. All rows include visible copy, help, feedback and accessible names.
Within project-detail rows, `tabs/` and unqualified sibling sources are under `pages/project-detail/`; `…` means `/projects/:id`.

| Route / persona | Included sources / surface | States |
|---|---|---|
| `/`, PM | `src/components/dashboard/PMDashboard.tsx`: heading, KPIs, project rows, delivery summary, BvA | P/L/E/X; no C |
| `/`, Engineer | `src/components/dashboard/EngineerDashboard.tsx`: heading, week/status/day labels, project/recent entries, log-hours action | P/L/E/X; no C |
| `/`, Executive/Admin | `pages/ExecutiveDashboard.tsx`; `src/components/dashboard/{MobileExecutiveDashboard,WinRateCard,BvACard,ProjectedMarginBars,StatusBarChart,StillToInvoiceCard,ChartFrame,AtRiskProjectsLink}.tsx`; `src/components/reports/BoardPackAction.tsx` | P/L/E/X where present; win-rate basis/period; chart spoken summaries; existing export feedback |
| `/`, PM/Executive/Finance | `src/components/dashboard/AwaitingApprovalTile.tsx`: default/override label, help, CTA, comparison and spoken link name | loading, error, zero, one, many; both `includeTimesheets` branches |
| `/projects`, `/sales` → `/projects/:id`, PM/Executive | list/card/board status displays, calendar Today; `PipelineLens`, `ProjectDetailHeader`, `ProjectDetailRail`, `components/ProjectStatusControl.tsx` | pipeline/lost, won/on-hand/internal; advance/win/lost, contract-value/archive/delete C |
| `/projects/:id/:tab`, PM/Finance/Engineer as permitted | `pages/project-detail/ProjectDetail.tsx`: eight tab names, heading/return controls, role-gated Billing and work-order query states | L/X/retry/not-found, P; permission/read-only |
| `…/overview` | `tabs/OverviewTab.tsx`, phase strip/form, S-curve/Gantt and drawdown system labels | P/L/E/X and existing progress/dirty C |
| `…/budget` | `tabs/BudgetTab.tsx`, `pages/ProjectBudget.tsx`, `pages/BudgetProjection.tsx` | P/L/E/X, draft/active, create/clone/archive/activate C, projection readiness |
| `…/procurement` | `tabs/ProcurementTab.tsx` summary/rows/actions only | P/L/E/X; request composer delegated to batch B |
| `…/tasks` | `tabs/TasksTab.tsx`, `ProjectGantt.tsx`, delegated task comments/push/integration labels | P/L/E/X, list/board/timeline/archived; create/edit/status/toast/delete/dirty C, read-only pills |
| `…/work-orders` | `tabs/WorkOrdersTab.tsx`, drawdown, order/value/invoice forms | P/L/E/X, create/edit/issue/close/value/dirty C and existing failures |
| `…/billing` | `tabs/BillingTab.tsx`, BoQ/assessment/claim/evidence forms | P/L/E/X, create/edit/evidence/decision/dirty C |
| `…/documents`, `…/history` | `tabs/DocumentsTab.tsx`, revision form; `src/components/history/RecordHistory.tsx` labels/filters | P/L/E/X, document create/edit/revise/decision/delete/dirty C; history read-only |
| `/meetings`, PM/Admin | `pages/Meetings.tsx`: list, filters, create form | P/L/E/X, zero-match/clear, validation, archive/delete/dirty C |
| `/meetings/:id`, PM/Admin/read-only viewer | `pages/MeetingDetail.tsx`, `src/components/meetings/{MinutesEditor,ActionItemView}.tsx` and `{minutesDictionary,minutesSlashMenu}.ts` in the same directory | P/L/X/not-found; attendee/share/editor/action states; save/archive/delete/dirty C |
| `/sales-invoices`, Finance | rail, breadcrumb and page heading only | settled navigation + unresolved/resolved breadcrumb |

## Approved bilingual glossary

| en display | id display / ruling |
|---|---|
| To Do; In Progress; Done; Blocked | Belum dimulai; Sedang dikerjakan; Selesai; Terhambat |
| Won — kickoff pending | Menang — menunggu rapat awal (`Won, Pending KoM` remains stored) |
| Phase | Fase; never user-facing Milestone/Tonggak (DD-VOCAB-1) |
| Work Order | Work Order retained: existing `projectDetail.tabs.workOrders` and order-form catalogue usage; do **not** introduce Perintah kerja |
| Sales Pipeline; Pipeline | Pipeline Penjualan; Pipeline (approved borrowing) |
| Sales Invoices | Faktur Penjualan (nav, breadcrumb, page) |
| My dashboard; Awaiting your approval; Review | Dashboard saya; Menunggu persetujuan Anda; Tinjau |
| Log this week's hours; Today | Catat jam kerja minggu ini; Hari ini |

## Requirements (EARS)

- **FR-UXA-001:** When a scoped surface renders in `en` or `id`, the interface shall use that locale for its system labels in every state listed above, including spoken names, validation and recovery.
- **FR-UXA-002:** When project statuses/stages render, the interface shall reuse `src/hooks/useProjectStatusLabel.ts` (`useProjectStatusLabel`/`useSalesStageLabel`) for equivalent displays and localized advance targets; transitions shall still send the original enum.
- **FR-UXA-003:** When task status renders in a select, pill, board, minutes action or toast, the interface shall use one static-key mapping of `task.status.*`, following `pages/MyTasks.tsx`; select values shall remain stored enums.
- **FR-UXA-004:** When AwaitingApprovalTile renders, the interface shall translate its default label through neutral `dashboard.kpi.awaitingApproval.*` keys, preserve explicit label overrides, and localize help/Review/link names in every count/query branch without changing counts or destinations.
- **FR-UXA-005:** When Finance opens Sales Invoices, the rail, breadcrumb and page shall say “Sales Invoices” / “Faktur Penjualan”. The existing **AC-FIN-002** assertion shall replace “Invoice Penjualan” with “Faktur Penjualan”; its other Finance destinations shall remain unchanged.
- **FR-UXA-006:** The interface shall use only `public/locales/{en,id}/common.json` and static, parser-visible `t()` keys; newly scoped delegated sources shall be added to `src/lib/i18n/launch-scope-routes.txt` on their existing route lines.
- **NFR-UXA-001:** The change shall preserve routes, URL parameters, analytics names, persisted values, API payloads, role/SoD/RLS rules and financial/progress calculations; localization shall add zero network requests.
- **NFR-UXA-002:** The risk displays shall retain DD-RISK-1's active-delivery population, committed-spend basis and `>= 0.9` threshold; copy shall not redefine the metric.
- **NFR-UXA-003:** The interface shall retain DESIGN tokens and keyboard/focus behavior; `npm run check:i18n` shall pass with both catalogues and the expanded manifest.

## Acceptance criteria

Every criterion runs against the real en/id dictionaries, mocks data/hooks rather than the component under test,
and asserts **specific labels**, never a generic “no English” scan. Exclusions: user-authored names/titles/notes/locations,
provider/brand names (ERPNext, ClickUp, Microsoft), approved borrowings, stored enums, URL parameters and analytics events.

- **AC-UXA-001** — Given PM fixtures for P/L/E/X, When the dashboard renders, Then “My dashboard / Dashboard saya”, KPI/help/links and project status labels use the active locale with unchanged values.
- **AC-UXA-002** — Given Engineer P/L/E/X and draft/approved weeks, When rendered, Then the week/status/day summaries, spoken labels and “Log this week's hours / Catat jam kerja minggu ini” are localized.
- **AC-UXA-003** — Given all named Executive widgets and their existing branches, When rendered desktop/mobile, Then headings, win-rate basis/period/result, BvA/chart summaries, procurement-stage displays and export/readiness feedback use specific catalogue labels without changing metric data or links.
- **AC-UXA-004** — Given both approval-count modes and loading/error/zero/one/many results, When the tile renders with default or explicit label, Then its visible/spoken label, help, “Review / Tinjau” and count-state copy agree; errors remain unavailable, not zero.
- **AC-UXA-005** — Given all twelve project statuses and pipeline advance/win/lost controls, When lists/cards/boards/header/rail/stepper and calendar controls render, Then “Today / Hari ini” and equivalent status labels use the approved translation and localized actions submit the original enum, contract inputs and URLs unchanged.
- **AC-UXA-006** — Given pending/error/missing and permitted/read-only project fixtures, When detail/tab routes render, Then retry/not-found/return controls and all eight tab names use the locale and existing Billing visibility/query routing remain intact.
- **AC-UXA-007** — Given Overview/phase/chart/drawdown states, When rendered or an existing form opens, Then specific labels use “Phase / Fase” and localized system guidance without translating phase names or changing progress.
- **AC-UXA-008** — Given draft/active budgets and unavailable projection, When their states/forms/confirmations render, Then localized status, actions and remedies preserve the distinction between active PMO budget and external readiness.
- **AC-UXA-009** — Given project Procurement summary P/L/E/X, When rendered, Then its headers/stages/empty/retry/action labels use the locale; opening New request delegates unchanged to batch B's composer.
- **AC-UXA-010** — Given task list/board/timeline/archived and writable/read-only fixtures, When forms, status changes, comments, integration guidance and confirmations render, Then approved task labels and specific system feedback are localized while writes retain raw status values.
- **AC-UXA-011** — Given Work Order P/L/E/X and its existing forms/confirmations, When rendered, Then localized actions/help retain “Work Order”, original values, reviewer eligibility and invoicing consequences.
- **AC-UXA-012** — Given Billing P/L/E/X and BoQ/assessment/claim/evidence decisions, When rendered, Then fields, actions, validation and confirmation labels are localized with amounts and record identity unchanged.
- **AC-UXA-013** — Given Documents P/L/E/X and create/edit/revision/decision confirmations, When rendered, Then specific field, status, action, error and spoken labels use the active locale without altering files or lifecycle rules.
- **AC-UXA-014** — Given populated/empty/loading/error History, When filters/entries render, Then system filter/event labels are localized and user-authored history values remain verbatim.
- **AC-UXA-015** — Given Meetings list/create P/L/E/X and zero-match/confirmation states, When rendered, Then headings/filters/validation/clear/archive/delete/dirty guidance use the locale and entered content remains verbatim.
- **AC-UXA-016** — Given meeting detail pending/error/missing/read-only/editor fixtures, When attendees/shares/minutes/actions and confirmations render, Then system labels/statuses/help/feedback are localized while names, minutes and locations remain verbatim.
- **AC-UXA-017** — Given Finance navigation and Sales Invoices, When rail and page render in either locale, Then their labels agree as “Sales Invoices / Faktur Penjualan”.
- **AC-FIN-002 (amended)** — Given the three Finance routes, When Bahasa breadcrumbs render, Then Sales Invoices reads “Faktur Penjualan”, Incoming Payments “Pembayaran Masuk”, Revenue by Project “Pendapatan per Proyek”, and none falls through to Not found.

## Ownership and graduation (planned, not yet graduated)

Each row has **one canonical RTL `it`**, titled with its AC-id; fixture loops may cover several branches.
Existing tests elsewhere are supporting regression proof, not additional owners. Paths relative to `pmo-portal/`;
new `.bahasa` files below are planned. Each row's final column is the retention note to add to `docs/decisions.md`.
All route cells additionally receive state-coverage, WCAG-AA label/focus and mobile@390 manual sweeps.

| AC | Unit owning test file | Routes × primary oracle | Graduation note |
|---|---|---|---|
| AC-UXA-001 | `src/components/dashboard/PMDashboard.test.tsx` | `/` PM × state-coverage/cross-screen consistency | Role dashboard copy includes help/states. |
| AC-UXA-002 | `src/components/dashboard/EngineerDashboard.test.tsx` | `/` Engineer × state-coverage/cross-screen consistency | Week/status/spoken names share locale. |
| AC-UXA-003 | `pages/__tests__/ExecutiveDashboard.bahasa.test.tsx` | `/` Executive/Admin × cross-screen consistency | Delegated widget copy is launch scope too. |
| AC-UXA-004 | `src/components/dashboard/AwaitingApprovalTile.test.tsx` | `/` approvals tile × state-coverage | Shared neutral KPI keys; unknown count ≠ zero. |
| AC-UXA-005 | `pages/project-detail/__tests__/ProjectLifecycle.bahasa.test.tsx` | `/projects`, `/sales`, `/projects/:id` × cross-screen consistency | Translate display, never enum/payload. |
| AC-UXA-006 | `pages/project-detail/__tests__/ProjectDetail.tabs.test.tsx` | `/projects/:id`, `/projects/:id/:tab` × state-coverage | Tabs and route states share vocabulary. |
| AC-UXA-007 | `pages/project-detail/__tests__/OverviewTab.bahasa.test.tsx` | `…/overview` × job-fit-per-role | DD-VOCAB-1; phase behavior remains wave 2c. |
| AC-UXA-008 | `pages/project-detail/tabs/BudgetTab.bahasa.test.tsx` | `…/budget` × state-coverage | Business and integration outcomes stay distinct. |
| AC-UXA-009 | `pages/project-detail/__tests__/ProcurementTab.bahasa.test.tsx` | `…/procurement` × cross-screen consistency | Batch boundary follows the composer component. |
| AC-UXA-010 | `pages/project-detail/__tests__/TasksTab.bahasa.test.tsx` | `…/tasks` × state-coverage/cross-screen consistency | Static `task.status.*` across task representations. |
| AC-UXA-011 | `pages/project-detail/__tests__/WorkOrdersTab.bahasa.test.tsx` | `…/work-orders` × action-completeness/cross-screen consistency | Retain catalogue borrowing and safeguards. |
| AC-UXA-012 | `pages/project-detail/tabs/__tests__/BillingTab.bahasa.test.tsx` | `…/billing` × action-completeness/cross-screen consistency | Translate consequence text, not amounts. |
| AC-UXA-013 | `pages/project-detail/tabs/DocumentsTab.bahasa.test.tsx` | `…/documents` × state-coverage/cross-screen consistency | File/lifecycle safeguards survive translation. |
| AC-UXA-014 | `src/components/history/__tests__/RecordHistory.test.tsx` | `…/history` × state-coverage/cross-screen consistency | History values are not UI copy. |
| AC-UXA-015 | `pages/Meetings.test.tsx` | `/meetings` × state-coverage/cross-screen consistency | Empty vs zero-match and validation stay distinct. |
| AC-UXA-016 | `pages/MeetingDetail.bahasa.test.tsx` | `/meetings/:id` × state-coverage/cross-screen consistency | Include real minutes/action children, not mocks. |
| AC-UXA-017 | `pages/__tests__/SalesInvoices.vocabulary.test.tsx` | `/sales-invoices` rail/page × cross-screen consistency | One sales-invoice noun, one dictionary. |
| AC-FIN-002 | `src/components/shell/__tests__/breadcrumb.locale.test.tsx` | `/sales-invoices`, `/incoming-payments`, `/revenue-by-project` × cross-screen consistency | Amend existing rendered-label test; path-resolution test is supporting. |

## Error handling

| Condition | Required presentation |
|---|---|
| Fetch failure / unknown count | Localized existing retry/unavailable state; never turn failure into empty/zero. |
| Validation / refused mutation / dirty leave | Localized existing field/summary/remedy/confirmation; retain inputs and safeguards. |
| Missing record / read-only | Localized existing state; no new action or authority. |

## Discover, exclusions and implementation checklist

- Manual Discover only: agent-browser screenshots judged by the Director at **1440×900 and 390×844 × en/id**. Use rich local PM/Engineer/Executive fixtures for each dashboard row, PM pipeline + won/internal projects for header/every tab, Finance for Billing/invoice navigation, PM/Admin Meetings and a read-only viewer. Capture populated plus each applicable table state via controlled local fixtures; include the approval tile's five states. Record state/persona/locale/viewport and result, not just filenames. No new Playwright visual gate or label-only e2e.
- Out: purchases and workforce routes/forms (batch B), FinanceDashboard/AccountingSnapshotsSection, new shell discovery/permissions, task queue redesign, phase-help/calendar-identity behavior (wave 2c), workflow/reviewer changes, money/risk/progress recalculation, schemas and API changes. Existing shell fixes from UXD-A-002 remain intact.
- Likely touched: scoped sources in the surface table; shared status hooks/task-label seam; catalogue pair/launch manifest; owning test files above. No test or application edits are made by this specification.
- [ ] Obtain owner sign-off; plan exact static keys and branch fixtures, write each AC's failing owning test, then localize.
- [ ] Extend launch scope for dashboard, minutes/action and other newly included delegated sources; pass `npm run check:i18n` and scoped local gates per CLAUDE.md.
- [ ] Amend AC-FIN-002 explicitly; retain existing shell and lifecycle journeys unchanged as supporting coverage.
- [ ] Complete manual matrix, add every row's decision note + test/cell to the QA graduation registry, and graduate any new Discover findings before acceptance.
