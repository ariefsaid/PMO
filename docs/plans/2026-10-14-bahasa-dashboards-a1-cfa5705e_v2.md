# Plan — Bahasa dashboards, approvals tile, and Sales Invoices noun (UXS-006 A1)

## Scope and design

Implement only **AC-UXA-001, AC-UXA-002, AC-UXA-003, AC-UXA-004, AC-UXA-017, and amended AC-FIN-002**. The change is a presentation-only i18n slice: it adds static parser-visible `t('literal.key', fallback)` calls and matching real `en`/`id` catalogue entries. It must not alter routes, links, raw enums, query inputs, analytics names, role/SoD/RLS behavior, metric data, risk population/threshold, or make network requests.

The existing i18next catalogue is the single dictionary. Dashboard leaves retain the existing component/data boundaries: pages supply already-computed values, child visualizations receive localized display labels while their `hrefFor` callbacks retain the raw status enum, and status/action writes continue to use stored enums. No schema, repository, cache, API, or ADR change is warranted.

Use the current DESIGN.md dashboard molecules unchanged: `KPITile`, `ListState`, card geometry, tabular figures, status dot-plus-label presentation, existing focus rings, and the one-primary-action layout. This is copy localization, not a redesign. The implementation must retain distinct loading, empty, error, zero, one, and many states; in particular approval-query failure remains an unavailable em dash rather than a count of zero.

### Catalogue key plan

Add only literal, static keys under the existing `dashboard` namespace (and retain existing `shell.nav.salesInvoices` / `financeCopy.salesInvoices`):

- `dashboard.pm.*` for PM page head, KPI labels/help/link names, BvA/status headings, error/empty states, risk badge and unset margin; project statuses use the existing `useProjectStatusLabel()` mapping, not a duplicate map.
- `dashboard.engineer.*` for page/KPI/card/state/CTA labels, `day.sun`…`day.sat`, and entry/hours spoken labels. Reuse the existing static `timesheets.status.Draft|Submitted|Approved|Rejected` keys for the displayed status; raw statuses remain the `StatusPill` input and raw dates/values remain data.
- `dashboard.kpi.awaitingApproval.{label,helpWithTimesheets,helpProcurementOnly,unavailable,zero,one,many,linkUnavailable,linkOne,linkMany,review}`. Count interpolation uses `count`; link strings use the resolved `label`, so an explicit `label` prop remains verbatim rather than being replaced by the default.
- `dashboard.winRate.*`, `dashboard.bva.*`, `dashboard.projectedMargin.*`, `dashboard.procurementStatus.*`, and `dashboard.chartFrame.*` for the remaining Executive widgets’ headings, selector names, result/spoken summaries, status labels, and state copy. Existing `dashboard.*` keys remain their existing keys rather than being duplicated.

Use English defaults equal to current user-visible English. Add the approved Bahasa glossary terms, including **Dashboard saya**, **Catat jam kerja minggu ini**, **Menunggu persetujuan Anda**, **Tinjau**, and **Faktur Penjualan**. Preserve user-authored project names, notes, and codes verbatim.

## File inventory

**Production/catalogue/manifest**

- `pmo-portal/src/components/dashboard/PMDashboard.tsx`
- `pmo-portal/src/components/dashboard/EngineerDashboard.tsx`
- `pmo-portal/src/components/dashboard/AwaitingApprovalTile.tsx`
- `pmo-portal/src/components/dashboard/BvACard.tsx`
- `pmo-portal/src/components/dashboard/WinRateCard.tsx`
- `pmo-portal/src/components/dashboard/ProjectedMarginBars.tsx`
- `pmo-portal/src/components/dashboard/StatusBarChart.tsx`
- `pmo-portal/src/components/dashboard/ChartFrame.tsx`
- `pmo-portal/src/components/ui/EntryList.tsx`
- `pmo-portal/src/components/ui/HoursBar.tsx`
- `pmo-portal/src/components/ui/ListState.tsx`
- `pmo-portal/components/DeliveryPctChip.tsx`
- `pmo-portal/pages/ExecutiveDashboard.tsx`
- `pmo-portal/public/locales/en/common.json`
- `pmo-portal/public/locales/id/common.json`
- `pmo-portal/src/lib/i18n/launch-scope-routes.txt`

Existing localized Executive leaves (`MobileExecutiveDashboard.tsx`, `StillToInvoiceCard.tsx`, `AtRiskProjectsLink.tsx`, and `BoardPackAction.tsx`) stay on their current literal-key `t()` calls; include them in the launch manifest so the gate covers them. `Rail.tsx`, `SalesInvoices.tsx`, and `routeMatch.ts` already consume the two sales-invoice label keys; the only product change for the noun is the Bahasa `shell.nav.salesInvoices` value.

**Canonical owning tests**

- `pmo-portal/src/components/dashboard/PMDashboard.test.tsx` — AC-UXA-001
- `pmo-portal/src/components/dashboard/EngineerDashboard.test.tsx` — AC-UXA-002
- `pmo-portal/pages/__tests__/ExecutiveDashboard.bahasa.test.tsx` (new) — AC-UXA-003
- `pmo-portal/src/components/dashboard/AwaitingApprovalTile.test.tsx` — AC-UXA-004
- `pmo-portal/pages/__tests__/SalesInvoices.vocabulary.test.tsx` (new) — AC-UXA-017
- `pmo-portal/src/components/shell/__tests__/breadcrumb.locale.test.tsx` — AC-FIN-002 (amended)

**Graduation evidence**

- `docs/qa-portfolio.md`
- `docs/decisions.md`

## TDD implementation tasks

> Run all Vitest commands from `pmo-portal/` under `../scripts/with-test-lock.sh`. Every test below must import/render the shipped component/page and use `pmo-portal/test/bahasa.tsx`'s real-catalogue `BahasaProvider` (or an equivalent isolated real-catalogue `en` provider), changing locale by provider state—not by mocking `t()`.

1. **Prepare PM dashboard’s real-catalogue red test for AC-UXA-001.**
   - **File:** `pmo-portal/src/components/dashboard/PMDashboard.test.tsx`
   - Add a locale-aware `renderPane(locale)` wrapper around the shipped `PMDashboard`, using the real-catalogue `BahasaProvider` for `id` and retaining its router, hook mocks, real `KPITile`, and current numeric fixtures.
   - First add one `it('AC-UXA-001: ...')` that renders Bahasa populated data and asserts exact localized page head (`Dashboard saya`), KPI heading/help/link names, localized project status labels (including `Won, Pending KoM` → `Menang — menunggu rapat awal`), `At risk`, BvA/status headings and the localized `Not set` margin while asserting the contract total, risk count, project link hrefs, and raw fixture statuses are unchanged. Extend the same owning test through pending, error, and empty fixtures; assert the existing skeleton/retry/empty branches have Bahasa text and no English system label.
   - **Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/components/dashboard/PMDashboard.test.tsx`

2. **Localize PM system copy and reuse the canonical project-status hook.**
   - **Files:** `pmo-portal/src/components/dashboard/PMDashboard.tsx`, `pmo-portal/components/DeliveryPctChip.tsx`, `pmo-portal/src/components/ui/ListState.tsx`
   - Add `useTranslation()` and replace every PM-authored display/help/accessible string with literal `dashboard.pm.*` keys. Pass `retryLabel={t('common.retry', 'Retry')}` only if a shared retry key already exists; otherwise add/use the literal PM retry key so `ListState` never retains its English default in the scoped error branch.
   - Call `useProjectStatusLabel()` once and render `statusLabel(p.status)` in the status pill; leave `p.status` unchanged for `pillVariantForProjectStatus`, active/risk predicates, list identity, and URLs. Keep project names and values as raw data.
   - In `DeliveryPctChip`, replace its fixed `Delivery {{rounded}}%` spoken label with a literal `dashboard.delivery.percent` key; in `ListState`, replace its fixed screen-reader loading and default retry strings with literal `ui.listState.loading` and `ui.listState.retry` keys. Preserve its state markup, roles, callback, and layout.
   - **Files:** `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`
   - Add the exact paired `dashboard.pm.*`, `dashboard.delivery.percent`, and `ui.listState.{loading,retry}` entries using the approved glossary and unchanged English fallbacks.
   - **Verify (green):** rerun task 1’s command; it passes with all pre-existing PM behavior tests still green.

3. **Prepare Engineer dashboard’s real-catalogue red test for AC-UXA-002.**
   - **File:** `pmo-portal/src/components/dashboard/EngineerDashboard.test.tsx`
   - Extend `renderPane` to accept a real-catalogue locale via `BahasaProvider`. Add one `it('AC-UXA-002: ...')` that covers a populated draft week in Bahasa: page title/subtitle, the `Catat jam kerja minggu ini` CTA and link name, KPI labels/help, translated Draft pill, `week of` label, all seven displayed/day spoken labels, per-project and recent-entry headings, empty note/unknown fallbacks, and the hours count/progress values.
   - In the same owning test switch the fixtures through approved week, pending, query error, no current week, zero-hours week, and no recent entries; assert their specific translated visible/spoken state labels and existing `/timesheets` destination without changing fixture enums, dates, hours, or retry action.
   - **Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/components/dashboard/EngineerDashboard.test.tsx`

4. **Localize Engineer system copy without changing timesheet data or navigation.**
   - **Files:** `pmo-portal/src/components/dashboard/EngineerDashboard.tsx`, `pmo-portal/src/components/ui/EntryList.tsx`, `pmo-portal/src/components/ui/HoursBar.tsx`
   - Replace `DAY_LABELS` with static day-key translation calls; add a component-local static map that calls the existing literal `timesheets.status.Draft|Submitted|Approved|Rejected` keys, passing the original status to `workflowVariant`. Translate the page head, CTA, KPI labels/help/link labels, current-week comparison prefix, card/group headings, all explicit error/empty/action copy, per-day progressbar name, and numeric-hours unit name.
   - Make `EntryList` translate its empty state, `No note`, and `Unknown` fallbacks while preserving entry dates, user notes when present, project names/codes, and numeric hours. Give `HoursBar` a translated static unit/formatter path so its visual `h` amount and progressbar accessible name agree in the active locale without changing numbers or bar widths.
   - **Files:** `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`
   - Add paired `dashboard.engineer.*` keys, including static `day.*` keys; reuse the existing `timesheets.status.*` map rather than creating duplicate status strings, and do not use dynamic translation keys.
   - **Verify (green):** rerun task 3’s command.

5. **Write the approval-tile locale/state matrix red for AC-UXA-004.**
   - **File:** `pmo-portal/src/components/dashboard/AwaitingApprovalTile.test.tsx`
   - Make `renderTile(includeTimesheets, locale, label?)` use the real catalogues. Add one `it('AC-UXA-004: ...')` that table-drives both `includeTimesheets` branches through loading, procurement error, relevant-timesheet error, zero, one, and many counts in Bahasa; assert the default visible label, help, visible `Tinjau`, full `/approvals` link accessible name, and unavailable-versus-zero distinction.
   - Render a second instance with an explicit label override in the same test and assert that exact override is retained in both visible tile label and spoken link name while the Bahasa suffix/action text remains localized. Retain existing assertions that query errors show `—`, no timesheet error affects the procurement-only branch, counts stay role/SoD-scoped, and `/approvals` is unchanged.
   - **Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/components/dashboard/AwaitingApprovalTile.test.tsx`

6. **Localize the shared approval tile through neutral static KPI keys.**
   - **File:** `pmo-portal/src/components/dashboard/AwaitingApprovalTile.tsx`
   - Add `useTranslation()`. Resolve the default label with `dashboard.kpi.awaitingApproval.label`, but retain a supplied `label` prop verbatim. Replace both branch-specific help strings, unavailable/zero/one/many `vs` copy, the spoken link name, and CTA with the literal static keys in the catalogue key plan; use `count` interpolation only for one/many. Do not change query execution, pending/error booleans, `pendingProcurementApprovals`, `can()`, count arithmetic, tone, or `/approvals`.
   - **Files:** `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`
   - Add the paired neutral `dashboard.kpi.awaitingApproval.*` keys; Bahasa uses the approved `Menunggu persetujuan Anda` and `Tinjau` terms.
   - **Verify (green):** rerun task 5’s command.

7. **Create the Executive real-catalogue red owner test for AC-UXA-003.**
   - **File:** `pmo-portal/pages/__tests__/ExecutiveDashboard.bahasa.test.tsx` (new)
   - Reuse the existing Executive test’s hook seams—dashboard/sales-pipeline/win-rate/procurement/timesheet/auth/org-currency/work-order billing/desktop breakpoint—rather than mocking Executive widgets. Render the shipped `ExecutiveDashboard` with real `en`/`id` catalogues and deterministic desktop and mobile fixtures.
   - Add one `it('AC-UXA-003: ...')` that in Bahasa asserts specific labels for desktop and mobile page head/KPIs/help/link names, Board pack (including its existing unavailable feedback), approval band, win-rate basis and period controls/result/progress/legend/empty/error, BvA labels and spoken bar summary, pipeline-margin group/summary/stage labels, procurement chart heading/figcaption/spoken summary, at-risk doorways, and Still-to-invoice populated/loading/empty/error feedback. Assert the raw project/procurement status values remain used by links and that metric figures and destinations are unchanged.
   - In the same canonical test exercise existing executive loading, dashboard error, empty, pipeline pending/error/empty, and both desktop/mobile branches. Do not add a label-scan or an e2e test.
   - **Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/ExecutiveDashboard.bahasa.test.tsx`

8. **Localize Executive page, chart widgets, and spoken summaries while preserving data semantics.**
   - **Files:** `pmo-portal/pages/ExecutiveDashboard.tsx`, `pmo-portal/src/components/dashboard/WinRateCard.tsx`, `pmo-portal/src/components/dashboard/BvACard.tsx`, `pmo-portal/src/components/dashboard/ProjectedMarginBars.tsx`, `pmo-portal/src/components/dashboard/StatusBarChart.tsx`, `pmo-portal/src/components/dashboard/ChartFrame.tsx`
   - Convert all remaining Executive system copy in these sources to literal static catalogue keys: Win Rate’s title, basis/period options, aria labels, result phrase, progress summary, legend, error/empty guidance; BvA’s group/risk/bar spoken labels; projected-margin group/one-or-many stage summary/progress labels; StatusBarChart’s computed figure summary and legend display labels; and ChartFrame default empty/error titles.
   - In `ExecutiveDashboard`, build a static, literal-key procurement-status display mapping and pass display labels to the chart while retaining raw `status` for `procurementStatusTone`, chart data identity, and `hrefFor` URL encoding. Do not change DD-RISK-1’s active-delivery source, committed-spend basis, or `>= 0.9` threshold; no money or percentage calculation changes.
   - Keep `MobileExecutiveDashboard.tsx`, `StillToInvoiceCard.tsx`, `AtRiskProjectsLink.tsx`, and `BoardPackAction.tsx` on their already literal existing keys; only correct an already-rendered fallthrough if task 7 exposes it, then add its key to both catalogues.
   - **Files:** `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`
   - Add paired `dashboard.winRate.*`, `dashboard.bva.*`, `dashboard.projectedMargin.*`, `dashboard.procurementStatus.*`, and `dashboard.chartFrame.*` entries. Preserve product/brand spellings and all numeric interpolations; Bahasa copy must not redefine a metric.
   - **Verify (green):** rerun task 7’s command, then `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/ExecutiveDashboard.test.tsx pages/__tests__/ExecutiveDashboard.mobile.test.tsx pages/__tests__/ExecutiveDashboard.approvalError.test.tsx src/components/dashboard/BvACard.test.tsx src/components/dashboard/StatusBarChart.test.tsx src/components/dashboard/ChartFrame.test.tsx`.

9. **Write both Sales Invoices noun owner tests red before changing the catalogue.**
   - **File:** `pmo-portal/pages/__tests__/SalesInvoices.vocabulary.test.tsx` (new)
   - Render the actual Finance rail plus `SalesInvoices` page in isolated `en` and `id` i18n providers with the existing revenue/permission/feature hooks mocked at their seams. Add one `it('AC-UXA-017: ...')` that asserts the rail link, page H1, and their accessible names agree as `Sales Invoices` in English and `Faktur Penjualan` in Bahasa, with the real `/sales-invoices` href.
   - **File:** `pmo-portal/src/components/shell/__tests__/breadcrumb.locale.test.tsx`
   - Amend its canonical `it('AC-FIN-002: ...')` expected Bahasa Sales Invoices breadcrumb from `Invoice Penjualan` to `Faktur Penjualan`, retaining the existing exact assertions for Incoming Payments, Revenue by Project, and no `Not found` part.
   - **Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/SalesInvoices.vocabulary.test.tsx src/components/shell/__tests__/breadcrumb.locale.test.tsx`

10. **Correct the one shared Bahasa sales-invoice navigation noun.**
   - **File:** `pmo-portal/public/locales/id/common.json`
   - Change only `shell.nav.salesInvoices` from `Invoice Penjualan` to `Faktur Penjualan`. Leave `financeCopy.salesInvoices` (already `Faktur Penjualan`) and the other Finance `shell.nav.*` labels unchanged. Do not change `Rail.tsx`, `SalesInvoices.tsx`, or `routeMatch.ts`: they already reuse the shell/page keys and the shared breadcrumb mapping.
   - **Verify (green):** rerun task 9’s command.

11. **Expand the launch-scope manifest for every A1 delegated renderer.**
   - **File:** `pmo-portal/src/lib/i18n/launch-scope-routes.txt`
   - Replace the `/` line with its existing page plus: `src/components/dashboard/PMDashboard.tsx`, `EngineerDashboard.tsx`, `AwaitingApprovalTile.tsx`, `MobileExecutiveDashboard.tsx`, `WinRateCard.tsx`, `BvACard.tsx`, `ProjectedMarginBars.tsx`, `StatusBarChart.tsx`, `StillToInvoiceCard.tsx`, `ChartFrame.tsx`, `AtRiskProjectsLink.tsx`, `src/components/reports/BoardPackAction.tsx`, `src/components/ui/EntryList.tsx`, `src/components/ui/HoursBar.tsx`, `src/components/ui/ListState.tsx`, and `components/DeliveryPctChip.tsx`.
   - Extend the existing `/sales-invoices` line with `src/components/shell/Rail.tsx` and `src/components/shell/routeMatch.ts`, because the rail and breadcrumb are delegated renderers for the noun. Keep all existing files on that line.
   - **Verify:** `cd pmo-portal && npm run check:i18n`

12. **Run the scoped deterministic quality gate.**
   - **Files:** no new files.
   - Run:
     ```sh
     cd pmo-portal
     ../scripts/with-test-lock.sh npm run typecheck
     npx eslint --max-warnings=0 \
       src/components/dashboard/PMDashboard.tsx src/components/dashboard/PMDashboard.test.tsx \
       src/components/dashboard/EngineerDashboard.tsx src/components/dashboard/EngineerDashboard.test.tsx \
       src/components/dashboard/AwaitingApprovalTile.tsx src/components/dashboard/AwaitingApprovalTile.test.tsx \
       src/components/dashboard/WinRateCard.tsx src/components/dashboard/BvACard.tsx \
       src/components/dashboard/ProjectedMarginBars.tsx src/components/dashboard/StatusBarChart.tsx \
       src/components/dashboard/ChartFrame.tsx src/components/ui/EntryList.tsx src/components/ui/HoursBar.tsx \
       src/components/ui/ListState.tsx ../components/DeliveryPctChip.tsx \
       pages/ExecutiveDashboard.tsx pages/__tests__/ExecutiveDashboard.bahasa.test.tsx \
       pages/__tests__/SalesInvoices.vocabulary.test.tsx src/components/shell/__tests__/breadcrumb.locale.test.tsx
     ../scripts/with-test-lock.sh npx vitest run \
       src/components/dashboard/PMDashboard.test.tsx \
       src/components/dashboard/EngineerDashboard.test.tsx \
       src/components/dashboard/AwaitingApprovalTile.test.tsx \
       pages/__tests__/ExecutiveDashboard.bahasa.test.tsx \
       pages/__tests__/SalesInvoices.vocabulary.test.tsx \
       src/components/shell/__tests__/breadcrumb.locale.test.tsx
     npm run check:i18n
     ```
   - Treat any red result, type error, lint warning, missing English key, missing Bahasa value, or orphaned key as incomplete; fix application/catalogue code rather than weakening or skipping tests.

13. **Perform the required bounded rendered Discover pass and graduate only confirmed findings.**
   - **Artifacts:** save screenshots and the matrix record under `adws/adw_data/sessions/cfa5705e/context_handoff/screenshots/`; do not add label-only Playwright coverage.
   - With rich deterministic PM, Engineer, Executive, and Finance fixtures, render PM, Engineer, and Executive dashboards plus the Sales Invoices rail/page at **1440×900** and **390×844**, in **en** and **id**. Inspect populated and existing loading/empty/error branches, the approval tile loading/error/zero/one/many branches in both count modes, wrapping/overflow, 32px controls, focus-visible keyboard path, accessible names, chart spoken summaries, numeric alignment, and unchanged destinations/metric values.
   - Run the required one-shot Impeccable detector after the UI is complete:
     ```sh
     /Users/ariefsaid/Coding/PMO/.claude/skills/impeccable/scripts/impeccable detect --json \
       pmo-portal/src/components/dashboard/PMDashboard.tsx \
       pmo-portal/src/components/dashboard/EngineerDashboard.tsx \
       pmo-portal/src/components/dashboard/AwaitingApprovalTile.tsx \
       pmo-portal/src/components/ui/ListState.tsx pmo-portal/components/DeliveryPctChip.tsx \
       pmo-portal/pages/ExecutiveDashboard.tsx \
       pmo-portal/pages/SalesInvoices.tsx
     ```
   - For each confirmed Discover defect only: first add a focused regression in that AC’s canonical owning test (or a new test only if it is a distinct defect class), fix it within A1 scope, add the affected `/` or `/sales-invoices` route × oracle cell and test path to `docs/qa-portfolio.md`, add one concise durable localization/visual rule to `docs/decisions.md` only when it is a reusable decision, then rerender the affected matrix cell. Do not record preferences as defects.

14. **Record A1’s planned graduation evidence after a clean Discover pass.**
   - **Files:** `docs/qa-portfolio.md`, `docs/decisions.md`
   - Add compact completed rows/cells for the six A1 ACs, citing their sole owning test files and the affected route/oracle pairs: `/` PM state coverage/cross-screen consistency; `/` Engineer state coverage/cross-screen consistency; `/` Executive desktop/mobile cross-screen consistency; approvals tile state coverage; `/sales-invoices` rail/page cross-screen consistency; and the three Finance breadcrumb routes cross-screen consistency.
   - In `docs/decisions.md`, add only the spec-prescribed retention facts: dashboard role copy includes help/states; Engineer spoken week/status labels share the locale; delegated Executive copy is launch scope; approvals use neutral KPI keys and unavailable is not zero; Sales Invoices has one catalogued noun; and Finance breadcrumb labels resolve through the shared shell key. Do not create an ADR.
   - **Verify:** `git diff --check && cd pmo-portal && npm run check:i18n`

## Acceptance traceability

| AC | Sole automated owner | Tasks |
| --- | --- | --- |
| AC-UXA-001 | `pmo-portal/src/components/dashboard/PMDashboard.test.tsx` | 1–2 |
| AC-UXA-002 | `pmo-portal/src/components/dashboard/EngineerDashboard.test.tsx` | 3–4 |
| AC-UXA-003 | `pmo-portal/pages/__tests__/ExecutiveDashboard.bahasa.test.tsx` | 7–8 |
| AC-UXA-004 | `pmo-portal/src/components/dashboard/AwaitingApprovalTile.test.tsx` | 5–6 |
| AC-UXA-017 | `pmo-portal/pages/__tests__/SalesInvoices.vocabulary.test.tsx` | 9–10 |
| AC-FIN-002 (amended) | `pmo-portal/src/components/shell/__tests__/breadcrumb.locale.test.tsx` | 9–10 |

No ADR, migration, RLS change, backend request, new cache, new route, or e2e spec is planned. All remaining UXS-006 ACs are explicitly deferred to A2–A5.
