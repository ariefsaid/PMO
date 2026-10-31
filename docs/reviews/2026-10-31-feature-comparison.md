# Feature comparison — PMO v0.28 vs KANNA, RIS-portal-2, ERPNext, Odoo 20 CE

**Date:** 2026-10-31 · **PMO state:** `origin/dev` (v0.28 work in flight; latest cut v0.25.1, #1493) · **Comparators:** KANNA (Aldagram), RIS-portal-2 (our prior product), ERPNext v15/v16, Odoo 20 Community Edition.
**Supersedes as the current comparison:** `2026-06-11-kanna-gap-analysis.md` and `2026-07-22-competitive-refresh-ris-cicle.md` (both re-checked; every PMO claim below was verified against today's code, not carried over).

## Evidence tiers per comparator

| Comparator | Evidence | Freshness |
|---|---|---|
| **PMO v0.28** | This worktree (routes `pmo-portal/App.tsx`, `pages/**`, `supabase/migrations`, `supabase/functions`, specs in `docs/specs/`) | Verified 2026-10-31 |
| **KANNA** | The two local research docs only (Jun + Jul 2026); no web access this run | **Per Jul 2026 research, not re-checked** |
| **RIS-portal-2** | Jul 2026 source inventory (`2026-07-22` doc) + spot-check of `ris_portal_ui` api modules and Frappe doctypes on 2026-10-31 | Per Jul 2026 inventory, spot-checked |
| **ERPNext v15/v16** | `docs/adr/0048`, `docs/adr/0055`, module folders in the local bench (`apps/erpnext/erpnext/*`) | Current (source listing 2026-10-31) |
| **Odoo 20 CE** | `docs/research/2026-10-30-odoo20-native-coverage.md`, `2026-10-30-odoo20-api.md`, `docs/plans/2026-10-30-epc-odoo-build-route.md` | Current (2026-10-30) |

Legend: ✅ yes · 🟡 partial · ❌ no · — not applicable (out of the product's nature).
PMO ✅/🟡 cells cite a route or file; material ❌ cells cite an open issue where one exists.
Private-repo rule respected: RIS-portal-2 features are named, never quoted.

---

## 1. Summary — where PMO stands

- **PMO leads every comparator on the governed commercial thread**: one record runs deal → project → budget → procurement → delivery → billing → cash with RLS + SoD + server-enforced approvals under it (`/projects/:id` model, `transition_procurement`, budget-backed approval routing). No comparator keeps the whole thread in one governed surface.
- **PMO is now AR-complete standalone** — the June baseline's biggest hole is closed: PMO-native sales invoices, incoming payments, billing by work order, progress assessments vs billing claims, down payments, receivables position (`pages/SalesInvoices.tsx`, `IncomingPayments.tsx`, `progress-billing.spec.md`), with ERPNext as the optional ledger (ADR-0055/ADR-0048).
- **Delivery reporting caught up with the field-tools**: milestones with weighted delivery-%, Gantt, S-curve, project calendar, first-class tasks with subtasks (`ProjectGantt.tsx`, `ProjectSCurve.tsx`, `ProjectCalendarView`) — the June gaps vs KANNA here are gone. What remains missing is *field capture*: daily site reports, offline entry, GPS attendance (#1517/#1520/#1522).
- **The integration hub is real and unmatched by the SaaS comparators**: ERPNext adapter (money write-through, statements read-back), ClickUp 2-way task sync, M365 SSO + token custody + SharePoint/OneDrive record folders — KANNA has none of this depth; ERPNext/Odoo *are* the adapters' targets.
- **The AI assistant is a differentiator with governance no comparator has**: RLS-scoped reads, confirm-gated writes that re-derive authorization server-side, credits metering, automations (`agent-write-actions.spec.md`, `agent-usage-credits.spec.md`).
- **Where PMO still trails ERPNext/Odoo — and knows it**: the accounting back office (journals, period close, bank recon, fixed assets, tax registers — #894/#895/#896/#898/#899), inventory/stock (#1512), and any native-assets story. These are deliberate: the ERP owns the ledger; PMO owns the working layer (ADR-0048/0055).
- **Where PMO trails the field tools**: offline/native field execution and photo-first daily reporting — KANNA's turf, parked by OD-CR-6 in 2026-07 but **partially un-parked by the EPC route** (#1520 offline capture, #1522 daily report, #1517 GPS attendance).
- **For selling**: the pitch is not "more features than ERPNext"; it is *one governed place to run the contract business, standalone or over the ERP the client already has, with an assistant that can be trusted with writes*. Accounting depth, stock and field-offline are the three honest "no, and here's how it's covered" answers today.

---

## 2. Spine matrices

### Spine 1 — Commercial / CRM

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Pre-win pipeline: stages, kanban, weighted value, win-rate, aging/needs-attention | ✅ `pages/SalesPipeline.tsx`; `pipeline_stage_config.win_probability` (migration 0008), aging 0020, open-bids/stale-win-rate RPC 0385 | ❌ (no pre-win commercial pipeline) | ✅ `api/opportunity.py` | 🟡 Lead/Opportunity exists but converts-and-dies (ADR-0055 §5) | ✅ CRM app | Odoo's CRM is the strongest comparator here; PMO's advantage is the pipeline record *becomes* the project |
| One record deal→delivery (no convert step) | ✅ Model B `/projects/:id`, stage-derived crumbs (`App.tsx` `recordStatusGroupForPath`, ADR-0020/0021) | ❌ (projects start fresh) | ❌ (converts to project) | ❌ | ❌ | The moat-defining structure — lost deals stay queryable beside on-hand work |
| Company + contact records | ✅ `/companies`, `/contacts` (`pages/Companies.tsx`, `pages/Contacts.tsx`, `src/lib/db/contacts.ts`; `crm` org feature) | 🟡 client master | ✅ ERPNext Customer/Supplier/Contact | ✅ | ✅ `res.partner` | |
| Activity log (call/email/meeting/note timeline) | ✅ `crm_activities` Call/Email/Meeting/Note (`src/lib/db/crmActivities.ts`) | 🟡 project feed | 🟡 project timeline events | 🟡 Communications log | ✅ chatter | |
| Meetings with minutes, action items, view-only shares | ✅ `/meetings` (`pages/Meetings.tsx`, migration 0205 RLS) | ❌ | ❌ | 🟡 events, no minutes model | 🟡 calendar + notes | Underrated PMO differentiator for client-facing teams |
| Follow-up / next-action reminders on deals & contacts | ❌ no due-dated follow-up loop — no issue | 🟡 | ❌ | 🟡 ToDos | ✅ activities | Jul-2026 candidate C2, never filed — gaps ledger |
| Win/loss reasons + analytics | ❌ no loss-reason field (absent in `src/` + migrations) — no issue | ❌ | ❌ | 🟡 lost-reason on Opportunity | ✅ lost reason | C4; dashboard reads stage stats only (0385) |
| M365 email/meeting capture into CRM | ❌ (OD-CR-2 scoped manual-log v1; not built) — no issue | ❌ | ❌ | 🟡 | 🟡 Outlook plugins | Rides the shipped Graph custody; high-leverage CRM-v2 piece |
| Tender/bid tracking on the pipeline | 🟡 open-bids dashboard tile (0385); no submission-deadline/bid-doc model | ❌ | ❌ | ❌ | ❌ | C5; nobody in the set has it — differentiation opportunity |

### Spine 2 — Budgets and cost

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Versioned budgets, one active, draft→approve lifecycle | ✅ `pages/ProjectBudget.tsx`, `src/lib/db/budgets.ts`, `budget-versioning.spec.md` | ❌ (dashboard aggregates only) | ✅ `api/budget.py` + budget version comparison | ✅ Budget doctype | 🟡 analytic budgets are Enterprise per Oct research | |
| Budget vs committed/actual, portfolio variance ranking | ✅ committed-spend basis (OD-BUDGET-2), `get_finance_budget_review()` (0022) | 🟡 company dashboard | ✅ `budget_kpi.py` | 🟡 variance vs budget | 🟡 Enterprise profitability widget | |
| Budget vs actual over the whole project duration (not per fiscal year) | ❌ #1425 | ❌ | 🟡 | 🟡 | 🟡 | RIS signed build, Now queue |
| Budget categories / cost codes | 🟡 fixed 7 categories + travel/vehicle additions (0366, OD-BUDGET-4 lock + seam); BoQ work items carry quantity grain (`BoqItemFormModal.tsx`); no org-defined cost codes — no issue | ❌ | 🟡 budget_line_item | ✅ accounting dimensions | ✅ analytic plans | Cost-code granularity = estimating feedback loop (epc gap 5) |
| Budget projection / forecast (projected utilization, variance tone) | ✅ `pages/BudgetProjection.tsx` + `src/lib/repositories/budgetProjection.ts` (ERPNext v16 aware) | ❌ | ✅ `schedule_kpi.py`/`budget_kpi.py` | 🟡 | 🟡 Enterprise | |
| Budget push to ERP (active version projected into ERPNext) | ✅ `budget-push-v16.spec.md`, budget push seam 0137/0379/0402 | — | — | — (it receives) | ❌ until O-route | Whole-project-budgets spread: #1472 open |
| Multi-currency records + org FX (JISDOR) | ✅ `currency` on money tables (OD-CR-5), `pages/AdministrationExchangeRates.tsx`, `src/lib/db/fxRates.ts` | 🟡 | 🟡 IDR single-currency | ✅ | ✅ | |
| Cost attribution rules (allocate spend → project by rule) | ✅ `pages/admin/CostAttribution.tsx`, `cost-attribution.spec.md` (0376) | ❌ | ❌ | 🟡 manual dimensions | 🟡 manual analytic distribution | |
| Reserved spend / commitment position | ✅ 0396 `project_commitment_position`, `procurement-reserved-budget.spec.md` | ❌ | ❌ | 🟡 | ❌ no hard budget blocking (Oct research §2.7) | PMO stronger than Odoo CE here |
| Import/paste budget rows | 🟡 import protocol 0397 + CLI load (OD-CQ-4); in-app paste ❌ #1473; propose-from-uploaded-doc ❌ #1466 | 🟡 Excel import (Capterra) | ❌ | ✅ data import | ✅ | #1473/#1466 in signed-build queue |

### Spine 3 — Procurement

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Full P2P lifecycle PR→VQ→PO→GR→VI with server-enforced transitions | ✅ `pages/Procurement.tsx`, `pages/ProcurementDetails.tsx`, `transition_procurement` SoD (0018, OD-PROC-8), flexible entry (`procurement-flexible-entry.spec.md`, one-step first-doc #1465 open) | 🟡 generic approval flow (Pro Plus+) | ✅ `api/procurement.py`, PR/procurement doctypes | ✅ | ✅ | ERPNext/Odoo match the mechanics; PMO's edge is the SoD + budget coupling |
| Vendor quotation compare, one-selected | ✅ `pages/procurement/VendorQuotesTab.tsx` | ❌ | ✅ quote comparison | ✅ RFQ | ✅ | |
| Budget-backed, multi-tier approval routing with value thresholds | ✅ `approval-routing-by-budget.spec.md` (ADR-0051/0075), `pages/admin/SpendApprovers.tsx`, budget gates (`OrgProcurementGates.tsx`) | 🟡 tiered only in KANNA's approval flow | 🟡 approval limits by value (R1) | 🟡 PO double-validation threshold only | 🟡 CE: PO threshold only; approvals app is Enterprise | Odoo CE cannot do budget-backed approvals — PMO-over-Odoo is the answer (#1505) |
| Procurement as ERP mirror (ERPNext SoT, PMO the UI) | ✅ `pages/ErpPurchases.tsx`, `erpnext-adapter*.spec.md`, `external_refs`, `supabase/functions/erpnext-*` | — | — (it is the ERP UI) | — (it is the SoT) | ❌ until O2 (#1505) | |
| Vendor bills with PPN + withholding (PPh 23/4(2)) and e-Faktur NSFP capture | ✅ `pages/procurement/VendorWithholdingSlipModal.tsx`, `vendor-withholding*.spec.md`, `EfakturCell.tsx` | ❌ | 🟡 | ✅ | ✅ `l10n_id` | Withholding-slip detail (separating PPh 23 vs 4(2) accounts) still open: #1275 |
| Per-line GR matching | 🟡 header-level GR; per-line deferred (OD-PROC-2/7) | ❌ | 🟡 | ✅ | ✅ | Prerequisite for inventory (#1512) |
| Bulk approve / rejection reason on procurement approvals | 🟡 bulk exists on the timesheet queue (`pages/Approvals.tsx` BulkController); procurement queue not unified (#1072); rejection comment absent — no issue | ❌ | ✅ bulk + mandatory rejection comment (R2/R3) | 🟡 | 🟡 | Small RIS-parity items, still unbuilt |
| Record change history / audit on money records | ✅ `recordChanges.ts`, `record-change-history.spec.md`, `procurementHistory.ts` | 🟡 Enterprise plan audit logs | 🟡 | ✅ versioning | ✅ mail.thread | |
### Spine 4 — Delivery / tasks / schedule

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Milestones with weighted delivery-% rollup | ✅ `pages/project-detail/MilestoneStrip.tsx`, `delivery-milestones.spec.md` (OD-DEL-2..7) | 🟡 board columns | 🟡 | 🟡 | 🟡 project milestones | |
| Gantt chart | ✅ `pages/project-detail/ProjectGantt.tsx` | ✅ | ✅ | 🟡 basic | ✅ | Closed since the June baseline |
| S-Curve (planned vs actual with actual line) | ✅ `pages/project-detail/ProjectSCurve.tsx`, `scurve-actual-line.spec.md` | ✅ (shipped 2026-06) | ❌ | ❌ | ❌ | Rare outside dedicated PM tools |
| Project calendar view | ✅ `components/ProjectCalendarView` on `/projects` (table/kanban/calendar toggle) | ✅ | ❌ | 🟡 | ✅ | |
| Tasks: dependencies, subtasks, priority, archive | ✅ `first-class-tasks.spec.md`, `src/lib/db/tasks.ts` (OD-INT-9), `/my-tasks` | ✅ | 🟡 | ✅ | ✅ | |
| Baseline vs actual schedule / critical path | ❌ no baseline fields on tasks — no issue | ✅ dependency auto-reschedule | 🟡 | ❌ | 🟡 | The one schedule honesty gap left; pairs with stage-gates |
| Execution phases / stage-gates | ❌ milestones only — no stage-gate machine (OD-DEL-6) — no issue | 🟡 custom statuses | ❌ | 🟡 project stages | 🟡 project stages | Deliberate 2026-06 ruling; revisit only with an owner driver |
| Work orders (client PO), contract quantities, BAST acceptance, drawdown | ✅ `src/lib/db/workOrders.ts`/`workOrderAcceptances.ts`, `WorkOrderAcceptances.tsx`, `ProjectDrawdown.tsx` (ADR-0080/0091, OD-CQ-1..4, 0337) | ❌ | 🟡 project_work_order doctype | 🟡 Sales Order | 🟡 SO lines | The EPC billing backbone — no comparator models acceptance + closing value this way |
| Progress assessments vs billing claims (volume BoQ) | ✅ `ProgressAssessmentModal.tsx`, `ProgressClaimModal.tsx`, `progress-billing.spec.md` (0250/0251) | ❌ | ❌ | ❌ | ❌ not native (Oct research §2.6) | PMO-only in this set |
| Task 2-way sync with an external board (ClickUp) | ✅ `clickup-adapter.spec.md`, `supabase/functions/clickup-*` (ADR-0056, OD-INT-9..14) | ❌ | ❌ | ❌ | ❌ | Unique among comparators |

### Spine 5 — Timesheets and expenses

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Weekly timesheet grid with line-manager approval + SoD, bulk approve, reopen path | ✅ `pages/Timesheets.tsx`, `timesheets-approval.spec.md`, `timesheetTransition.ts` (0011) | ❌ (time tracking via Capterra only) | ✅ `api/timesheet.py` | ✅ | ✅ | |
| Approved hours pushed to ERP (timesheet cost) | ✅ `src/lib/db/timesheetPush.ts`, `erpnext-adapter-p3b-timesheets.spec.md` | — | — | — | ❌ until O7 (#1510) | |
| Copy-last-week / quick-add on timesheets | ❌ prefill only — no issue | — | ✅ (R8) | ✅ | ✅ | Tiny RIS-parity gap |
| Expense claims with receipts, approval queue | ✅ `pages/ExpenseClaims*.tsx`, `expense-claims.spec.md` | 🟡 | ❌ | ✅ Claim Expense | ✅ | |
| Cash advances, settlement, advance aging | ✅ `pages/expenses/AdvanceAgingCard.tsx`, `useOwnAdvanceOptions.ts` | ❌ | ❌ | 🟡 employee advance | 🟡 expenses advances | Extends into site imprest: #1515 |
| Expense postings to ERP | ✅ `src/lib/repositories/expensePostings.ts`, `expenseCapture.ts` | — | — | — | ❌ until built | |
| Attendance (clock in/out) | ❌ #1517 | 🟡 | ❌ | ✅ HR attendance | 🟡 `hr_attendance` online-only (Oct research §2.4) | GPS-vs-assigned-site is PMO's planned answer (#1517) |

### Spine 6 — Billing / AR

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Sales invoices without an ERP (PMO-native, SoD author/approver) | ✅ `pages/SalesInvoices.tsx`, `no-erp-revenue.spec.md` (OD-REEL-1, 0262) | ❌ | — (ERPNext owned it) | — | — | Closed the June "AR-absent" hole |
| Billing by work order (drawdown of the client PO, per-line earned value) | ✅ ADR-0080, `InvoiceWorkOrderModal.tsx`, `src/lib/db/workOrderBilling.ts`; contract-vs-other billing split: #1471 | ❌ | ❌ | 🟡 SO-based | 🟡 SO/milestone | #1471 in the Now queue |
| Periodic progress claims → invoices, evidence-gated | ✅ `progress-billing.spec.md` (DD-PBL separation: PM assessment ≠ Finance claim) | ❌ | ❌ | ❌ | ❌ | |
| Down payments (advance-item invoice lines) | ✅ ADR-0077 | 🟡 | 🟡 | ✅ | ✅ down payments | |
| Incoming payments, settlement basis, one outstanding oracle | ✅ `pages/IncomingPayments.tsx`, `IncomingPaymentFormModal.tsx`, 0392 settlement basis; apply-from-drawer: #1415 | ❌ | ✅ payment entry | ✅ | ✅ | |
| Receivables position / AR aging | ✅ `/finance/receivables` overdue totals (`ReceivablesPage.tsx`, `src/lib/db/revenue.ts`) | ❌ | ✅ AR + AP aging | ✅ | ✅ Enterprise reports / CE basic | AP-side position exists (`PayablesPage.tsx`) but without aging detail |
| Retention (withheld %, release) | ❌ DD-PBL-11 out of scope, needs its own decision — no issue | ❌ | ❌ | 🟡 | ❌ not native | EPC-prospect gap; ledger entry |
| Invoice PDF | ✅ `invoice-pdf.spec.md` | ✅ | ✅ | ✅ | ✅ | |
| e-Faktur / tax-document generation | ❌ PMO captures NSFP, generation lives in the ERP; read-back: #1506 (O3) | ❌ | 🟡 | 🟡 regional | ✅ `l10n_id_efaktur`/Coretax | ERP owns statutory docs (ADR-0048) |

### Spine 7 — Accounting and statements

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| General ledger / journal engine | — deliberate: no homegrown ledger, ERP owns money-that-happened (ADR-0048/0055) | — | ✅ (ERPNext underneath) | ✅ | 🟡 CE Invoicing has `account`; dynamic reports are Enterprise | |
| Financial statements surfaced in PMO (ERP-sourced, refreshed) | ✅ `pages/FinancialStatements.tsx`, `financial-statements.spec.md` (OD-FS-023/024/025); PMO-only orgs get none: #1494 | ❌ | 🟡 (ERP UI) | ✅ | 🟡 CE: no dynamic report viewer (Oct research §3) | #897 map owns the audit-pack destination |
| Monthly management pack (revenue/earned/billed) | ✅ `pages/ManagementPack.tsx` (0245, `monthly-management-pack.spec.md`) | ❌ | ❌ | 🟡 | 🟡 Enterprise | |
| ERP purchases read-back (AP visibility) | ✅ `pages/ErpPurchases.tsx`; full headless actuals slate: #562 | — | — | — | ❌ until O4 (#1507) | |
| Manual journal entries (maker-checker) in PMO | ❌ #895 | ❌ | ❌ | ✅ | ✅ | |
| Period / year-end close in PMO | ❌ #894 map, #900 | ❌ | ❌ | ✅ | ✅ Enterprise-leaning | |
| Bank book + reconciliation | ❌ #896 | ❌ | ❌ | ✅ | ✅ (recon feeds Enterprise) | |
| Fixed-asset register + depreciation view | ❌ #899 (+ Odoo screens #1511) | ❌ | ❌ | ✅ Assets | ✅ `asset` module (CE) | |
| Tax registers for monthly returns | ❌ #898 | ❌ | ❌ | 🟡 regional | ✅ `l10n_id` reports (Enterprise `account_reports`) | |
### Spine 8 — Documents

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Document register with SoD status workflow (approver ≠ author, frozen issued content) | ✅ `project_documents` (0017) + Documents tab on `/projects/:id/documents` | 🟡 doc management | 🟡 procurement_document | 🟡 attachments | 🟡 attachments | The controlled-register model is stronger than generic file stores |
| File upload to org-scoped storage | ✅ 0025 `document_file_upload`, `document-file-upload.spec.md` | ✅ 100 GB–1 TB per plan | 🟡 | ✅ | ✅ | Closed since June (was "Storage disabled") |
| In-app file preview (uploads + SharePoint links) | ❌ #1474 / #1406 (spec proposed 2026-10-28) | ✅ | ❌ | 🟡 | ✅ | Now-queue item |
| M365 SharePoint/OneDrive linking (record folders, versions, drift badge) | ✅ `src/components/m365/*` (`LinkedDocumentCell.tsx`, `LinkedFolderFiles.tsx`, `DocumentDriftBadge.tsx`, 0292) | ❌ | ❌ | 🟡 | 🟡 MS via third-party connectors | Microsoft stays the permission authority |
| Transmittals / RFIs / submittals | ❌ no issue | 🟡 (report forms) | ❌ | ❌ | 🟡 via modules | EPC evidence loop (epc gap 9); register + workflow is 70% of the seam |
| Document numbering (minter) | ✅ OD-PROC-3 pattern + OD-ID-1 (`OrgProjectNumberPattern.tsx`) | ✅ | ✅ | ✅ naming series | ✅ sequences | |

### Spine 9 — Field / mobile

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Responsive mobile shell (table↔cards, drawers, touch targets) | ✅ ux-wave mobile program (Wave 4), `AppShell` rail/drawer | ✅ native apps | 🟡 | ✅ responsive | ✅ CE web; native apps are Enterprise (Oct research §2.8) | |
| Installable PWA + offline reads | ❌ spec proposed 2026-09-29 (#718; superseded by #1520 scope) — #1520 | ✅ offline mode (Pro Plus+) | ❌ | ❌ | ❌ online-only | KANNA charges a premium for this; T9 makes it table stakes for the EPC prospect |
| Offline field capture with queued sync + Needs-fixing list | ❌ #1520 (T9; money/approvals stay online) | ✅ | ❌ | ❌ | ❌ | |
| Daily site report (volume, crew hours, equipment, materials, photos) | ❌ #1522 (T11) | ✅ reporting + photo reports + signatures | ❌ | 🟡 assembled from entries | ❌ not native | |
| GPS attendance vs assigned site, overtime/leave requests | ❌ #1517 (T6) | 🟡 | ❌ | 🟡 kiosk/web | 🟡 Enterprise GPS, online-only | |
| In-app notifications inbox | ✅ `src/components/shell/NotificationBell.tsx`; automation deliveries pending: #1537; channel choice (push/Lark/email): #1520 | ✅ | ❌ | ✅ notification log | ✅ | |
| Native mobile app | ❌ deliberate park (OD-CR-6, re-affirmed OD-CR-12) | ✅ iOS/Android | ❌ | 🟡 Frappe/HR app | 🟡 Enterprise only | Responsive PWA is the chosen surface |

### Spine 10 — HSE / quality

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Incident register (severity, file → investigate → close) | ✅ `pages/Incidents.tsx`, `IncidentDetail.tsx` (`incidents` org feature) | ❌ | ❌ | 🟡 (via support/QC) | ❌ | |
| Inspections / NCR / quality procedures | ❌ no issue (spine map) | 🟡 report forms | ❌ | ✅ `quality_management` module | ❌ Quality app is Enterprise | ERPNext is the outlier-strength comparator |
| Daily safety logs | ❌ rides #1522 | ✅ | ❌ | ❌ | ❌ | |

### Spine 11 — Assets / inventory / fleet

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Equipment / asset register with maintenance | ❌ #899 (assets), #1519 (usage/allocation), #1511 (Odoo fleet screens) | 🟡 | ❌ | ✅ `assets` + `maintenance` modules | ✅ `fleet` + `maintenance` native (Oct research §2.2) | Biggest PMO gap vs the ERPs |
| Equipment usage capture + cost allocation by rule | ❌ #1519 (T8, extends shipped cost attribution 0376) | ❌ | ❌ | 🟡 | ❌ no engine-hours model | EPC-prospect need; nobody has hourly allocation natively |
| Inventory: items, warehouses, receipts, transfers, counts | ❌ #1512 (T1; standalone-authority mode) | ❌ | ❌ | ✅ `stock` | ✅ `stock` multi-warehouse | |
| Project material issue / consumption vs BoQ | ❌ #1512 / #1508 (O5) | ❌ | ❌ | 🟡 needs customisation | ❌ no analytic distribution on stock moves (Oct research §2.1) | PMO-over-ERP solves the analytic gap stock Odoo can't |
| Reorder rules | ❌ inside #1512 | ❌ | ❌ | ✅ reorder item | ✅ orderpoints | |

### Spine 12 — People / roles / admin

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Built-in roles with RLS on every table + org tenancy seam | ✅ 5 roles, `src/auth/policy.ts`, ADR-0016/0017 | 🟡 role mention only | ✅ | ✅ role permissions | ✅ groups | RLS-everywhere + org_id seam is PMO's compliance floor |
| Org-configurable role × module × action × scope matrix | ❌ #902 map (route R1 in the Odoo plan) | 🟡 plan-tiered | ✅ ERPNext roles | ✅ | 🟡 groups only | |
| Additional built-in roles (Project admin, Operational manager) | ❌ #1409, #1407 | — | 🟡 | ✅ | ✅ | |
| User admin, invites, per-user profile language | ✅ `/administration/users` (`AdminUsers.tsx`), `/settings/profile` (`ProfileSettings.tsx`) | ✅ | ✅ | ✅ | ✅ | |
| View-only impersonation with banner | ✅ `ImpersonationProvider` + banner (App.tsx) | ❌ | ✅ dev impersonation | ✅ login-as | 🟡 dev-side sudo | |
| Per-org feature entitlements | ✅ `org_features` + `pages/AdministrationFeatures.tsx` (FR-ENT-001) | ✅ plan tiers | ❌ | 🟡 module toggles | ✅ apps per edition | |
| AI credits + usage metering per org/user | ✅ `pages/AdministrationCredits.tsx`/`Usage.tsx`, `src/lib/db/usage.ts` | — | — | — | — | Unique to PMO's agent tier |
| Append-only record change history | ✅ `record-change-history.spec.md`, `recordChanges.ts` | ✅ Enterprise audit | 🟡 | ✅ versions | ✅ | |
| Operator CLI (checks, starting data) | ✅ `pmo-cli.spec.md`, `client-starting-data-cli.spec.md`, OAuth consent route (`/oauth/consent`) | ❌ | ❌ | ✅ bench CLI | ✅ | Operator-grade, not just shell access |
| Employees, site assignments, rotation roster | ❌ #1516 (T5) | 🟡 | ❌ | ✅ HR | ✅ HR | First payroll increment on the EPC route |

### Spine 13 — Integrations

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| ERPNext adapter: money write-through, read-backs, SoT/enhancement, recoverable outbox | ✅ `supabase/functions/erpnext-*` (onboard/sweep/webhook), `external-adapter-seam.spec.md`, ADR-0055 | ❌ | ✅ (it is a Frappe app — same substrate) | — | — | The hub moat's first leg |
| Odoo adapter (stock JSON-2, master data → purchases → invoices → actuals) | ❌ #1504–#1511 (O1–O8 route) | ❌ | ❌ | — | — | Next leg; Director-dispatched slices |
| ClickUp 2-way task sync | ✅ ADR-0056, `supabase/functions/clickup-*` | ❌ | ❌ | ❌ | ❌ | |
| M365: SSO + server-side Graph token custody + SharePoint/OneDrive linking | ✅ `supabase/functions/m365-token-custody`, `/integrations` (`Integrations.tsx`), ADR-0060/0063/0064 | 🟡 Gmail/Outlook listing (Capterra, low confidence) | ❌ | 🟡 | 🟡 Google native; MS third-party | Email/meeting *capture* still open (Spine 1) |
| Lark: assistant DMs + approval cards | ❌ #1521 (T10); webhook research 2026-10-30 | ❌ | ❌ | ❌ | ❌ no native Lark (Oct research §2.9) | Indonesia-market wedge |
| Google Workspace (calendar/Gmail) | ❌ research only (`docs/research/2026-10-30-lark-google-workspace.md`) — no issue | ❌ | ❌ | 🟡 | ✅ native `google_calendar` | |
| Inbound webhooks with verify→200→enqueue + sweeps | ✅ OD-INT-11 pattern (all `*-webhook`/`*-sweep` functions) | ❌ | ❌ | ✅ native webhooks | ✅ `base_automation` + watermark sweep (Oct research §2.4) | Same two-tier architecture Odoo recommends |
| Public API / MCP / external programmatic access | 🟡 API-client foundation (0367, `/oauth/consent`); public API + MCP: #720 map | ❌ | ❌ | ✅ REST API | ✅ JSON-2 API (self-host unrestricted) | Reseller/partner prerequisite |
| Teams/Slack-class outbound notifications | 🟡 in-app + agent automations (ADR-0044); Teams Adaptive Cards = M365 Phase 2 (not built) | ❌ | ❌ | 🟡 | ✅ Discuss/email | |

### Spine 14 — AI assistant

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Assistant panel reading the RLS-scoped business surface (⌘J, ⌘K ask) | ✅ `src/components/panel/AssistantPanel.tsx`, `supabase/functions/agent-chat`, ADR-0050 charter | ✅ AI insights + "AI MCP" (Jul refresh) | ❌ | ❌ | 🟡 AI add-ons lean Enterprise | |
| Confirm-gated write actions re-authorized server-side (SoD intact) | ✅ `agent-write-actions.spec.md`, `needs-approval` event model | ❌ | ❌ | ❌ | 🟡 | The governance substrate no comparator has |
| Higher-order actions: draft invoice, compose view, create automation, notify | ✅ `agent-compose-action.spec.md`, `assistant-invoice-reach.spec.md`, `src/lib/agent` actions | ❌ | ❌ | ❌ | ❌ | |
| Agent credits/usage + automations + notifications | ✅ `agent-usage-credits.spec.md`, ADR-0044; pending deliveries: #1537 | — | — | — | — | |
| Model governance: eval harness, quality tuning, spec-author | ✅ ADR-0052, `agent-model-tuning.spec.md`, `agent-spec-author.spec.md` | ❌ | ❌ | ❌ | ❌ | Deployed model is a weak tool-selector; the eval harness is the real gate |
| Voice dictation for field entry | ❌ no issue | ✅ AI voice reporting | ❌ | ❌ | ❌ | KANNA demo feature; low priority |
| Live reconnect + run persistence | ✅ `agent-live-reconnect.spec.md`, `agent-run-persistence-hardening.spec.md` | — | — | — | — | |

### Spine 15 — Localisation

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| i18n framework (i18next, lazy per-locale catalogues, EN-source fallback) | ✅ `src/lib/i18n/index.ts`, `i18n-framework.spec.md` (OD-CR-3) | ✅ 5 languages | ✅ id-ID | ✅ translations | ✅ | Closed since June ("English-only") |
| Bahasa Indonesia catalogues + per-org locale, per-user override | ✅ `public/locales/{en,id}` (23 namespaces each), `.bahasa.test.tsx` guards, DD-I18N/OD-CR-4 | ✅ (ID launched Dec 2025) | ✅ | ✅ | ✅ `l10n_id` lang | |
| Multi-currency per record + org currency + FX upload (JISDOR) | ✅ OD-CR-5 currency columns, `fxRates.ts`, `fx-rates-jisdor.spec.md` | 🟡 | 🟡 IDR only | ✅ | ✅ | |
| Indonesian tax configuration in-app (PPN defaults, vendor tax accounts, withholding accounts) | ✅ `OrgTaxDefault.tsx`, `OrgVendorTaxAccounts.tsx`, `OrgWithholdingAccount.tsx` | ❌ | 🟡 | 🟡 regional setups | ✅ `l10n_id` fiscal localization | Statutory *filing* stays in the ERP (§ Spine 7) |
| Timezone-safe money/dates (export + display) | ✅ `dateTz` test batteries across pages/exports | — | 🟡 | ✅ | ✅ | |

### Spine 16 — Reporting / dashboards

| Capability | PMO v0.28 | KANNA | RIS-portal-2 | ERPNext | Odoo 20 CE | Notes |
|---|---|---|---|---|---|---|
| Role-adaptive executive dashboard (exec/finance/PM/engineer/admin lenses) | ✅ `pages/ExecutiveDashboard.tsx` → `components/dashboard/*` (`CompanyDashboard`, `PMDashboard`, `FinanceDashboard`, `EngineerDashboard`) | ✅ company dashboard (Enterprise tier) | ✅ `executive.py` | 🟡 | ✅ | Dashboard residuals: #1418 (true top-5), #1461 (drill-through exactness) |
| Saved user views + visual view builder | ✅ `/views`, `ViewBuilderPage.tsx`, `user-views.spec.md` (`userViews` flag) | ❌ | ❌ | 🟡 report builder | ✅ custom filters | |
| Custom report templates (fields, signatures, PDF/Excel) | ❌ fixed management pack — no issue | ✅ Pro Plus+ custom reports | ❌ | ✅ print formats | 🟡 Studio is Enterprise | KANNA's most-praised feature; deliberate absence so far |
| CSV/Excel export | ✅ `src/lib/export/toCsv.ts` + `toWorkbookBuffer.ts` (`import_export` feature) | ✅ | 🟡 | ✅ | ✅ | Closed since June |
| Honest drill-through (dashboard → exact list the figure counts) | ✅ OD-W5-C2-D honest-doorway rule; residual: #1461 | 🟡 | 🟡 | 🟡 | ✅ | |
| Alerting / attention surfaces (at-risk thresholds, stale win-rate, neglected deals) | ✅ at-risk ≥0.9 (OD-W5-C2-A), aging 0020, 0385; agent automations extend | ✅ AI insights | 🟡 | 🟡 | 🟡 | |
---

## 3. Gaps worth closing

Sizes: S ≤ a few days · M ~a slice · L multi-slice · XL a program. "Who needs it": **RIS** = the first client's live needs · **EPC** = the EPC prospect on Odoo · **SaaS** = general contract-business buyers.

### 3a. Already tracked — the open-issue queue is the answer

| Gap | Spine | Who | Size | Issue |
|---|---|---|---|---|
| Daily site report (volume/crew/equipment/photos) | 4/9/10 | EPC | M | #1522 |
| Offline capture PWA + targeted push | 9 | EPC, SaaS | L | #1520 |
| GPS attendance + overtime/leave requests | 5/9 | EPC | M | #1517 |
| Employees, assignments, rotation roster | 12 | EPC | M | #1516 |
| Manual payroll sheet + payslips | 12 | EPC | L | #1518 |
| Site imprest plan + replenishment | 5 | EPC | M | #1515 |
| Time-and-materials claims | 6 | EPC | M | #1514 |
| Subcontract acceptance, caps, variations (incl. client-chargeable variations) | 3/4 | EPC | L | #1513 |
| Inventory + project consumption vs BoQ | 11 | EPC | XL | #1512 |
| Equipment usage + cost allocation | 11 | EPC | M | #1519 |
| Fixed-asset register + depreciation (+ Odoo fleet/maintenance screens) | 11/7 | EPC, SaaS | M/L | #899, #1511 |
| Odoo adapter O1–O8 (master data → purchases → invoices → actuals → stock → cash → labour → fleet) | 13 | EPC | XL | #1504–#1511 |
| Lark assistant + approval cards | 13/14 | RIS, SaaS | M | #1521 |
| Contract billing vs other billing on a project | 6 | RIS | M | #1471 |
| Whole-project budgets with yearly spread to ERPNext v16 | 2 | RIS | M | #1472 |
| Paste budget rows from any spreadsheet | 2 | RIS | S | #1473 |
| Budget vs actual over whole project duration | 2 | RIS | M | #1425 |
| Document preview (uploads + SharePoint) | 8 | RIS, SaaS | S/M | #1474 |
| Financial statements for PMO-only orgs (no ERP) | 7 | SaaS | XL | #1494 (+ #897 map, Stage-3 questions) |
| Journals / period-close / bank recon / tax registers in PMO | 7 | SaaS (post-ERP) | L each | #895, #894/#900, #896, #898 |
| Budget: propose lines from an uploaded budget document | 2 | SaaS | M | #1466 |
| First captured document advances a request-less procurement in one step | 3 | RIS | S | #1465 |
| Organisation-declared fiscal-year dates | 2/7 | RIS | S | #1464 |
| Payment applied to invoices from the payment drawer | 6 | RIS | S | #1415 |
| Approver can return a budget draft to the PM | 2 | RIS | S | #1413 |
| Roles: Project admin / Operational manager | 12 | SaaS | M | #1409, #1407 |
| User-defined roles and permissions | 12 | SaaS | XL | #902 map |
| Public API, MCP, assistant write reach | 13/14 | SaaS, resellers | L | #720 map |
| Withholding: separate PPh 23 vs PPh 4(2) prepaid accounts | 3/6 | RIS | S | #1275 |
| Agent automation deliveries (pending alerts) | 14 | SaaS | S | #1537 |
| Approval queues unified (bulk on every queue) | 3/5 | SaaS | M | #1072 |

### 3b. Untracked — worth an issue (none exists today)

| Gap | Spine | Who | Size | Why it matters |
|---|---|---|---|---|
| Retention in progress billing (held/released %) | 6 | EPC | M | Standard EPC contract mechanic; DD-PBL-11 explicitly deferred it pending a decision — PPN tax-base question needs an owner ruling first |
| Stage-gates / execution phases | 4 | EPC, SaaS | M | "Don't start Construction before Engineering is IFC" is the contractor control loop; OD-DEL-6 removed gates from the milestone model — needs an owner revisit, not a workaround |
| Task baseline vs actual (baseline dates + % complete) | 4 | SaaS | M | Without it the schedule honesty story stops at delivery-%; Gantt exists but nothing answers "late vs plan" |
| M365 email/meeting capture → CRM activities (manual-log v1 per OD-CR-2) | 1/13 | RIS, SaaS | M | The Graph custody is shipped and audited; this is the highest-leverage CRM-v2 piece nobody else in the set can do credibly |
| Follow-up / next-action reminders on deals and contacts | 1 | SaaS | S/M | Pipeline aging detects neglect but offers no remedy loop (C2) |
| Win/loss reasons + win-rate analytics | 1 | SaaS | S | One field + one transition hook (C4); feeds the stale-win-rate tile that already exists |
| Bulk procurement approve + mandatory rejection comment | 3 | RIS | S | R2/R3 from the Jul program; OD-CR-1 ordered them as quick wins — still unbuilt, never filed |
| Copy-last-week on timesheets | 5 | RIS | S | R8; smallest friction fix in the set |
| Org-defined cost codes (open the OD-BUDGET-4 seam) | 2 | EPC, SaaS | M | Estimating feedback loop; BoQ work items cover quantity grain but not the cost-code dimension |
| RFI / submittal loops (ball-in-court, due, answered) | 8 | EPC | M | `project_documents` SoD workflow is 70% of it; schedule-risk evidence contractors argue from |
| Custom report templates (fields/signatures, PDF) | 16 | EPC, SaaS | L | KANNA's most-praised feature; only worth it after #1522 makes site reports structured data |
| Google Workspace connector (calendar sync) | 13 | SaaS | M | Odoo CE ships it natively — an easiest-to-match parity item; research exists (2026-10-30), no build |
| True top-5 attention read model | 16 | SaaS | S | #1418 exists — listed here only to note it is dashboard-honesty, not a feature gap (tracked) |

*No double-counting: items in 3b were checked against the open-issue list (`gh issue list --state open`) on 2026-10-31; anything tracked moved to 3a.*

---

## 4. Where we deliberately don't compete

Cited rulings live in `docs/decisions.md` and the ADR set; this section is the sales-safe summary.

1. **No homegrown ledger, ever.** Accounting/GL/tax-filing belongs to the ERP (ERPNext default, Odoo supported); PMO displays ledger-sourced figures and never recomputes them — ADR-0048 + ADR-0055 (money principle). Period close and e-Faktur stay in the ERP's native UI until explicitly picked up (ADR-0048; Stage-3 questions in the Odoo route plan).
2. **In-house chat / video.** Parked — OD-CR-6 (2026-07-22, confirmed parked). Communication tools are Cicle-class turf; PMO integrates (Lark #1521, Teams later) rather than builds.
3. **Native mobile app.** Parked — OD-CR-6, re-affirmed by OD-CR-12 (PWA un-parked for installable + offline reads; native stays out). The phone surface is the responsive PWA (#1520).
4. **Odoo customisation.** Zero custom modules, stock Community API only; Enterprise features are a commercial bonus, never a dependency — owner ruling 2026-10-30 (Odoo native-coverage research; ADR-0055 stock-API rule).
5. **Field photo-forms as a KANNA-style flagship.** Parked by OD-CR-6, *partially* superseded for the EPC prospect: the daily site report (#1522) and offline capture (#1520) exist as route tickets — PMO competes for the field seat only where it feeds the governed record (progress, consumption, payroll input), not for generic photo-chat.
6. **Horizontal CRM breadth.** CRM serves the vertical thread (deal → cash), not contact-manager parity — moat verdict in `2026-07-22-competitive-refresh-ris-cicle.md`; the Model A opportunities split stays deferred (ADR-0020).
7. **User-configurable workflows/statuses as a selling point.** Stages stay developer-configured; the OD-PROC-6/R1 config engine (#902) is about roles and scopes, not a KANNA-style "define your own everything".
8. **Offline money and approvals.** Even under T9 (#1520), approvals, money and shared-record edits stay online by design — offline is capture-only, server-validated on sync.
9. **Competing with the adapters' targets.** The offer over an ERP-owning client is "PMO as the only interface you need over your ERP" (the EPC route, #1481) — not replacing ERPNext/Odoo where they are natively strong (stock valuation, statutory, assets); the per-ERP capability map is a commercial argument, not an engineering workaround (ADR-0055).

---

## Sources

- PMO: this worktree at `origin/dev` — `pmo-portal/App.tsx` route table, `pmo-portal/pages/**`, `pmo-portal/src/lib/db/**`, `supabase/migrations/` (0001–0407), `supabase/functions/`, `docs/specs/` (134 specs), `docs/decisions.md` (OD-*), `docs/roadmap-spines.md`, `docs/product-expectations.md`.
- Baselines re-checked: `docs/reviews/2026-06-11-kanna-gap-analysis.md`, `docs/reviews/2026-07-22-competitive-refresh-ris-cicle.md`, `review/epc-gap-analysis.md`.
- RIS-portal-2: local source inventory (feature names only; private repo respected).
- ERPNext: `docs/adr/0048`, `docs/adr/0055`; local bench `apps/erpnext/erpnext/` module listing.
- Odoo 20: `docs/research/2026-10-30-odoo20-native-coverage.md`, `docs/research/2026-10-30-odoo20-api.md`, `docs/plans/2026-10-30-epc-odoo-build-route.md`.
- Open work: `gh issue list --state open --limit 300` (2026-10-31) and the pinned roadmap #1571.

Deviation note: the spine list in the brief (16 spines) is covered above in the same order; none skipped, none merged.

DONE: feature comparison 2026-10-31
