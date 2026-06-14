# Complementary Audit — Dimensions Not Covered by the Action-Completeness Census

> **Why this exists.** The action-completeness census (`2026-06-14-jtbd-census.md`) ran a single oracle ("then what?"). To honor "find as many as possible," this complementary pass runs five more oracles the first did **not** cover: **state-coverage** (loading/error/empty correctness), **a11y** (WCAG-AA), **data-correctness** (money, dates, derived values), **mobile-390** (touch targets, overflow at 390px), and **error-resilience** (mutation-failure handling). Read-only, source-verified. Run: 2026-06-15, 5 parallel dimension sweeps + synthesis (`jtbd-broad-audit` workflow). **25 findings, none dropped — including 1 critical production money bug.** This is the **fix-wave-2** queue.

---

## 1. Severity Rollup

| Severity | Count | Dimensions touched |
|---|---|---|
| **Critical** | 1 | data-correctness |
| **Important** | 8 | state-coverage (3), a11y (3), data-correctness (2) |
| **Minor** | 16 | state-coverage (3), a11y (2), data-correctness (4), mobile-390 (3), error-resilience (4) |
| **Total** | **25** | — |

| Dimension | Critical | Important | Minor | Total |
|---|---|---|---|---|
| state-coverage | 0 | 3 | 3 | 6 |
| a11y | 0 | 3 | 2 | 5 |
| data-correctness | 1 | 2 | 3 | 6 |
| mobile-390 | 0 | 0 | 3 | 3 |
| error-resilience | 0 | 1 | 4 | 5 |

**Two recurring root-cause classes account for 9 of the 25 findings:**
- **False-empty/false-zero on fetch error** (6): hooks read `data`/`isPending` but never `isError` → a failed read renders a confident empty/zero state with no Retry.
- **Date-only UTC off-by-one** (3): date-only `YYYY-MM-DD` parsed as UTC midnight → display + exports shift one day back for behind-UTC users; the canonical `formatDate`/`parseLocalDate` guards are bypassed.

---

## 2. Top risks (real production bugs)

1. **[CRITICAL · data-wrong] At-risk count & budget-utilization read the stale stored `projects.budget`, never the derived Active-budget-version total.** `0009_dashboard_margin.sql:65` / `0027:37-44` / `0026:40`; `OverviewTab.tsx:64,66,69,79`. Same class as the `projects.spent='Actual $0'` bug that migration 0032 fixed — `budget` never got the derived-from-line-items fix. Any project whose budget lives in budget-version line-items but whose stored `projects.budget` is still 0 is silently **excluded** from `projects_at_risk` (the `budget > 0` filter), util% computes 0% (div-by-zero→0) hiding real overruns, and lists show "$X of $0 budget." Needs migration **0033** + pgTAP **0075** mirroring 0074.
2. **[IMPORTANT · silent no-op] MyTasks status change has NO error handling** — `MyTasks.tsx:175` + `useMyTasks.ts:90-96`. No `onError`; on RLS/stale/network failure the field shows the new value then silently reverts on refetch with zero feedback. The exact silent-no-op class ADR-0017's `classifyMutationError` was promoted to kill.
3. **[IMPORTANT · data-wrong, 3 sites/1 root] Date-only off-by-one in behind-UTC timezones.** `ProjectDetailHeader.tsx:45`, `OverviewTab.tsx:31`, `toWorkbookBuffer.ts:43` (exported xlsx!), win-rate boundaries (`dashboard.ts:110-111`). Canonical `formatDate`/`parseLocalDate` exist but are bypassed.

---

## 3. Per-Dimension Exhaustive Findings

### 3.1 state-coverage

| Sev | Title | Location | Evidence → Impact | Fix |
|---|---|---|---|---|
| **important** | CompanyContactsList false "No contacts yet" on fetch error | `CompanyDetail.tsx:375-410` | `useContactsByCompany` reads only `isPending`+`data`; on error → `?? []` → renders "No contacts yet". Siblings branch on `isError`. → transient failure makes a company look contactless; duplicate-contact risk. | Pull `isError`+`refetch`; error branch before empty → `<ListState variant="error" onRetry={refetch}/>`. |
| **important** | WinRateCard masks fetch error as "No closed projects in this window" | `WinRateCard.tsx:64-100` | `useWinRate` reads only `data`; error → total 0 → empty state. → exec told no closed deals during a transient RPC failure. | Add `isError`+`refetch`; branch before `total===0`. |
| **important** | PM dashboard KPI band shows 0 / $0 / 0 at-risk on projects fetch error | `PMDashboard.tsx:58-79` | KPI band passes only `loading={isPending}`; on error renders literal 0/$0/0. `KPITile` has no error prop. | `error?` prop on KPITile → "—"; gate band on `isError`. |
| minor | SalesPipeline drops "Lost" scope on lost-deals fetch error | `SalesPipeline.tsx:71` | `useLostDeals` reads only `data`; error → "No lost projects". | Read `isError`; error state on Lost/Needs-attention scopes. |
| minor | Exec mobile approval count under-reports on fetch error | `ExecutiveDashboard.tsx:44-53`, `AwaitingApprovalTile.tsx:46-60` | counts default to 0 on error → "nothing waiting". | Gate the count on contributing queries' `isError` → "—". |
| minor | Projects "Actual/Budget used/Progress" cells spin "…" forever on delivery-summary error | `Projects.tsx:109,303-353` | `useProjectsDeliverySummary` reads `isPending` not `isError`; error indistinguishable from loading. | Read `isError`; distinct cell affordance. |

### 3.2 a11y

| Sev | Title | Location | Fix |
|---|---|---|---|
| **important** | Budget add-line-item Description & Amount inputs have no accessible name (placeholder-only) | `ProjectBudget.tsx:299-305, 308-315` | Add `aria-label="Line item description"` / `"Line item amount"` (mirror the add-row Category select). |
| **important** | New budget-version name input has no accessible name | `ProjectBudget.tsx:844-851` | Add `aria-label="Version name"`. |
| **important** | ProjectStatusControl popover lacks focus mgmt, Esc-close, aria-expanded | `ProjectStatusControl.tsx:101-146` | Add `aria-haspopup`/`aria-expanded`; focus-into + Esc + outside-click + restore (reuse ConfirmDialog/Combobox). App-wide (every row + card). |
| minor | Hidden Documents file `<input>` has no accessible name | `DocumentsTab.tsx:580-586` | Add `aria-label="Upload a document"`. |
| minor | ViewToggle uses role=tablist/tab without tabpanels for filter/scope uses | `ViewToggle.tsx:64-114`, `WinRateCard.tsx:83-92` | For non-tab uses → `role="group"` + `aria-pressed` (or radiogroup). |

### 3.3 data-correctness

| Sev | Title | Location | Fix |
|---|---|---|---|
| **critical** | At-risk & budget-utilization use stale stored `projects.budget`, never the derived Active-version total | `0009:65` / `0027:37-44` / `0026:40`; `OverviewTab.tsx:64,66,69,79` | Make budget derived everywhere consumed as money/at-risk: in 0009/0027 `projects_at_risk` + `active`/`spent` CTEs use Σ Active-version line_items (subquery already in the pipeline lens); 0026 `get_projects_delivery` same; OverviewTab feed `useProjectBudget`. Migration 0033 + pgTAP 0075 mirroring 0074 + guard test. |
| **important** | Date-only fields via `new Date(iso).toLocaleDateString()` shift a day behind-UTC, bypass `formatDate` | `ProjectDetailHeader.tsx:45`, `OverviewTab.tsx:31` | Delete local `fmtDate`; import `formatDate` from `@/src/lib/format`. |
| **important** | Exported xlsx date cells shift to previous day behind-UTC | `toWorkbookBuffer.ts:43` (from `Incidents.tsx:118`) | Parse ISO as local midnight (`parseLocalDate`) before `cell.value`. |
| minor | Win-rate boundaries via `toISOString().slice(0,10)` drift a day near midnight non-UTC | `dashboard.ts:110-111`, `WinRateCard.tsx:13,24,30,34` | Format boundary with a local-date formatter for both RPC param + cache key. |
| minor | `formatCompactCurrency` doesn't compact negatives | `format.ts:61-65` | Compact on magnitude, re-apply sign. |
| minor | Two opposite 'variance' sign conventions | `budget-snapshot.ts:34` vs `dashboard.ts:137` / `FinanceDashboard.tsx:148-164` | Pick one (recommend `spent - budget`, positive = over) or rename headroom/overrun. |

### 3.4 mobile-390

| Sev | Title | Location | Fix |
|---|---|---|---|
| **important** | Milestone "⋯" menu trigger is a raw 32px button, sub-44px tap area | `MilestoneStrip.tsx:451-458` | Add `.touch-target` (or use `<Button iconOnly>`). |
| minor | ImportWizard preview table `overflow-hidden` clips wide columns | `ImportWizard.tsx:311-312` | `overflow-x-auto` (match LineItemsSection). |
| minor | ContextBar impersonation trigger raw 32px without touch-target | `ContextBar.tsx:102-112` | Add `.touch-target`. |

### 3.5 error-resilience

| Sev | Title | Location | Fix |
|---|---|---|---|
| **important** | MyTasks status change has NO error handling — failed writes silently lost | `MyTasks.tsx:175`, `useMyTasks.ts:90-96` | Add `onError` → `classifyMutationError` + toast (mirror TasksTab.tsx:115-122); `disabled={isPending}`. |
| minor | MyTasks status SelectField allows overlapping mutations | `MyTasks.tsx:170-179` | `disabled={updateStatus.isPending}`. |
| minor | Concurrent doc uploads: one completion clears ALL progress bars | `useFileUpload.ts:98,109` | `clearProgress(variables.docId)` not `setProgress({})`. |
| minor | Single-row timesheet approve toast uses raw `err.message` | `ApprovalsQueue.tsx:197`, `Timesheets.tsx:510,632` | Route through `classifyMutationError`. |
| minor | "Revise this week" action has no in-flight lockout (double-click) | `Timesheets.tsx:626-635,646` | Disable/guard while `reopen.isPending`. |

---

## 4. Fix-Wave-2 Backlog (prioritized)

**TIER 0 — real production bugs (do first):**
- **W2-1 — Derived-money correctness (CRITICAL):** `projects.budget` stale → wrong money + invisible at-risk projects. Migration **0033** + pgTAP **0075** (mirror 0074) + guard test. Highest blast radius.
- **W2-2 — Silent mutation no-op:** MyTasks `onError` + pending lockout.
- **W2-3 — Date-only UTC off-by-one (3 sites/1 root):** route header/OverviewTab/xlsx-export/win-rate through `formatDate`/`parseLocalDate`.
- **W2-4 — False-empty/false-zero on fetch error (6 sites/1 root):** read `isError`+`refetch`, branch before empty/zero; `KPITile` error prop.

**TIER 1 — important, non-data-wrong:**
- **W2-5 — Form-field accessible names:** budget add-line Desc/Amount, new-version name, hidden file input.
- **W2-6 — Overlay focus/keyboard:** ProjectStatusControl popover (Esc/focus/aria-expanded).
- **W2-7 — Touch-target ≥44px:** Milestone ⋯ menu, ContextBar impersonation.

**TIER 2 — minor polish / latent traps:**
- **W2-8** error-message quality / double-submit (ApprovalsQueue classify, Revise lockout, doc-upload progress).
- **W2-9** formatting / variance sign (compact-currency negatives, variance convention).
- **W2-10** ViewToggle ARIA role accuracy.
- **W2-11** ImportWizard preview overflow-x.

**Sequencing:** W2-1 → W2-2 → W2-3 → W2-4 clear all data-wrong/job-blocking material; W2-5–W2-7 the remaining importants; W2-8–W2-11 batchable. W2-1 and the W2-3 export fix each warrant a pgTAP/unit proof.
