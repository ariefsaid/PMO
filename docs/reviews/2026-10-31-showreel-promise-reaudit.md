# Showreel promise re-audit: 2026-10-31

**Question.** The first audit (`2026-10-05-showreel-promise-audit.md`, 41 promises) found 17 delivered, 17 partial,
5 missing and 2 hidden by flag. Since then the owner ruled "the reel stays as cut, the product catches up"
(OD-REEL-1) and about 30 tickets under map #791 shipped. Where does every promise stand today?

**Scope.** `origin/dev` at `bff3afa00` (2026-10-31). Reel source: `~/Coding/pmo-trailer/src/scenes/*.tsx` (hook,
problems, reveal, product stage, feature wall, ERP, close), read in full; the 41 old promises were re-read against it and
four reel details the first audit did not list were added. Times are global seconds on the reel's story clock
(hook 0 to 6, problems 6 to 16, reveal 16 to 20, product 20 to 34, wall 34 to 37, ERP 37 to 40, close 40 to 46).

**Method and limits.** Static, like the first audit: every verdict rests on a named file, migration, route or ruling
at `origin/dev`. **No live click-through was run** (that is what #1598 files). Production build flags are known from
commit history only (`.env.production` was not opened). The assistant's behaviour on the deployed model is unproven:
no recorded eval run was found (searched `docs/`, both changelogs, `docs/backlog.md`).

**Status key.** *Delivered*: a named file, route or table does it. *Partial*: some ships, or it ships with a caveat a
buyer would notice, or it is off for a new org. *Missing*: nothing does it.

**Totals: 45 promises. 28 Delivered, 14 Partial, 3 Missing.** Then (2026-10-05) for the 41 old rows: 17 Delivered,
17 Partial, 5 Missing, 2 Hidden. Four rows are new (32, 33, 37, 45). Eight new issues filed (#1592 to #1599);
the rest of the gaps reuse open issues.

**What moved.** Customer billing without an ERP, comments, workflow notifications, record history, Bahasa on the money
screens, still-to-invoice, the assistant's overdue answer and invoice draft, and self-serve ERP connect all shipped.
**What did not:** an owner ruling (billing by work order, OD-BILL-1) now contradicts the three central beats
(Plan, Bill, Get paid); the assistant's invoice draft only works with an ERP; there is no PWA; no trend line;
connect-later is ruled but unspecified.

---

## 1. Promise table

Status is *then → now*. "Old #" is the row in the 2026-10-05 audit.

| # | Promise (scene, time) | Old # | Status | Evidence at origin/dev | Gap: what the viewer sees that the product cannot do | Issue |
|---|---|---|---|---|---|---|
| 1 | Project chatter moves out of the chat group: "Any update?", "Which version is final??", "Who approved this?" (hook, 0 to 6) | 1 | Partial → Delivered | Comments on projects and tasks: `supabase/migrations/0249_comments.sql:1`, `src/components/comments/CommentsSection.tsx`, mounted at `pages/project-detail/ProjectActivity.tsx:32` and `tabs/TasksTab.tsx:1656`. Mentions notify (0249 header) | None for the promise. PMO does not read the chat group itself | #790 (closed) |
| 2 | Email stops holding the project: "Inbox · 48 unread", "RE: RE: FW: Harbor contract (final)", "Invoice for milestone 2?" (hook) | 2 | Hidden → Partial | `m365_integration: false` by default (`src/lib/features.ts:107`). Microsoft connection proven in the first client's tenant 2026-10-14 (#598 closure note); it links files and folders | No email or meeting lands on a record. Logging an Outlook item against a company or contact is only a ticket. Off until an operator entitles it | #1575 |
| 3 | Budgets leave spreadsheets: "Budget_v7_FINAL.xlsx", "#REF!", "Spreadsheets nobody trusts" (hook, problems 6 to 9) | 3 | Delivered → Delivered | Budget area `pages/project-detail/tabs/BudgetTab.tsx:5` → `pages/ProjectBudget.tsx`; versions drawer `pages/project-detail/budget/BudgetVersionsDrawer.tsx`; workbook import `pages/projects/ProjectsToolbar.tsx:278` (`import_export` on by default, `features.ts:103`) | Pasting rows from any spreadsheet is not built | #1473, #1466 |
| 4 | One version of every contract: "Shared drive / Contract_v3_final_REVISED.pdf", "Five versions of every contract", "The only version" (hook, problems 9 to 11, Plan) | 4 | Delivered → Delivered | Register, upload, New revision, `parent_document_id` chain, `Superseded` status: `tabs/DocumentsTab.tsx:40,198,353`; SharePoint linking `tabs/useDocumentMicrosoft.ts` | Viewing a file inside PMO (the reel shows a card) is not built; the contract file sits in the Documents area, not on the Overview card | #1474, #1406 |
| 5 | Tasks leave the task app: "Tasks — Harbor", "overdue 42d" (hook) | 5 | Delivered → Delivered | `tabs/TasksTab.tsx`; overdue sort `pages/MyTasks.tsx:17` | None | none |
| 6 | The ERP's mandatory fields stop being the user's problem: "Mandatory fields required: Cost Center, Debit To, Party Type" (hook, problems 6 to 9) | 6 | Partial → Delivered | Admin self-serve setup: `src/components/integrations/ErpSetupChecklist.tsx:391,398,415` (work category, customer billing account, business information); reviewed project matching `src/components/integrations/ProjectMatchReview.tsx`; invoice lines pick an ERP item `pages/sales-invoices/SalesInvoiceFormModal.tsx:122-131` | Linking many projects is still one dialog each; the project-page setup shortcut disagrees with the reviewed path | #1043, #1215 |
| 7 | "Who approved this?" is answerable (hook, chase 11 to 13) | 7 | Partial → Delivered | Change history on every record: `src/components/history/RecordHistory.tsx`, `ProjectActivity.tsx:34`, `TasksTab.tsx:1660`; procurement events filed under the procurement (#878) | None | #719 (closed) |
| 8 | Updates stop being a chase: "Did the client sign?", "Where is the file?", "Any update??" (chase, 11 to 13) | 9 | Partial → Delivered | Hand-off notifications for procurement, timesheets, expense claims, task assignment and mentions: `supabase/migrations/0237_workflow_notifications.sql:1`; the bell shows for every user: `src/components/shell/ContextBar.tsx:60-63` | A customer invoice waiting on an approver adds to the Approvals queue but sends no notification (see row 22) | #1595 |
| 9 | "Is it invoiced yet?", "Work done. Not billed.", "Day 42 · Rp 850.000.000 still not invoiced" (problems 13 to 16) | 8 | Missing → Partial | Per-work-order invoiced / paid / remaining (OD-BILL-1, #892): `tabs/WorkOrdersTab.tsx:1110`; dashboard figure `src/components/dashboard/restructure/useCompanyFigures.ts:254` and "Needs you" `useNeedsYou.ts:290`; Finance card `src/components/dashboard/StillToInvoiceCard.tsx`; project finances "Remaining to invoice" (`public/locales/en/common.json:4467`) | The reel counts days since a **milestone** finished. The product counts what is left on a **PO** and shows no age. A phase marked Done and never invoiced is flagged nowhere | #1592 |
| 10 | "Projects, people and money. In one place." (reveal, 16 to 20) | 10 | Partial → Delivered | Vendor side native; customer invoices and receipts native (row 38); roles, timesheets, expense claims | Statements need an ERPNext connection (#1494, outside the reel) | #1494 |
| 11 | Pipeline Lead → Tender → Negotiation → Won, stage totals, deal count (Win, 20 to 23) | 11 | Delivered → Delivered | `/sales` (`App.tsx:168`) → `pages/SalesPipeline.tsx:48`; columns Leads, Pre-Qual, Quotation, Tender, Negotiation, Won, Lost: `components/salesPipeline.ts:48-90`; CRM on in the production build (commit `4f3f9740c`) and per org (`features.ts:100`) | The reel shows four columns, the product seven | none |
| 12 | The deal card moves from column to column (Win, 20 to 23) | 12 | Partial → Partial | Stage changes happen on the deal record: `pages/project-detail/PipelineLens.tsx`. No drag-and-drop by ruling: `docs/decisions.md:336` (OD-W3-4) | The board has no drag. A buyer will try to drag the card | #1593 |
| 13 | Winning records the signed contract value with no re-keying: toast "Contract signed · Rp 4.25 bn" (Win) | 13 | Delivered → Delivered | Mark won keeps the deal value and requires the customer contract reference and date: `PipelineLens.tsx:248-262`; value authority in the database (`holds_won_value_authority`, migration 0179/0183) | Two required fields (reference, date) the reel does not show | none |
| 14 | Project page holds contract value, "Active" status and the signed contract (Plan, 23 to 26) | 14 | Delivered → Delivered | `pages/project-detail/ProjectDetailHeader.tsx:587`; Documents area (row 4) | No "Signed" pill: document statuses are Draft, Issued, Approved, Rejected, Closed, Superseded (`database.types.ts:10720`) | #1593 |
| 15 | Milestones on a schedule: four bars with dates (Plan) | 15 | Delivered → Delivered | `pages/project-detail/MilestoneStrip.tsx`, `ProjectGantt.tsx`; `project_milestones.target_date` (`database.types.ts:5975`). The screen calls them **Phase** (DD-VOCAB-1, `docs/decisions.md:3237`) | The reel says "Milestone" | #1593 |
| 16 | Milestones carry an amount (M2 = Rp 850.000.000) and a billing status: Planned, In progress, Done, Paid (Plan 23 to 26, Bill 29 to 32) | 16 | Missing → Missing | `project_milestones` has name, date, weight, `input_pct`, no amount, no status (`database.types.ts:5975-5986`). OD-BILL-1 (`docs/decisions.md:3162`, 2026-10-07) ruled "no amount, no invoice points at a milestone" and superseded the milestone design of #785. OD-REEL-1 (`:2894`, 2026-10-05) had said build it | The Plan table's Amount and Status columns and the green M2 "Done" then "Paid" pill | #1592 |
| 17 | "Contract, milestones and budget, together." (Plan) | 17 | Delivered → Delivered | Areas Overview, Budget, Procurement, Tasks, Contract & billing, Documents: `pages/project-detail/projectDetailAreas.ts:1` | The Overview can read "Within budget" beside "128% used" (#1531). Budget Spent is blank in a PMO-only org (row 33) | #1531, #1530 |
| 18 | Board ↔ Timeline of every task (Deliver, 26 to 29) | 18 | Delivered → Delivered | List, board, timeline: `tabs/TasksTab.tsx:716-717,816-830`; Gantt `ProjectGantt.tsx` | The board is not draggable (see row 12) | #1593 |
| 19 | Task columns Done / In progress / **In review** / To do (Deliver) | 19 | Partial → Partial | Statuses To Do, In Progress, Done, Blocked: `TasksTab.tsx:75-76`, `database.types.ts:10772` | No "In review" column | #1593 |
| 20 | Assignee avatars, "Client progress meeting" in the plan, a red today line (Deliver) | 20 | Delivered → Delivered | `tasks.assignee_id`, `tasks.meeting_id` (`database.types.ts:7211`), `pages/MeetingDetail.tsx:62`; today marker `ProjectGantt.tsx:238` | None | none |
| 21 | "Every task, every timeline, one view" and a Tasks item in the nav (Deliver) | 21 | Partial → Partial | My Tasks for Project Manager, Finance, Engineer, Admin (`src/components/shell/Rail.tsx:88`); board and timeline per project. Executive has no Tasks item | No cross-project board or timeline; the nav item is "My Tasks" and shows an assignee list | #1593 |
| 22 | The assistant drafts the milestone invoice: "Invoice milestone 2" → "Drafted for Harbor Terminal, milestone 2. Sent to Finance for approval." (Bill, 29 to 32) | 22 | Missing → Partial | `draft_invoice`: `supabase/functions/agent-chat/draftInvoice.ts:488`, registered `handler.ts:120-130`; saves a Draft under the user's name, never approves. Milestone lookup `draftInvoice.ts:245-262` | (a) It refuses unless ERPNext owns revenue: `draftInvoice.ts:154-168` ("has not connected revenue to ERPNext yet"), so the reel's no-ERP setup gets an error. (b) "Sent to Finance" is a queue entry, not a notification. (c) For "Invoice milestone 2" it answers "Milestones don't carry an amount yet. How much should this invoice be, before tax?" (`draftInvoice.ts:375`), so the reel's one-line request ends in a question, not a draft. (d) Reliability on the deployed model is unrecorded | #1595, #1596, #1592 |
| 23 | A different person approves: "Awaiting approval" → APPROVED by a Finance user (Bill) | 23 | Partial → Delivered | No-ERP: `transition_native_sales_invoice` refuses an approver in the author set (`supabase/migrations/0275_native_revenue.sql:1` header); queue section `pages/approvals/SalesInvoiceApprovalSection.tsx`, wired `pages/Approvals.tsx:641-673`. ERP path unchanged | No push notification to the approver (row 8) | #1595 |
| 24 | Payment in → invoice flips to PAID, "Bank transfer" (Get paid, 32 to 34) | 24 | Partial → Delivered | No-ERP: `record_native_receipt` (0275); form `pages/incoming-payments/IncomingPaymentFormModal.tsx`. ERP path: receipt pushed, status read back | None | #784 (closed) |
| 25 | "Payment in. Milestone closed." (Get paid) | 25 | Missing → Missing | Invoices link a project and a work order, never a phase (OD-BILL-1). A work order shows Paid when its invoices are paid | The M2 "Paid" pill on the milestone list when the money arrives | #1592 |
| 26 | Invoices and Payments are standard nav items (product chrome) | 26 | Hidden → Partial | Finance group: Receivables, Payables, Reports, Statements (`Rail.tsx:94-98`). With no entitlement row, `revenue` is **on when no ERP owns revenue, off once an ERP does** (`src/hooks/useOrgFeatures.ts:18-47`, OD-NAR-2; env default `features.ts:105`) | An ERP-connected demo org shows no Receivables until an operator entitles it. The operator can only toggle their own org (#1016). Names differ from the reel (see #1593) | #1016, #1598 |
| 27 | Dashboards: a headline figure with a rising trend line (wall, 34 to 37) | 27 | Partial → Partial | KPI tiles, stage bars, win-rate: `src/components/dashboard/hub/company/CompanyDashboard.tsx:418`. "Board pack" opens Reports when the revenue section is on and the viewer may see it, else a disabled "coming soon": `src/components/reports/BoardPackAction.tsx:15-25` | No figure over time on the dashboard; a monthly series exists only in Reports (`pages/ManagementPack.tsx`) and per project (S-curve) | #1597 |
| 28 | Approvals: "PO-0381 · Rp 96 jt" Pending → Approved (wall) | 28 | Delivered → Delivered | `/approvals` (`App.tsx:178`): procurement, timesheets, customer invoices | None | none |
| 29 | Meetings: "Client review" (wall) | 29 | Delivered → Delivered | `/meetings` (`App.tsx:195`), `pages/MeetingDetail.tsx` | None | none |
| 30 | Procurement Requested → Ordered → Received (wall) | 30 | Delivered → Delivered | `components/ProcurementBoard.tsx:31-34`; `/procurement` | None | none |
| 31 | Timesheets: weekly grid (wall) | 31 | Delivered → Delivered | `/timesheets` (`App.tsx:177`), `pages/Timesheets.tsx` | None | none |
| 32 | Pipeline, Projects (progress bars) and Tasks tiles (wall) | new | n/a → Delivered | Rows 11, 15, 18; delivery-percent chip `components/DeliveryPctChip.tsx` | None | none |
| 33 | Budget tile: plan vs actual bars (wall) | new | n/a → Partial | Plan vs "Spent" from the ERP ledger for ERP-connected orgs (`BudgetErpNotice`) | A PMO-only org sees Budget with Spent blank even with paid vendor invoices in PMO | #1530 |
| 34 | "One app, two languages": Approved / Disetujui (wall) | 32 | Partial → Delivered | `public/locales/id` matches `en`: 6773 keys, 0 missing (counted 2026-10-31 over all 24 namespaces). Budget, Sales Invoices, Incoming Payments, Reports are in `src/lib/i18n/launch-scope-routes.txt` | `/finance/*` pages and the budget projection page are not on the gate list; not rendered in Bahasa this round | #1598 |
| 35 | "On the go": a phone frame (wall) | 33 | Partial → Partial | Responsive layouts. No web manifest and no service worker in `pmo-portal/public/` or `index.html` | Not installable, no offline. #718 was superseded by #1520 (owner-signed 2026-10-30), still open | #1520 |
| 36 | The assistant answers "What's overdue this week?" with "3 tasks, 1 invoice." (wall) | 34 | Partial → Partial | One-call `whats_overdue` across the user's projects plus overdue invoices for roles that may see them: `supabase/functions/agent-chat/overdue.ts:282`, prompt rule `prompt.ts:110,185` | Works only if the deployed model chooses the tool: no recorded eval run (bar: 9 in 10) | #1596 |
| 37 | "...Drafting reminders." (wall) | part of 34 | Partial → Missing | `notify` writes only to the caller's own inbox: `agent-chat/actions.ts:386-390` (ADR-0044 §5) | Reminders to other people cannot be sent | #1594 |
| 38 | "No ERP? No problem. Invoices and payments run right inside PMO." (ERP, 37 to 40) | 35 | Missing → Delivered | Native customer invoice, approval, receipt: `supabase/migrations/0275_native_revenue.sql:1`, `src/lib/repositories/revenueNative.ts`, `pages/sales-invoices/`; revenue entitlement on by default without an ERP (row 26) | Assistant draft (row 22), budget actuals (row 33) and statements (#1494) still need an ERP | #784, #913 (closed) |
| 39 | "Have one? Plug it in. Connect ERPNext" (ERP) | 36 | Partial → Delivered | Admin self-serve connect and company selection (`external-connect`, `external-set-company`), checklist (row 6), parties and contacts adopted (#773) | Bulk matching of existing records (row 6) | #1043 |
| 40 | "...or whenever you're ready" (ERP) | 37 | Partial → Partial | The crossing is OD-XING-1: the ERP starts at connect, pre-connect records are not pushed by default. The owner ruled on 2026-10-31 that PMO syncs in all four connect cases (OD-ERP-ANYTIME-1, `docs/decisions.md:3600`) | The ruling names `docs/specs/erp-connect-anytime.spec.md`, which does not exist; no issue tracked it. A buyer assumes months of history flow in | #1599, #1043 |
| 41 | Invoices flow out, payments flow back; Budgets and Approvals pills (ERP orbit) | 38 | Delivered → Delivered | Outbox push `supabase/functions/adapter-dispatch`; read-back `erpnext-webhook`, `erpnext-sweep`; budget push seam `supabase/migrations/0137_budget_push_seam.sql` | Approvals stay in PMO (the pill implies they sync) | none |
| 42 | Rupiah in local format, tax shown (Rp 850.000.000, Rp 4.25 bn) | 39 | Delivered → Delivered | `src/lib/format.ts:81`, `TaxBasisLabel`, `id-ID` number locale (`format.ts:15`) | None | none |
| 43 | "For contract- and project-based teams." (close, 40 to 46) | 40 | Delivered → Delivered | Generic vocabulary, tender pipeline, client work orders and billing (`tabs/WorkOrdersTab.tsx`) | None | none |
| 44 | "Run the projects, not the systems." (close) | 41 | Partial → Partial | Daily work, customer billing and ERP connect are all in PMO now | Rolls up the gaps in rows 16, 22, 25, 40 | #1592, #1595, #1599 |
| 45 | "What I saw, I can click in a demo" (inferred) | n/a | n/a → Partial | Revenue on by default only without an ERP (row 26); CRM and assistant on in the production build (commits `4f3f9740c`, `4a986bbe`); Microsoft 365 off by default (row 2) | The demo org's entitlements and seed against every beat are unchecked; no rendered walk since the first audit. Demo-org personal-data audit is still open | #1598, #492, #1016 |

---

## 2. Issues filed and reused

**Filed under map #791 (this audit)**, all eight linked as sub-issues (see §4 for the cap).

| Issue | Label | Covers rows |
|---|---|---|
| #1592 Reel vs ruling: bill by milestone (the reel) or by work order (shipped)? | wayfinder:owner | 9, 16, 22, 25, 44 |
| #1593 Reel re-cut list: drag, "In review", Phase naming, nav names, Signed pill | wayfinder:owner | 12, 14, 15, 18, 19, 21, 26 |
| #1594 Assistant reminders to other people: allow, or re-cut | wayfinder:owner | 37 |
| #1595 Assistant: draft a customer invoice without an ERP, and tell the approver | ready-for-agent | 8, 22, 23 |
| #1596 Assistant: record the eval result for the reel journeys | ready-for-agent | 22, 36 |
| #1597 Dashboard: a headline money figure with a trend over time | ready-for-agent | 27 |
| #1598 Showreel walk: rendered click-through of every beat, English and Bahasa | ready-for-agent | 26, 34, 45 |
| #1599 ERP connect anytime (OD-ERP-ANYTIME-1): write the spec, then build | ready-for-agent | 40, 44 |

**Reused (open).** #1575 email to a record (row 2) · #1473, #1466 budget paste and propose (row 3) · #1474, #1406
document preview (row 4) · #1043 bulk record matching, #1215 setup shortcut (rows 6, 39) · #1530 PMO-only Budget
Spent, #1531 "Within budget" label (rows 17, 33) · #1520 PWA (row 35) · #1016 operator entitlement scope, #492 demo
personal-data audit (rows 26, 45) · #1494 statements without ERPNext (rows 10, 38).

---

## 3. Order by demo impact

1. **#1592, the milestone beats (owner).** Plan, Bill and Get paid are the middle 14 seconds of the reel, and the
   Amount and Status columns, "Invoice milestone 2" and "Milestone closed" contradict a standing owner ruling. Nothing
   downstream (assistant, invoice card) is coherent until this is decided. Recommendation in the issue: re-cut to the
   work order.
2. **#1595, assistant invoice draft with no ERP.** It is the Bill beat's headline act, and the reel runs it before
   "No ERP? No problem". Today a no-ERP demo org gets an error at the one moment the reel shows magic.
3. **#1598, the rendered walk and demo-org setup** (with #492, #1016). No beat has been seen running since the first
   audit; the entitlements decide what a prospect sees.
4. **#1596, eval result for the assistant.** Two reel moments (Bill, wall) rest on a weak tool-selector with no
   recorded pass rate.
5. **#1594, reminders (owner).** One wall tile line; cheap to re-cut.
6. **#1530 and #1531, budget Spent for PMO-only orgs and the "Within budget" label.** A no-ERP buyer opens Budget
   right after the Plan beat.
7. **#1597, dashboard trend.** Visible on the wall; a prospect opens the dashboard first.
8. **#1599, connect anytime (and #1043).** Matters for a prospect who already runs an ERP; ruled today, not specified.
9. **#1593, reel re-cut list (owner).** Cosmetic; each item costs one reel edit.
10. **#1575, email capture; #1520, PWA.** Both are "implied" promises that cost a re-word if not built.

---

## 4. Notes

- Map #791 is capped at 100 sub-issues. With the coordinator's OK, closed #769, #771 and #774 were detached from the map
  to make room; they keep their history.
- Not re-read this round: the outbox push and read-back functions in row 41 (their directories exist; behaviour carried
  from 2026-10-05).
- Inferred promises from the first audit that still hold: cards drag (row 12), the whole app in Bahasa (row 34),
  installs on a phone (row 35), connecting brings history (row 40).
