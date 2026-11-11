# One definition per figure — investigation and planning draft

**Status: Planning input for a spec.** C §4 and the earlier local review are the brief, not an approved specification. Runtime observations below are from the review; this investigation reads code only and does not establish the captured records' actual contents. The Director must resolve the decisions below and obtain a spec with acceptance criteria before implementation.

**Global constraints:** preserve unknowns, currencies and role-scoped populations. Distinct business measures must have distinct labels. Any money calculation, source synchronization or authorization change ships alone with money/SoD review. No implementation, migrations or tests are part of this draft.

## 1. Work-order billing, backlog and earned not invoiced (C §4.1)

These are three different defined measures, not proven variants of one value:

- **Remaining on eligible work orders:** remaining uninvoiced work-order value, net of tax, after the work-order billing rules. SQL `get_unbilled_work_orders` in `supabase/migrations/0441_work_order_acceptance_age.sql:36`, read by `pmo-portal/src/hooks/useWorkOrderBilling.ts:20` and `pmo-portal/src/lib/db/workOrderBilling.ts:172`; `pmo-portal/src/components/dashboard/restructure/useCompanyFigures.ts:347` formats totals and returns zero if the result is complete and empty. Executive home `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx:218,287` calls it “Still to invoice”; the review saw $0. Finance's work-order card is `pmo-portal/src/components/dashboard/StillToInvoiceCard.tsx:21`. The captured work orders and their current billing rows are needed to establish why the observed number is zero.
- **Backlog:** net contract value less recognised revenue, with an unknown result where reconciliation is incomplete. The server pack facts originate in `supabase/migrations/0810_pack_earned_value.sql:112,172`; the browser derives the value in `pmo-portal/src/lib/reports/managementPack.ts:138,166,167`. Reports shows this at `pmo-portal/pages/ManagementPack.tsx:459`; the review saw $25.4M. Contract less invoiced is *not* the implemented definition of backlog.
- **Earned, not invoiced:** recognised revenue less invoiced revenue, possibly negative, grouped by currency. The server pack/earned source is `supabase/migrations/0810_pack_earned_value.sql:12,288,309`; browser report arithmetic is `pmo-portal/src/lib/reports/managementPack.ts:138,166`; Finance hub renders the server pack at `pmo-portal/pages/finance/FinanceHub.tsx:55,98`, and Reports renders its corresponding definition at `pmo-portal/pages/ManagementPack.tsx:440`. Reconciliation between SQL and browser paths needs a targeted cross-source proof; it must not be presumed from matching labels.

**Rulings:** `docs/decisions.md:3033` (DD-MMP-3: signed differences, not clamped); `docs/decisions.md:3165` (DD-BWO-1 and DD-BWO-10: work-order billing and dashboards); `docs/decisions.md:3182` (distinct work-order and claim measures retain different labels). Prior-art searches: “Still to invoice”, “Reports no progress vs project progress”, “completed/unbilled versus work-order zero”.

**Class (a):** change `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx` and corresponding locale keys to “Still to invoice on work orders”, linking to the existing work-order billing home. Keep Reports' and Finance's distinct labels and existing definitions. A worker must add a failing component assertion that an empty complete work-order set displays $0 with that explicit scope and that an incomplete set is unknown; run the relevant dashboard test file, implement the label, then run it again. Any replacement with a contract-minus-invoiced measure is **(c)**: first define eligibility, recognition, currency, date and unknown rules with the owner; then review a server-side position and all consumers, shipping alone with money/SoD review.

## 2. Project overdue count (C §4.2)

- **Executive attention count:** number of overdue tasks + overdue milestones + overdue invoices per project. `supabase/migrations/0770_dashboard_pmo_positions.sql:303,325,383` computes each population using the organisation day and returns the sum. `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx:83,92` displays the sum as “overdue”; the review saw 12 for one project. It is a count of items, not a task-only count.
- **PM project task count:** open, dated tasks on the PM's projects, with end date before organisation day. The browser filters `repositories.task.listDueRows` in `pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts:307,436`; `pmo-portal/src/components/dashboard/PMDashboard.tsx:81,85,201` presents task counts. The review saw 9 for the same project. Compare the task predicate and row populations before claiming equality with the SQL task component.
- **Project late phases:** started phases with a past target and less than 100% effective progress; browser calculation in `pmo-portal/src/hooks/useProjectPosition.ts:229,235` and `pmo-portal/pages/project-detail/MilestoneStrip.tsx:33`. The review saw three phases late. `pmo-portal/pages/project-detail/ProjectActivity.tsx:53,60` separately counts the current person's overdue tasks. These are different populations and units.

**Class (a):** in `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx` and its locale keys label the executive sum “overdue items” and provide a task/phase/invoice breakdown from the returned fields; preserve PM and phase labels. Add component assertions for a task + phase + invoice fixture and for zero counts, then run the touched dashboard test. **Class (b) requires a decision:** if the owner wants the same *task-only* count on both dashboards, expose the SQL task component through a shared typed selector and align the PM predicate/population; test archived and subtasks, organisation midnight, pending/error, and role scope. UI worker files are `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx`, `pmo-portal/src/components/dashboard/PMDashboard.tsx`, `pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts`, and a shared selector under `pmo-portal/src/lib/`. If SQL semantics change, review the RPC separately instead of silently changing the browser count. Prior-art search: “overdue tasks”.

## 3. Supplier invoice age (C §4.3)

- **Finance dashboard elapsed age:** `pmo-portal/src/components/dashboard/FinanceDashboard.tsx:41,112,123` floors elapsed 24-hour periods since `vendor_invoiced_at`, falling back to `updated_at`. The review saw 12 days.
- **Payables calendar age:** `pmo-portal/src/lib/finance/financePosition.ts:68,166` counts calendar days since the same recorded timestamp or fallback using the organisation day; `pmo-portal/pages/finance/PayablesPage.tsx:103,136,149` displays it and its basis. The review saw 13 days. `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx:234` uses the finance position for its finance tables; check actual route/consumer for the captured Finance hub before attributing its number.
- **Procurement invoice-document age:** `pmo-portal/pages/procurement/list/ProcurementKpiRow.tsx:41,64` selects the oldest unpaid invoice date or creation fallback and calls `pmo-portal/src/lib/procurement/listModel.ts:112`; the review saw 260 days. A row stage age is a separate clock at `pmo-portal/src/lib/procurement/rowDerivations.ts:41` and `pmo-portal/src/lib/procurement/stage.ts:59`. Exact captured timestamps are needed to establish each observed number.

**Class (a):** `pmo-portal/pages/procurement/list/ProcurementKpiRow.tsx`, `pmo-portal/src/components/dashboard/FinanceDashboard.tsx`, `pmo-portal/pages/finance/PayablesPage.tsx` and locale files must name invoice-document versus recorded-status dates and fallback. **Class (b), conditional on owner approval:** make the Finance dashboard use the existing `financePosition` calendar-day selector for the same recorded-status clock; test an instant 12 elapsed days but 13 organisation calendar dates old, timezone midnight, future timestamp, missing timestamp, and loading. Invoice-document and recorded-status ages remain distinct unless the owner chooses otherwise. A common accounting ageing computation is **(c)**: specify which event and calendar, migrate/report historical records consistently and review all ageing buckets and consumers in a standalone money change. Prior-art searches: “supplier invoice age” and “One supplier bill 259 vs 12 days”.

## 4. Expense transaction precision (C §4.7)

**Definition/source:** the transaction amount is the entered currency amount; `pmo-portal/pages/ExpenseClaimNew.tsx:81` parses scale 2. Expense list `pmo-portal/pages/ExpenseClaims.tsx:93`, detail `pmo-portal/pages/ExpenseClaimDetail.tsx:119` and line/total `pmo-portal/pages/expenses/ExpenseLinesCard.tsx:36,93` use browser `formatCurrency` (`pmo-portal/src/lib/format.ts:81`), which rounds to whole units. The review reports $12.50 stored and $13 shown; the earlier review reports $42.50/$43. `pmo-portal/pages/expenses/ExpenseDecisionBar.tsx:52` already uses `formatCurrencyCents` (`pmo-portal/src/lib/format.ts:914`).

**By ruling; open question for the owner: small USD claims.** Issue #1437 governs read-only displays: whole currency units, without cents. Thus $12.50 → $13 is by ruling; no change is authorized merely because of this example. Exact-cent reconciliation, tax, inputs and exports retain the existing exception (`pmo-portal/src/lib/format.ts:635`). If the owner explicitly extends that exception to expense verification, **class (b)**: use `formatCurrencyCents` in `pmo-portal/pages/ExpenseClaims.tsx`, `pmo-portal/pages/ExpenseClaimDetail.tsx`, `pmo-portal/pages/expenses/ExpenseLinesCard.tsx`; test $12.50, zero, locale and a non-USD currency on the affected surfaces. No stored amount or money computation changes. Prior-art searches: “expense rounding” and “$42.50 shown as $43”; issue #1437 was separately read.

## Open decisions for the Director

1. Which of work-order remaining, contract less earned, contract less invoiced, or earned less invoiced should be the owner's lead figure? They answer different questions and can all differ. Preserve each existing definition until decided.
2. Should home show the mixed attention count, task count, or both? A mixed count can be 12 while task-only is 9 and late phases 3. The task-only counts also need predicate/population verification before reuse.
3. Should supplier aging use date on the invoice, date recorded, or both? Calendar and elapsed days can differ by one for the same event; the dates themselves may be months apart.
4. Small USD claims: does the owner want an explicit exception to #1437 for expense verification? The current whole-unit ruling governs until changed.


## C §4 coverage in owner-visible order

Items C1, C2, C3 and C7 are the four detailed comparisons above. The rows below cover the remaining items, including observations that are not numerical contradictions. Each recorded number is an observation, not a claim about current data.

### C4. Receivables ageing and $7.7m face value

**Definition/source:** invoice face value is not an outstanding balance; only known positive balances can be grouped into ageing buckets. Browser selector `pmo-portal/src/lib/finance/financePosition.ts:95,115,118` uses invoice outstanding and due dates; `pmo-portal/src/lib/db/revenue.ts:269` reads invoice facts. Receivables `pmo-portal/pages/finance/ReceivablesPage.tsx:170` shows the balance summary while `pmo-portal/pages/sales-invoices/salesInvoiceColumns.tsx:149` shows face value; the review observed an empty ageing grouping beside an overdue face amount. **Needs runtime check:** invoice outstanding mirror, due date and recorded payments. **(a)** clarify face value versus balance and expose unknown count/recovery in `pmo-portal/pages/finance/ReceivablesPage.tsx` and `pmo-portal/pages/sales-invoices/salesInvoiceColumns.tsx`; a synchronization/balance computation change is **(c)** and needs standalone money review. See R8 and R26; prior-art search “receivables aging”.

### C5. Payment invoice picker

**Definition/source:** new-payment candidates depend on ownership mode, customer, status and outstanding rules; the separate apply-receipt selector also checks currency; the new-payment form derives candidates in the browser in `pmo-portal/pages/incoming-payments/IncomingPaymentFormModal.tsx:99,113`, while the subsequent apply-receipt form uses `pmo-portal/pages/incoming-payments/applicableInvoices.ts:4` and `ApplyReceiptForm.tsx:36`. Receivables shows the invoice at `pmo-portal/pages/finance/ReceivablesPage.tsx:88,218`; the review reports no match in the payment form. **Needs runtime check:** selected customer, currency, invoice status, balance, loaded results and exact form. **(a)** explain the actual filter and recovery in `pmo-portal/pages/incoming-payments/IncomingPaymentFormModal.tsx`; **(c)** any eligibility or settlement change requires a reviewed server/write contract and dedicated money/SoD review. Prior-art search “payment invoice picker”; see R4 and R8.

### C6. Purchase amount missing versus approval amount

**Definition/source:** request-document amount, case total and most-real list amount are distinct. Browser `pmo-portal/src/lib/procurement/procurementMoney.ts:73` prefers existing request rows; `pmo-portal/pages/procurement/computeBudgetSignal.ts:74` uses the case value. Procurement detail `pmo-portal/pages/procurement/detail/ProcurementDetailPanels.tsx:209,243` can show no recorded request amount; the approval panel `pmo-portal/pages/procurement/DecisionSupportPanel.tsx:210` shows the case-based budget signal, and list KPI is in `pmo-portal/pages/procurement/list/ProcurementKpiRow.tsx:23`. **Needs runtime check:** case and request-document amounts. **(a)** label source and missing document amount in `ProcurementDetailPanels.tsx`, `DecisionSupportPanel.tsx` and `ProcurementKpiRow.tsx`; **(c)** any synchronization needs a reviewed transactional write and money review. See R19; prior-art search “procurement value”.

### C8. Supplier count versus unnamed supplier

**Definition/source:** the Payables KPI counts distinct case vendor IDs, falling back to case ID for each unknown vendor (`pmo-portal/pages/finance/PayablesPage.tsx:128`); the displayed supplier is the case's linked company. `pmo-portal/src/lib/db/procurements.ts:64,225` reads the case vendor; `pmo-portal/pages/finance/PayablesPage.tsx:64` and `pmo-portal/src/components/procurement/ProcurementBlock.tsx:629` display it. A sample case has a missing case vendor alongside a vendor on the selected quote (`supabase/seed.sql:1161,1211,1215`). **Needs runtime check:** supplier links and the specific count population. **(d)** correct sample linkage in `supabase/seed.sql`; **(a)** distinguish unknown suppliers/count units in `PayablesPage.tsx`; **(c)** owner chooses authoritative supplier and a reviewed server write synchronizes it; ship alone. See R25; prior-art search “supplier”.

### C9. Reports bars and delivery percentage

**Definition/source:** recognised/earned revenue is commercial progress or earned-value based; project delivery is milestone-weighted. Browser report values come from `pmo-portal/src/lib/reports/managementPack.ts:138,166` and server `supabase/migrations/0810_pack_earned_value.sql:172`; `pmo-portal/pages/ManagementPack.tsx:399,554` passes contract and earned amounts to `pmo-portal/src/components/reports/ReportCharts.tsx:20,39`, where the background represents contract and coloured overlay earned. Project delivery is `pmo-portal/src/hooks/useProjectsDelivery.ts:38` / `supabase/migrations/0396_project_commitment_position.sql:364`, rendered by `pmo-portal/pages/projects/projectTableColumns.tsx:315`. The review saw a long grey bar with $0 earned and 99% earned versus 78% delivered. **(a)** label contract background and earned overlay, and name commercial versus physical basis in `pmo-portal/src/components/reports/ReportCharts.tsx`, `pmo-portal/pages/ManagementPack.tsx`; **(c)** recognition changes require reviewed server calculation, standalone. See R10; prior-art search “earned progress”.

### C10. Untouched versus recent stage

**Definition/source:** untouched age uses `last_update`, stage age uses `stage_started_at`; both are browser calculations (`pmo-portal/pages/sales/salesLogic.ts:12,24` and `pmo-portal/components/salesPipeline.ts:121,143`). Sales attention and deal detail render these via `pmo-portal/pages/sales/SalesParts.tsx:133,235` and `pmo-portal/pages/sales/DealBand.tsx:34`. The review saw 45 days untouched beside a one-day stage. **Needs runtime check:** both timestamps and their update history. **(a)** name each date basis in `pmo-portal/pages/sales/salesLogic.ts`, `pmo-portal/pages/sales/DealBand.tsx` and `pmo-portal/pages/sales/SalesParts.tsx`; **(c)** changing timestamp-maintenance semantics requires an independently reviewed write change. Prior-art search “untouched”.

### C11. Chance precision versus weighting

**Definition/source:** weighted forecast multiplies stored go/get probabilities by value; browser `pmo-portal/components/salesPipeline.ts:149,173` computes weight and formats the percentages. `pmo-portal/pages/sales/SalesParts.tsx:226,229` displays rounded labels while `pmo-portal/pages/SalesPipeline.tsx:37` shows weighted value. The review reports 2.5% displayed as 3% and 22.5% as 23%. **(a)** show enough decimal places to disclose the actual stored probability in `pmo-portal/components/salesPipeline.ts`, `pmo-portal/pages/sales/SalesParts.tsx`, `pmo-portal/pages/sales/DealParts.tsx`; retain the stored calculation. **Needs runtime check:** values used in the captured records. Prior-art search “sales chance”.

### C12. Committed category versus approval headroom

**Definition/source:** budget category commitment and reservation-only approval availability are different bases. `pmo-portal/pages/ProjectBudget.tsx:503,524,624` displays per-category commitment and total; `pmo-portal/pages/procurement/computeBudgetSignal.ts:7,72` calculates budget minus commitment and reservation without actuals, displayed in `pmo-portal/pages/procurement/DecisionSupportPanel.tsx:210`. The review saw unassigned commitment and an approval signal that did not reconcile. **Needs runtime check:** line category attribution, currency and actuals completeness. **(a)** label reservation-only basis and uncategorized position in `pmo-portal/pages/procurement/DecisionSupportPanel.tsx`, `pmo-portal/pages/ProjectBudget.tsx`; **(c)** choosing an actual-aware server position and allocation policy requires standalone money/SoD review. See R1; prior-art search “budget committed”.

### C13. Positive budget version change in red

**Definition/source:** version difference is later version total minus earlier; browser `pmo-portal/pages/project-detail/budget/BudgetVersionsDrawer.tsx:53,54` displays a positive change in red. `pmo-portal/pages/ProjectBudget.tsx:176,205` supplies versions. The review saw a positive change from zero. **(a)** use neutral change styling and retain the sign in `pmo-portal/pages/project-detail/budget/BudgetVersionsDrawer.tsx`; **needs runtime check:** the two version totals and currencies. Prior art: `docs/decisions.md:164` OD-BUDGET-1, active version is budget authority; search “budget version”.

### C14. Past target with ongoing status

**Definition/source:** project status and target end date are independent fields; `pmo-portal/pages/project-detail/ProjectDetailRail.tsx:76,77` shows the dates while `pmo-portal/pages/project-detail/ProjectDetailHeader.tsx:197` presents project header information. The review observed an ongoing project beyond its target date. **Needs runtime check:** actual project status and dates, including end-year rendering. **(a)** show a clearly defined “past target” date indicator, with full year, in `pmo-portal/pages/project-detail/ProjectDetailHeader.tsx` and `ProjectDetailRail.tsx`, using the organisation day; do not assert project failure from date alone. Prior-art search “project end date”.

### C15. Meetings differ by viewer

**Definition/source:** meetings list is the caller-visible set, not every project meeting; `pmo-portal/src/hooks/useMeetings.ts` and `pmo-portal/src/lib/db/meetings.ts` load it, `pmo-portal/pages/Meetings.tsx:32,61,234` renders list/empty state. Review observed different lists across roles. **Needs runtime check:** record sharing, viewer and filter selection. **(a)** qualify the empty state as meetings visible to the viewer in `pmo-portal/pages/Meetings.tsx`; do not broaden access. Prior ruling `docs/decisions.md:2400` DD-MTG-7 distinguishes project assignment from meeting sharing; prior-art search “meetings”.

### C16. Stock item code and description

**Definition/source:** item code and item name are independent stock-master fields, returned by `get_stock_on_hand` (`pmo-portal/src/lib/db/stockReports.ts:40,44`), displayed by `pmo-portal/pages/stock/StockOnHand.tsx:73,76,77`. The review saw an apparently mismatched code and description. **Needs runtime check:** authoritative item master and the intended physical item. **(d)** correct the item master or sample data only after confirmation; editing the screen cannot establish the correct name. Worker data file if sample-owned: `supabase/seed.sql`; no UI change required. Prior-art search “stock code”.

### C17. Budget category mapped to surprising account

**Definition/source:** persisted category/account pairs are configuration, displayed by `pmo-portal/pages/admin/BudgetAccountMap.tsx:38,75,96`; the mapping read/write source is `pmo-portal/src/lib/repositories/budgetProjection.ts:547` as imported at `BudgetAccountMap.tsx:25`. The review observed a category paired with an unexpected expense account. **Needs runtime check:** accounting policy, account catalogue and mapping provenance. **(d)** correct the configured mapping if the accountant confirms it; do not substitute an assumed account. **(c)** automatic mapping changes require reviewed server behavior and standalone money review. Prior-art search “accounting map”.

### C18. Finance approval count versus navigation badge

**Definition/source:** dashboard approval total is built from viewer queues by `pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts:319,341,356`, rendered by dashboard consumers; navigation badge is independently aggregated in `pmo-portal/src/components/shell/ApprovalsNavCount.tsx:23,100` and mounted by `pmo-portal/src/components/shell/Rail.tsx:325`. The review saw one waiting item without a visible menu count. **Needs runtime check:** actual viewer, queue kinds, loading and navigation state. **(b)** share the approved queue-count selector and preserve loading/error states in `useNeedsYou.ts` and `ApprovalsNavCount.tsx`; add `Rail.tsx` only if badge rendering needs correction. See R22; prior-art search “approval count”.

### C19. Phone approvals zero versus desktop navigation

**Definition/source:** `pmo-portal/src/components/shell/PhoneNavBar.tsx:18,22,28,68` includes a role-independent approvals destination and count; desktop `pmo-portal/src/components/shell/Rail.tsx:81,246` filters its destinations. The count source is `ApprovalsNavCount.tsx:23`. The review saw zero on the phone for a role without the desktop entry. **(a)** align destination visibility with the existing navigation eligibility in `pmo-portal/src/components/shell/PhoneNavBar.tsx`, reusing the rule from `Rail.tsx` through a shared selector **(b)**; preserve legitimate eligible users. **Needs runtime check:** the captured viewer's eligibility. Prior-art search “mobile approvals”.

### C20. Singular, complementary percentages and rounded progress

**Definition/source:** procurement count is a count of cases, rendered through project position in `pmo-portal/src/hooks/useProjectPosition.ts`; used and remaining percentages come from `pmo-portal/pages/procurement/computeBudgetSignal.ts:72` and are formatted independently at `pmo-portal/pages/procurement/DecisionSupportPanel.tsx:228,257`; project milestone delivery uses `pmo-portal/src/hooks/useProjectsDelivery.ts:38` and `pmo-portal/pages/projects/projectTableColumns.tsx:315`. The review saw singular “1 procurements”, 68% plus 32.1%, and 47% versus 46.88%. **(a)** fix plural localization and explicitly label precision in `pmo-portal/src/hooks/useProjectPosition.ts`, `pmo-portal/pages/procurement/DecisionSupportPanel.tsx`, `pmo-portal/pages/projects/projectTableColumns.tsx`; retain calculations. **Needs runtime check:** captured denominators and same project/date scope. Prior-art search “rounding”.

### C21. Purchasing against a pre-win project

**Definition/source:** a purchase can link to a project at a sales stage; this is a project relationship, not a delivery-status indicator. `supabase/seed.sql:261,601,1144` creates a sample tender, budget and purchase, and `pmo-portal/pages/procurement/DecisionSupportPanel.tsx:65` shows that context. Review observed a purchase and supplier invoice against a pre-win project. **Needs runtime check:** linked case, project stage and document data. **(d)** repair sample references only if accidental; **(a)** label stage and budget version in `pmo-portal/pages/procurement/DecisionSupportPanel.tsx`. Restricting such purchases is a separate **(c)** owner decision and reviewed money/SoD change. See R21; prior-art search “pre-win procurement”.

### C22. Integration connector identity unavailable

**Definition/source:** integration display resolves an actor identifier to a display name, falling back to unavailable when unresolved. `pmo-portal/src/components/integrations/TierConnectionCard.tsx:35,138` shows this; connection presence and actor resolution are separate facts. **Needs runtime check:** binding actor value, profile availability and lookup response. **(a)** clarify that only the recorded connector identity is unavailable in `pmo-portal/src/components/integrations/TierConnectionCard.tsx`; **(d)** correct sample attribution only if confirmed. Prior-art search “integration connected by”.


## Earlier investigation: row-by-row inventory

Rows retain the earlier review order for traceability. A screen named in the source trace is cited in the evidence; remaining homes identify the surfaces to inspect when implementing. Related issue numbers are prior-art search results, not automatically adopted rulings. Class (a) is presentation, (b) shared selector, (c) server or money/approval computation, (d) data; where there is no demonstrated defect the class is conditional and does not authorize a change.

### R0. Active budgets versus 6/7 uncheckable projects

**Definition / finding:** **Real defect:** an owner is told budgets are absent when risk can also be uncheckable for incomplete spend or commitments. PM and executive use differently scoped populations; the captured exact memberships require runtime rows.

**Source and current screens:** `supabase/migrations/0770_dashboard_pmo_positions.sql:280` counts missing/nonpositive budget OR incomplete/missing actuals OR incomplete commitments OR currency mismatch; `pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts:112,164` now labels executive and PM risk as uncheckable, and `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx:264` shows the uncheckable count. The earlier capture predates this current wording. Other homes: Executive and PM dashboards; project budget pages.

**Class (a), already present:** retain “risk cannot be checked”; investigate PM scope before equating counts and name missing basis only if it is known. Worker UI files: `pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts`, `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx` and locale files.

**Needs runtime check:** compare the role-scoped project populations and incomplete inputs. **Prior ruling:** `docs/decisions.md:164` (OD-BUDGET-1, active budget authority); searches “Active budgets versus 6/7 uncheckable projects” and “budget version”.

### R1. Approval $600k available / $390k after vs budget left unknown

**Definition / finding:** **Real defect:** an approver can read reservation headroom as a confirmed cash/spend balance despite unknown actuals.

**Source and current screens:** `pmo-portal/pages/procurement/computeBudgetSignal.ts:72` subtracts commitments and reserved, but no actuals; `pmo-portal/pages/procurement/DecisionSupportPanel.tsx:210` labels it available and line 221 headroom; `pmo-portal/src/hooks/useProcurements.ts:52` sources commitments. `pmo-portal/pages/ProjectBudget.tsx:505,865` requires known spent and committed amounts before calculating left. Other homes: Approval preview, expanded procurement list and procurement detail all use DecisionSupportPanel.

**Class (a); (c) only for server/write changes.** Label as budget less committed and reserved, and disclose actuals excluded; if the decision requires actual-aware remaining, propagate complete actuals and refuse a confident balance when unknown. Worker UI files: `pmo-portal/pages/procurement/computeBudgetSignal.ts`, `pmo-portal/pages/procurement/DecisionSupportPanel.tsx`, `pmo-portal/pages/ProjectBudget.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R2. Return has no reason; returned week refers to flags

**Definition / finding:** **Real defect:** the engineer cannot identify the requested correction.

**Source and current screens:** `pmo-portal/pages/timesheets/ApprovalsQueue.tsx:82` stores only kind/id/name, lines 138–154 show confirmation without input; `pmo-portal/src/lib/db/timesheetTransition.ts:88` accepts optional notes; `pmo-portal/pages/Timesheets.tsx:263` instructs review of flags. `supabase/migrations/0516_tm_claim_assembly.sql:268` defines the current transition RPC with optional notes but its body does not use `p_notes`; returned-screen message at `Timesheets.tsx:263` does not show them. Other homes: Approval queue and returned timesheet.

**Class (c).** Capture a reason and carry it to the returned week; replace unsupported flagged-days wording. Extend the authorized transition to persist the reason and show it to the owner. Worker UI files: `pmo-portal/pages/timesheets/ApprovalsQueue.tsx`, `pmo-portal/pages/Timesheets.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R3. One supplier bill 259 vs 12 days

**Definition / finding:** **Two honest clocks or definitions under one name**, subject to actual row event data: the procurement KPI uses invoice date or creation date, Payables uses recorded invoiced status or last update; a separate procurement row stage age uses stage events.

**Source and current screens:** `pmo-portal/pages/procurement/list/ProcurementKpiRow.tsx:27,40` selects oldest invoice date or creation; `pmo-portal/src/lib/procurement/rowDerivations.ts:41` separately selects latest matching event then `dates.pay`; `pmo-portal/src/lib/procurement/stage.ts:59` falls back to invoice date; `pmo-portal/pages/finance/PayablesPage.tsx:153` explains its clock. `pmo-portal/src/lib/finance/financePosition.ts:166` computes age from vendor invoiced timestamp or last update. Other homes: Procurement list, Payables, finance summaries.

**Class (a); (c) only for server/write changes.** Label both date bases visibly, or share one agreed aging basis after checking data and consumers. Worker UI files: `pmo-portal/pages/procurement/list/ProcurementKpiRow.tsx`, `pmo-portal/pages/finance/PayablesPage.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R4. Payment control missing

**Definition / finding:** **Not decidable from code alone:** a real Finance session in payments view should see the header button; captured absence needs the actual JWT role, URL/view, permission resolution, viewport and deployed revision. Unknown outstanding explains the invoice drawer action but does not gate the payments header.

**Source and current screens:** `pmo-portal/pages/finance/ReceivablesPage.tsx:83,84,85,154` shows header for payments view with create permission; `pmo-portal/src/auth/policy.ts:683` grants Finance/Admin create; `pmo-portal/pages/IncomingPayments.tsx:286,353` hides its own primary action when embedded but still instructs permitted users to use Receive Payment; `pmo-portal/pages/SalesInvoices.tsx:425` prioritizes received-date action and requires known positive outstanding for Record payment. Other homes: Receivables payment tab, invoice drawer and IncomingPayments.

**Class (a); (c) only for server/write changes (conditional; no defect established).** Reproduce captured session with those facts; make the empty state point to the actual header action and offer it in-place if otherwise obscured. Worker UI files: `pmo-portal/pages/finance/ReceivablesPage.tsx`, `pmo-portal/pages/IncomingPayments.tsx`, `pmo-portal/pages/SalesInvoices.tsx`

**Prior art:** #1402, #1403.

**Needs runtime check:** verify the captured record, its source facts and viewing context before treating the reported instance as established.

### R5. “Mark received” near payments

**Definition / finding:** **Real defect:** Finance may mistake invoice delivery for payment receipt before the clarifying dialog.

**Source and current screens:** `pmo-portal/pages/SalesInvoices.tsx:426` sets `setReceiptTarget`; `pmo-portal/src/components/finance/FinanceAttention.tsx:58` describes invoices with no received date. Other homes: Invoice drawer, Finance attention.

**Class (a).** Rename “Record client receipt of invoice” consistently, leaving the confirmation. Worker UI files: `pmo-portal/pages/SalesInvoices.tsx`, `pmo-portal/src/components/finance/FinanceAttention.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R6. Phone expense error hidden

**Definition / finding:** **Real defect:** engineer cannot find why save failed.

**Source and current screens:** `pmo-portal/pages/ExpenseClaimNew.tsx:95` validates description and other fields, line 101 sets one generic error, line 179 supplies no field error/required flag, line 187 renders alert after form fields. Other homes: New claim; detail line editor already uses per-field errors at `pmo-portal/pages/expenses/ExpenseLinesCard.tsx:132`.

**Class (a).** Mark invalid fields, show specific inline message and focus/scroll first invalid input, preserving entered data. Worker UI files: `pmo-portal/pages/ExpenseClaimNew.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R7. New purchase form only Save

**Definition / finding:** **Two definitions:** save creates a draft; submit is a subsequent action. The instruction does not say where submission occurs.

**Source and current screens:** `pmo-portal/pages/ProcurementCreate.tsx:212` handles save, lines 236–238 navigate to created record, lines 287–310 label draft and Save. `pmo-portal/pages/ProcurementDetails.tsx:632,671` renders the Requested action and requires at least one line. Other homes: Create and procurement detail.

**Class (a); (c) only for server/write changes.** Explain “Save draft, then submit on the record” and make next action prominent on the destination. Worker UI files: `pmo-portal/pages/ProcurementCreate.tsx`, `pmo-portal/pages/ProcurementDetails.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R8. Owed “—” beside $7.7m overdue invoice

**Definition / finding:** **Two honest definitions:** invoice face value is not proven outstanding balance; a payment may already exist.

**Source and current screens:** `pmo-portal/pages/finance/ReceivablesPage.tsx:88,90,109,170` retains open invoice with null outstanding and shows unknown when no known subtotal; `pmo-portal/pages/sales-invoices/SalesInvoiceDetail.tsx:98` renders outstanding unavailable. `pmo-portal/pages/sales-invoices/salesInvoiceColumns.tsx:149` formats invoice face value; `pmo-portal/src/lib/db/revenue.ts:269` reads nullable ERP outstanding. The captured invoice mirror and payment state are needed to explain its null. Other homes: Receivables, invoice drawer, dashboard.

**Class (a); (c) only for server/write changes.** Preserve unknown; label invoice total versus outstanding, and link to the missing balance source. Worker UI files: `pmo-portal/pages/finance/ReceivablesPage.tsx`, `pmo-portal/pages/sales-invoices/SalesInvoiceDetail.tsx`, `pmo-portal/pages/sales-invoices/salesInvoiceColumns.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R9. $42.50 shown as $43

**Definition / finding:** The claimant cannot verify cents from the rounded read-only display; this display follows owner ruling #1437. Open question for the owner: small USD claims.

**Source and current screens:** `pmo-portal/pages/ExpenseClaimNew.tsx:81` parses at scale 2; `pmo-portal/pages/ExpenseClaimDetail.tsx:120` and `pmo-portal/pages/expenses/ExpenseLinesCard.tsx:36,93` use `formatCurrency`; `pmo-portal/src/lib/dashboardMoney.ts:36` documents whole-unit presentation. `pmo-portal/src/lib/format.ts:81` forces zero fractional digits. Other homes: Expense summary, line, total and other transaction detail screens.

**By ruling (#1437):** retain whole-unit read-only display; open question for the owner: small USD claims. If the owner approves an exception, class (b) uses the existing cents formatter. Conditional worker UI files: `pmo-portal/pages/ExpenseClaimNew.tsx`, `pmo-portal/pages/ExpenseClaimDetail.tsx`, `pmo-portal/pages/expenses/ExpenseLinesCard.tsx`

**Prior art:** issue #1437 governs whole-unit read-only displays.

### R10. Reports no progress vs project progress

**Definition / finding:** **Two honest definitions under one name:** report checks recorded commercial progress assessments; project list shows weighted milestone delivery, a separate source.

**Source and current screens:** `pmo-portal/pages/ManagementPack.tsx:237,594` tests `latestProgress`; `pmo-portal/src/lib/reports/managementPack.ts:186` derives it from pack progress; `supabase/migrations/0810_pack_earned_value.sql:182` reads `project_progress_entries`; `pmo-portal/pages/projects/projectTableColumns.tsx:315` renders delivery percentage via `pmo-portal/src/hooks/useProjectsDelivery.ts:38` → `pmo-portal/src/lib/db/milestones.ts:100` → `supabase/migrations/0396_project_commitment_position.sql:364` (`get_projects_delivery`). Other homes: Reports, project list and detail progress.

**Class (a).** Say “No commercial progress assessments recorded” and identify the source separately from milestone delivery. Worker UI files: `pmo-portal/pages/ManagementPack.tsx`, `pmo-portal/pages/projects/projectTableColumns.tsx`

**Prior art:** #1481, #1405, #1403.

### R11. Statements always empty

**Definition / finding:** **Not decidable from code alone:** availability depends on eligible role, accounting tier, persisted catalogue/snapshot and selection; a single empty capture does not prove it is always empty. Need the sampled org's binding, snapshot availability and catalogue response at capture time.

**Source and current screens:** `pmo-portal/pages/FinancialStatements.tsx:73,218,251,275` chooses catalogue, unavailable, denied or Odoo section; `pmo-portal/src/hooks/useFinancialStatements.ts:301` applies role scope and calls repository; `pmo-portal/src/lib/db/financialStatements.ts:125` invokes `get_financial_statement_catalogue`; `supabase/migrations/0390_statements_disconnected_sample_binding.sql:48` checks role, binding and statement snapshots. Other homes: Statements, Finance hub, Integrations.

**Class (a); (c) only for server/write changes (conditional; no defect established).** Show the actual setup or sync prerequisite when known, otherwise preserve unavailable; do not claim a connection is missing without its state. Worker UI files: `pmo-portal/pages/FinancialStatements.tsx`

**Prior art:** no directly identified ruling in the scoped search.

**Needs runtime check:** verify the captured record, its source facts and viewing context before treating the reported instance as established.

### R12. Procurement ordered-not-invoiced vs Order 0 / project committed

**Definition / finding:** **Two honest definitions under one name:** KPI totals all role-visible Ordered and Received cases; board stages summarize the filtered selected tab, so Needs You can show no Order cases. Project committed is a separate SQL open-commitment position. Exact captured $6.3m composition requires the runtime rows and ownership basis.

**Source and current screens:** `pmo-portal/pages/Procurement.tsx:263,465,550` passes all to KPI and filtered tab rows to board; `pmo-portal/pages/procurement/list/ProcurementKpiRow.tsx:31,45` filters Ordered/Received and uses most-real amount; `pmo-portal/components/ProcurementBoard.tsx:102` groups supplied cases by stage; `pmo-portal/src/lib/db/procurements.ts:103` calls `project_committed_spend`, defined in `supabase/migrations/0651_committed_spend_set_based.sql:29`. Other homes: Procurement KPI and board, project overview/budget, approval signal.

**Class (a); (c) only for server/write changes.** Name KPI as all visible cases and stage strip as current filter; label project commitment as a separate open position. Worker UI files: `pmo-portal/pages/Procurement.tsx`, `pmo-portal/pages/procurement/list/ProcurementKpiRow.tsx`, `pmo-portal/components/ProcurementBoard.tsx`

**Prior art:** no directly identified ruling in the scoped search.

**Needs runtime check:** verify the captured record, its source facts and viewing context before treating the reported instance as established.

### R13. “Projects as at Nov 26”

**Definition / finding:** **Real defect:** a reader can interpret the year as a day.

**Source and current screens:** `pmo-portal/pages/ManagementPack.tsx:35,555` formats month/year and puts it after “as at”. Other homes: Reports.

**Class (a).** Render unambiguous full year (e.g. November 2026). Worker UI files: `pmo-portal/pages/ManagementPack.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R14. Contract on hand vs five ongoing

**Definition / finding:** **Two honest definitions under one name:** contract sum includes won pending kickoff, ongoing, on-hold and close-out, while the adjacent count is ongoing only; the juxtaposition implies they cover the same projects.

**Source and current screens:** `pmo-portal/src/components/dashboard/restructure/useCompanyFigures.ts:205` reads on-hand totals and lines 214–217 use `active_projects`; `pmo-portal/src/lib/db/dashboard.ts:241` calls the dashboard RPC; `supabase/migrations/0770_dashboard_pmo_positions.sql:187,240,394,400` counts ongoing separately from on-hand sum; `supabase/migrations/0044_dashboard_status_helpers.sql:45` defines the on-hand status set. Other homes: Dashboard contract tile, Projects on-hand filter, Reports.

**Class (a); (c) only for server/write changes.** Label the count explicitly as a subset or show the count of the same on-hand population beside the sum. Worker UI files: `pmo-portal/src/components/dashboard/restructure/useCompanyFigures.ts`

**Prior art:** no directly identified ruling in the scoped search.

### R15. Won 7 vs 3

**Definition / finding:** **Two honest definitions under one name:** board counts current won and lost/declined records without a date window; dashboard win rate counts dated decisions within its selected period and excludes declined from losses.

**Source and current screens:** `pmo-portal/pages/SalesPipeline.tsx:46` uses board array lengths; `pmo-portal/pages/sales/useSalesModel.ts:45` sources `useWonDeals`/`useLostDeals`; `pmo-portal/src/hooks/useDashboard.ts:156,180` lists on-hand and loss/declined through project repository; `pmo-portal/src/lib/db/dashboard.ts:257` calls `get_win_rate`; `supabase/migrations/0448_pipeline_stage_history.sql:331` applies `decided_at` window and counts Loss Tender separately from Declined. Other homes: Sales pipeline, dashboard win rate and loss breakdown.

**Class (a); (c) only for server/write changes.** Label board as all-time current outcomes including declined; show dashboard period and denominator. Worker UI files: `pmo-portal/pages/SalesPipeline.tsx`, `pmo-portal/pages/sales/useSalesModel.ts`

**Prior art:** #1403, #1402.

### R16. Completed project completed/unbilled vs work-order zero

**Definition / finding:** **Two honest definitions:** physical completion is not invoicing; dashboard totals only issued/closed work orders with positive remaining, not every completed contract. Captured the project work-order and invoice rows are needed to prove why this instance has zero.

**Source and current screens:** `supabase/seed.sql:213` seeds Close Out independently of billing; project delivery uses `pmo-portal/pages/projects/projectTableColumns.tsx:315`; `pmo-portal/src/lib/reports/managementPack.ts:138,153` computes earned/invoiced from commercial facts; `pmo-portal/src/hooks/useWorkOrderBilling.ts:20` → `pmo-portal/src/lib/db/workOrderBilling.ts:173` → `supabase/migrations/0441_work_order_acceptance_age.sql:36` totals complete issued/closed work orders with positive remaining. Other homes: Reports, project delivery and dashboard work-order billing.

**Class (a); (c) only for server/write changes.** Explain the work-order scope and flag missing commercial data when known; do not infer an invoice from completion. Worker UI files: `pmo-portal/pages/projects/projectTableColumns.tsx`

**Prior art:** no directly identified ruling in the scoped search.

**Needs runtime check:** verify the captured record, its source facts and viewing context before treating the reported instance as established.

### R17. Invoice overdue/submitted/drafted later than invoice date

**Definition / finding:** **Real defect:** imported invoice's local record creation is labelled Drafted, implying a business event that may never have happened. Submitted and overdue are compatible lifecycle and derived due-date states. Whether this captured invoice was imported requires its runtime origin and timestamps.

**Source and current screens:** `pmo-portal/pages/sales-invoices/InvoiceStatusTimeline.tsx:19` labels `created_at` Drafted; `SalesInvoicePanelDrawer.tsx:82` separately displays invoice date; `pmo-portal/pages/sales-invoices/salesInvoiceStatus.ts:70,99,102` derives overdue before falling back to Submitted; `pmo-portal/pages/project-detail/tabs/WorkOrdersClaimsCard.tsx:186` renders invoice date in project billing. Other homes: Invoice timeline, Receivables and project billing.

**Class (a).** Label local creation as recorded/imported where appropriate; distinguish derived overdue from lifecycle status. Worker UI files: `pmo-portal/pages/sales-invoices/InvoiceStatusTimeline.tsx`, `pmo-portal/pages/sales-invoices/salesInvoiceStatus.ts`, `pmo-portal/pages/project-detail/tabs/WorkOrdersClaimsCard.tsx`

**Prior art:** no directly identified ruling in the scoped search.

**Needs runtime check:** verify the captured record, its source facts and viewing context before treating the reported instance as established.

### R18. Overdue chip different colours

**Definition / finding:** **Real defect:** a finance user sees one overdue state represented with inconsistent severity.

**Source and current screens:** `pmo-portal/src/components/finance/FinanceAttention.tsx:125` uses `lost` for overdue and `warn` for partly paid; `pmo-portal/pages/sales-invoices/salesInvoiceStatus.ts:99` returns `overdue`, rendered by `salesInvoiceColumns.tsx:119`; both derive dates from the shared invoice facts but choose separate variants. Other homes: Finance hub, Receivables list and invoice drawer.

**Class (a).** Use one shared status presentation for the same overdue state, preserving a distinct partly-paid state. Worker UI files: `pmo-portal/src/components/finance/FinanceAttention.tsx`, `pmo-portal/pages/sales-invoices/salesInvoiceStatus.ts`

**Prior art:** no directly identified ruling in the scoped search.

### R19. Requested amount missing vs procurement total

**Definition / finding:** **Real defect:** a requester sees no amount on a request even when the case total is known, because request-row amount and case total are separate and the former takes precedence. Confirm captured request-row amount to verify this instance.

**Source and current screens:** `pmo-portal/pages/procurement/detail/ProcurementDetailPanels.tsx:209,256` passes request amounts and displays missing; `pmo-portal/src/lib/procurement/procurementMoney.ts:73` uses request rows when present and only falls back to case total when none exist; `pmo-portal/pages/procurement/computeBudgetSignal.ts:74` uses the case request value; `pmo-portal/src/lib/db/procurementLifecycle.ts:189` reads request rows. Other homes: Procurement money summary, approval and list.

**Class (a); (c) only for server/write changes.** Preserve request-document provenance but explain missing recorded document amount and link it to the case estimate; inspect request creation before synchronizing fields. Worker UI files: `pmo-portal/pages/procurement/detail/ProcurementDetailPanels.tsx`, `pmo-portal/pages/procurement/computeBudgetSignal.ts`

**Prior art:** no directly identified ruling in the scoped search.

**Needs runtime check:** verify the captured record, its source facts and viewing context before treating the reported instance as established.

### R20. Billing graph only three points / collected $0

**Definition / finding:** **Two definitions:** chart covers up to 12 completed months but deliberately begins with the first nonzero invoiced month; collected is the sum of recorded Paid receipts, not evidence all accounting payments synced. Whether this sample's receipt mirror was complete requires its runtime integration/sync state.

**Source and current screens:** `pmo-portal/src/lib/dashboardTrend.ts:25,37,62` trims leading zero history and compares first/last; `pmo-portal/src/components/dashboard/hub/company/InvoicedTrendTile.tsx:58` labels the result Falling; `useCompanyFigures.ts:184,193,306` separately reads trend pack and recorded receipts, defaulting an empty receipt list to zero; `pmo-portal/src/lib/db/revenue.ts:453` reads Paid `incoming_payments`; pack is supplied by `supabase/migrations/0810_pack_earned_value.sql:112`. Other homes: Dashboard trend, billing figures, Receivables payments and Reports.

**Class (a); (c) only for server/write changes.** State the shown history range and “recorded receipts”; suppress a completeness claim unless sync coverage is known. Worker UI files: `pmo-portal/src/components/dashboard/hub/company/InvoicedTrendTile.tsx`

**Prior art:** no directly identified ruling in the scoped search.

**Needs runtime check:** verify the captured record, its source facts and viewing context before treating the reported instance as established.

### R21. Pre-win project budget

**Definition / finding:** **Sample-data artefact:** a dedicated purchase approval fixture points to a tender project with a draft budget. Captured $1m budget version/state needs runtime data: the seed declares that version Draft. Production can also contain pre-win purchases or budgets; code alone does not establish that doing so breaks a rule.

**Source and current screens:** `supabase/seed.sql:261,601,1144` creates tender, draft budget and linked requested purchase; `pmo-portal/pages/procurement/DecisionSupportPanel.tsx:65` renders project budget signal for the linked case; project list on-hand scope excludes tender via `supabase/migrations/0044_dashboard_status_helpers.sql:45`. Other homes: Approval, project budget and sales pipeline.

**Class (a); (c) only for server/write changes.** Identify the budget version and project stage in approval context; do not prohibit pre-win work without a business rule. Worker UI files: `pmo-portal/pages/procurement/DecisionSupportPanel.tsx`

**Prior art:** #450, #474, #471.

**Needs runtime check:** verify the captured record, its source facts and viewing context before treating the reported instance as established.

### R22. Approval count during load

**Definition / finding:** **Real defect:** a reviewer can see All pending count include invoice/expense items while the adjacent queue count covers only procurement/timesheets; independent loading can also produce transient partial counts.

**Source and current screens:** `pmo-portal/pages/Approvals.tsx:118,127` constructs allPopulation from four sources and tracks separate pending states; lines 149–159 build queueItems only from procurement and timesheets; line 315 renders that length. The captured 1 item's kind and query timings are required to distinguish a transient from a persistent mismatch in that capture. Other homes: Approvals scope tabs and queue.

**Class (a).** Make both labels state their populations, and use loading placeholders until required sources settle. Worker UI files: `pmo-portal/pages/Approvals.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R23. Two project codes

**Definition / finding:** **Two honest definitions under one name:** PMO project number and client project code are separate identifiers; the timesheet renders the latter without a label.

**Source and current screens:** `pmo-portal/pages/project-detail/ProjectDetailRail.tsx:81` renders `pmo_project_number`; `pmo-portal/src/lib/db/timesheets.ts:20` and `timesheetTransition.ts:142` select project `code`; `pmo-portal/pages/timesheets/timesheetWeekModel.ts:30` and `ApprovalsQueue.tsx:70` map it; `pmo-portal/src/components/ui/TimesheetGrid.tsx:157` renders it unlabelled; `pmo-portal/public/locales/en/common.json:175` names it client project code. Other homes: Project detail, timesheet entry/approvals and search.

**Class (a).** Label the code or consistently show the PMO number with client code in secondary detail. Worker UI files: `pmo-portal/pages/project-detail/ProjectDetailRail.tsx`, `pmo-portal/pages/timesheets/timesheetWeekModel.ts`, `pmo-portal/src/components/ui/TimesheetGrid.tsx`

**Prior art:** #492, #1044, #475.

### R24. Read-only next to Edit

**Definition / finding:** **Two honest definitions under one name:** project fields can be editable while the won contract value is read-only to that role; the unqualified lock implies the whole record is read-only.

**Source and current screens:** `pmo-portal/pages/project-detail/ProjectDetailHeader.tsx:197` labels the restricted value Read-only; lines 334–337 calculate separate project-edit and contract-value permissions, line 561 renders Edit; `pmo-portal/src/auth/policy.ts` defines separate project actions. Other homes: Project header and project edit modal.

**Class (a).** Say “Contract value read-only” next to that value, retaining project Edit. Worker UI files: `pmo-portal/pages/project-detail/ProjectDetailHeader.tsx`

**Prior art:** #1362, #1571, #2123.

### R25. Unknown supplier

**Definition / finding:** **Sample-data artefact:** the seeded $30k case has null procurement vendor even though a selected quotation has a vendor; the same discrepancy can occur in production when those fields diverge. Whether every captured row had null or inaccessible vendor needs the runtime rows.

**Source and current screens:** `supabase/seed.sql:1161,1211,1215` seeds the case with null `vendor_id`, a vendor-bearing selected quote and the invoice; `pmo-portal/src/lib/db/procurements.ts:64,225` joins `vendor:companies(name)` from the case; `pmo-portal/pages/finance/PayablesPage.tsx:64` and `pmo-portal/src/components/procurement/ProcurementBlock.tsx:629` show fallback labels from that join. Other homes: Payables, procurement list/detail and quote.

**Class (d); (c) only for server/write changes.** Correct sample linkage; determine canonical supplier and synchronize its write path before falling back to quotation or invoice supplier. Worker UI files: `pmo-portal/pages/finance/PayablesPage.tsx`, `pmo-portal/src/components/procurement/ProcurementBlock.tsx`

**Prior art:** #1033.

**Needs runtime check:** verify the captured record, its source facts and viewing context before treating the reported instance as established.

### R26. Dashboard overdue bare count

**Definition / finding:** **Real defect:** an owner can read a bare invoice count as currency because the title starts “Owed” and adjacent figures are monetary.

**Source and current screens:** `pmo-portal/src/components/dashboard/restructure/useCompanyFigures.ts:328` renders `overdue.count` as the value and known monetary totals only in the subline; `useNeedsYou.ts:215` counts overdue rows independently of nullable outstanding amounts; `pmo-portal/src/hooks/useRevenue.ts:44` → `pmo-portal/src/lib/repositories/revenue.ts:54` → `pmo-portal/src/lib/db/revenue.ts:269` reads open `sales_invoices`; Receivables renders unknown outstanding via `pmo-portal/pages/finance/ReceivablesPage.tsx:226`. Other homes: Company dashboard, Receivables and Needs You.

**Class (a).** Name the headline “Overdue invoices” and attach invoice units; retain unknown balances rather than fabricating money. Worker UI files: `pmo-portal/src/components/dashboard/restructure/useCompanyFigures.ts`, `pmo-portal/pages/finance/ReceivablesPage.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R27. Blank Actual/Budget used/Spent/Variance

**Definition / finding:** **Real defect:** a manager cannot distinguish unknown values from empty cells or loading; sorted budget rows may all have unknown variance.

**Source and current screens:** `pmo-portal/pages/projects/projectTableColumns.tsx:103,125,140,350` returns blank for unknown actual and incomplete consumption; `pmo-portal/pages/projects/useProjectListModel.ts` calls `useProjectsMoneyCollection`; `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx:243,361` selects and mounts five review rows; `pmo-portal/src/components/dashboard/hub/company/FinanceBlocks.tsx:47,57,69` shows unknown review text and leaves unknown amount cells blank; `pmo-portal/src/hooks/useDashboard.ts:138` → `pmo-portal/src/lib/db/dashboard.ts:318` → `supabase/migrations/0700_pmo_spend_split.sql:536,579,598,610` computes complete-only variance and sorts unknown last. Other homes: Projects list, finance budget review and project budget.

**Class (a).** Render a visible unknown marker with the cause and avoid claiming a meaningful variance ranking when all are unknown. Worker UI files: `pmo-portal/pages/projects/projectTableColumns.tsx`, `pmo-portal/pages/projects/useProjectListModel.ts`, `pmo-portal/src/components/dashboard/hub/company/FinanceBlocks.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R28. Invoice creation blocked on missing VAT

**Definition / finding:** **Real defect:** Finance discovers a necessary setup only after opening the draft flow, so cannot complete it without leaving.

**Source and current screens:** `pmo-portal/pages/sales-invoices/SalesInvoiceFormModal.tsx:94,99,259` detects missing native-mode project VAT and links setup; `invoiceDraftValidation.ts` owns the predicate; `pmo-portal/pages/project-detail/tabs/BillingTab.tsx` opens the invoice flow. Exact captured project VAT is a runtime fact. Other homes: Project billing, invoice form and project setup.

**Class (a); (c) only for server/write changes.** Surface the missing prerequisite and direct setup action on project billing before starting. Worker UI files: `pmo-portal/pages/sales-invoices/SalesInvoiceFormModal.tsx`, `pmo-portal/pages/project-detail/tabs/BillingTab.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R29. Partial supplier payment absent

**Definition / finding:** **Two definitions:** Mark as Paid is a lifecycle transition with computed confirmation amount; the separate Record Payment form captures amount, date and reference. The ERPNext payment dispatch permits a positive amount up to the known outstanding balance; the captured ownership mode and whether that separate route was available remain runtime facts.

**Source and current screens:** `pmo-portal/pages/procurement/useProcurementDecision.tsx:90` computes scheduled total or invoice total; `pmo-portal/pages/procurement/RecordCaptureForm.tsx:199,337,561` captures payment with amount/date/reference and tier-dependent invoice link; `pmo-portal/pages/ProcurementDetails.tsx:516` names payment record; `pmo-portal/src/lib/adapterSeam/erpnext/dispatchProcurement.ts:281` rejects unknown outstanding and amounts exceeding it. Other homes: Procurement detail/timeline and Payables.

**Class (a); (c) only for server/write changes.** Explain the separate record-payment route and its supported partial semantics by tier. Worker UI files: `pmo-portal/pages/procurement/useProcurementDecision.tsx`, `pmo-portal/pages/procurement/RecordCaptureForm.tsx`, `pmo-portal/pages/ProcurementDetails.tsx`

**Prior art:** no directly identified ruling in the scoped search.

**Needs runtime check:** verify the captured record, its source facts and viewing context before treating the reported instance as established.

### R30. Expense decision requires opening claim

**Definition / finding:** **Two definitions:** queue is a receipt preview and link, whereas the full claim contains line evidence and decision controls. The extra navigation slows an approver but still reaches the action.

**Source and current screens:** `pmo-portal/pages/approvals/ExpenseClaimApprovalSection.tsx:48,78` renders receipt preview and link to claim; `pmo-portal/pages/ExpenseClaimDetail.tsx:176,179` renders decision bar and lines; both use the claim identified by the queue. Other homes: Approval queue and expense record.

**Class (a); (c) only for server/write changes.** Provide a direct labelled review-claim action; only embed decisions if the same evidence and authorization are maintained. Worker UI files: `pmo-portal/pages/approvals/ExpenseClaimApprovalSection.tsx`, `pmo-portal/pages/ExpenseClaimDetail.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R31. Help icons and win-rate explanation

**Definition / finding:** **Two definitions:** each tooltip describes a different figure; the review identifies reading effort, not a demonstrated wrong outcome.

**Source and current screens:** `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx:123,138,227` supplies per-figure help; `pmo-portal/src/lib/winRateMetrics.ts:32` defines the rate. Other homes: Company dashboard and win-rate detail.

**Class (a).** Consolidate optional definitions only if they remain reachable and preserve meaning. Worker UI files: `pmo-portal/src/components/dashboard/hub/company/CompanyDashboard.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R32. PM at-risk sentence

**Definition / finding:** **Two definitions:** unknown risk and zero at-risk projects differ; incomplete inputs intentionally produce unknown.

**Source and current screens:** `pmo-portal/src/components/dashboard/PMDashboard.tsx:110,116,214` renders unknown and explanation; `pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts:365` counts unknown project bases. Other homes: PM dashboard and Needs You.

**Class (a).** Use a concise unknown label with a link to affected projects, retaining the reason. Worker UI files: `pmo-portal/src/components/dashboard/PMDashboard.tsx`, `pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts`

**Prior art:** no directly identified ruling in the scoped search.

### R33. phone navigation requires scrolling

**Definition / finding:** **Real defect:** Finance must scroll to frequent destinations in a long navigation list; missing bottom tabs are a proposed design, not evidence of a broken route.

**Source and current screens:** `pmo-portal/src/components/shell/Rail.tsx:65,112,429` defines role items, grouped order and scroll region. Other homes: Shared navigation on all routes.

**Class (a).** Consider a role-relevant shortcut while retaining all destinations and access rules. Worker UI files: `pmo-portal/src/components/shell/Rail.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R34. selected preview card below fold

**Definition / finding:** **Real defect:** approver cannot immediately associate selected preview with its queue card.

**Source and current screens:** `pmo-portal/pages/Approvals.tsx:149,163,167,339` chooses first eligible queue item and passes selected key; queue ordering and scroll position are separate. Other homes: Shared approvals queue and preview.

**Class (a).** Reveal selected card when selecting initial item or make preview identity explicit. Worker UI files: `pmo-portal/pages/Approvals.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R35. phone queue return requires scrolling

**Definition / finding:** **Real defect:** a mobile approver must manually return from preview to queue.

**Source and current screens:** `pmo-portal/pages/Approvals.tsx:173,175` scrolls to preview on selection; queue and preview are separately rendered at lines 296,339. Other homes: Shared approvals queue.

**Class (a).** Add a labelled return-to-queue control and adequate target sizes. Worker UI files: `pmo-portal/pages/Approvals.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R36. new line row below total

**Definition / finding:** **Reviewer error:** the add row is explicitly labelled and functional; its position alone does not establish a dead-end or wrong result.

**Source and current screens:** `pmo-portal/pages/ProcurementCreate.tsx:363` mounts lines; `pmo-portal/pages/procurement/LineItemsSection.tsx:125` renders table total followed by an editable add row. Other homes: Procurement create and shared line items.

**Class (a) (conditional; no defect established).** If usability evidence warrants, place the input before total while keeping adding and validation intact. Worker UI files: `pmo-portal/pages/ProcurementCreate.tsx`, `pmo-portal/pages/procurement/LineItemsSection.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R37. optional purchase project

**Definition / finding:** **Two definitions:** a project-linked request gets project budget context; overhead requests can exist without a project. No wrong outcome from saving an overhead draft was established.

**Source and current screens:** `pmo-portal/pages/ProcurementCreate.tsx:123,226,328` accepts nullable project; `pmo-portal/pages/procurement/DecisionSupportPanel.tsx:5,79` only reads project context when available. Other homes: Procurement create, approval and detail.

**Class (a); (c) only for server/write changes.** Name optional overhead explicitly and say project budget comparison is unavailable without a project. Worker UI files: `pmo-portal/pages/ProcurementCreate.tsx`, `pmo-portal/pages/procurement/DecisionSupportPanel.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R38. request stage vocabulary

**Definition / finding:** **Two definitions:** draft, request stage and waiting-for-approval describe lifecycle and audience but inconsistent wording obscures that relationship.

**Source and current screens:** `pmo-portal/pages/ProcurementCreate.tsx:287` names Draft; `pmo-portal/pages/ProcurementDetails.tsx:358,366,632` distinguishes Requested from requester waiting state; `pmo-portal/src/lib/procurement/stage.ts:1` supplies stage grouping. Other homes: Procurement form, list, detail and approvals.

**Class (a).** Use one action-oriented label with consistent secondary lifecycle terms. Worker UI files: `pmo-portal/pages/ProcurementCreate.tsx`, `pmo-portal/pages/ProcurementDetails.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R39. pipeline stage names

**Definition / finding:** **Two definitions:** board columns summarize stages while project chips show detailed status values.

**Source and current screens:** `pmo-portal/pages/sales/useSalesModel.ts:23,74` chooses board stage label or project status label; `pmo-portal/pages/sales/DealBand.tsx:34,39` uses project status. Other homes: Pipeline board, detail chips and dashboard.

**Class (a).** Explain the stage-to-status mapping consistently. Worker UI files: `pmo-portal/pages/sales/useSalesModel.ts`, `pmo-portal/pages/sales/DealBand.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R40. invoice evidence error

**Definition / finding:** **Real defect:** a finance reviewer cannot inspect lines when an accounting evidence request fails; wording alone cannot restore the unavailable evidence.

**Source and current screens:** `pmo-portal/pages/sales-invoices/SalesInvoiceEvidence.tsx:16,18,78` fetches evidence and exposes error plus Retry; `pmo-portal/src/hooks/useRevenue.ts:95` → `pmo-portal/src/lib/repositories/invoiceEvidence.ts:13` invokes external evidence with timeout; `pmo-portal/pages/sales-invoices/SalesInvoicePanelDrawer.tsx:21` hosts evidence. Runtime failure response and accounting connection are needed to determine why this request failed. Other homes: Invoice drawer and accounting evidence.

**Class (a); (c) only for server/write changes.** Preserve retry and explain next recovery action based on the actual failure. Worker UI files: `pmo-portal/pages/sales-invoices/SalesInvoiceEvidence.tsx`, `pmo-portal/pages/sales-invoices/SalesInvoicePanelDrawer.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R41. invoice dates, tax and customer/project fields

**Definition / finding:** **Two definitions:** native mode requires project and derives tax from it; other accounting modes differ. Dates and account-system ownership at the capture must be inspected to decide if a missing field prevents a particular invoice.

**Source and current screens:** `pmo-portal/pages/sales-invoices/SalesInvoiceFormModal.tsx:69,74,94,102,410` initializes separate customer/project, validates per mode and derives tax preview; `SalesInvoiceDialogs.tsx:72` handles the subsequent received date. Other homes: New invoice, project billing, invoice drawer.

**Class (a); (c) only for server/write changes.** Explain where dates and tax originate; improve field width and prefill only when the selected project establishes the customer. Worker UI files: `pmo-portal/pages/sales-invoices/SalesInvoiceFormModal.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R42. repeated empty-week status and team review

**Definition / finding:** **Two definitions:** draft, save eligibility and copy-last-week eligibility are separate states; repeated text creates reading overhead.

**Source and current screens:** `pmo-portal/pages/Timesheets.tsx:130,138,142,220` derives copy and status; `pmo-portal/pages/timesheets/TimesheetWeekToolbar.tsx:43,54,61` separates My time from Team review. Other homes: Timesheet week and approvals.

**Class (a).** Consolidate visible status while retaining action-specific disabled reasons. Worker UI files: `pmo-portal/pages/Timesheets.tsx`, `pmo-portal/pages/timesheets/TimesheetWeekToolbar.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R43. mobile task cards and small targets

**Definition / finding:** **Real defect:** cramped controls make a field user's task actions harder to activate.

**Source and current screens:** `pmo-portal/pages/MyTasks.tsx:316,319,340` renders each card's comments and status controls; the list is separately rendered in the same page. Other homes: My Tasks mobile cards and shared controls.

**Class (a).** Enlarge touch targets and compact repeated card chrome without dropping actions. Worker UI files: `pmo-portal/pages/MyTasks.tsx`

**Prior art:** no directly identified ruling in the scoped search.

### R44. list explanations

**Definition / finding:** **Reviewer error:** the shared shell permits descriptions, but their mere presence does not establish that a task failed.

**Source and current screens:** `pmo-portal/pages/Contacts.tsx:241,245` supplies a description; `pmo-portal/src/components/ui/ListPage.tsx:126` renders it. Other homes: ListPage and callers.

**Class (a) (conditional; no defect established).** Shorten or relocate only after judging each description's value. Worker UI files: `pmo-portal/pages/Contacts.tsx`, `pmo-portal/src/components/ui/ListPage.tsx`

**Prior art:** no directly identified ruling in the scoped search.

## Execution sequence and verification

This inventory is a spec input, not a signed specification. After the Director resolves the open decisions, split the work into independently reviewable slices: (1) scope labels and overdue breakdown, (2) same-clock supplier age, (3) sales/report wording and precision, (4) approval and finance unknown-state wording, (5) data corrections, and (6) standalone reviewed money changes only when specifically approved. Preserve #1437 unless the owner amends it. Each slice must start by verifying the cited code at its then-current commit and recording the applicable acceptance IDs from the new spec.

For each slice, write a failing behavior test for the corresponding stated definition, run that test and observe the expected failure, implement only the approved change, and rerun the touched tests. At minimum the four priority slices exercise the cases listed in sections 1–4; include empty, unknown, loading, role scope, currency, and organisation-day boundaries where applicable. Run from `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched-files>`, and `npx vitest run <directly-touched-test-files>`. UI workers also run the affected journey and `scripts/ux-proof.sh` from the repository root according to the current local-gate runbook. The actual filenames and commands are selected from the approved slice; CI remains the merge gate. Never turn an unknown financial value into zero merely to reconcile displays.

For every class (c) proposal, first write a separate business definition identifying population, event date, accounting source, currency, rounding and unknowns, then specify the owning SQL/RPC and its existing consumers, a reversible migration and targeted pgTAP coverage, together with money/SoD review. No such change follows automatically from a labeling task. Data corrections require the authoritative source and approval for the relevant environment; sample seed changes are tested locally under the repository's database-lock rules.
