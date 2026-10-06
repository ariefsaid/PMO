# Showreel promise audit — 2026-10-05

**Question:** every promise the PMO Portal showreel makes to a buyer, said or implied, checked against the
shipped product. Shipped means `dev` == `main` == production `0fb733c1`.

**Method.** Each scene file in the trailer repo was read: `before.tsx` (hook and problems), `reveal.tsx`,
`product.tsx` (Win / Plan / Deliver / Bill / Get paid) and `after.tsx` (feature wall, ERP, close). The
promises were extracted from on-screen text, the mock UI and the order of events. Each was then checked
against the file, route, table or decision that settles it. No live click-through was run: every verdict
below rests on code and decisions. A rendered walk on local seed data is the next step before a prospect
sees the reel (see §4).

**Status key.** *Delivered*: a named file, route or table does it today. *Partial*: some of it ships, or it
ships with a caveat a buyer would notice. *Missing*: nothing does it. *Hidden-by-flag*: it is built but off
by default for a new org.

**Totals: 41 promises. 17 Delivered · 17 Partial · 5 Missing · 2 Hidden-by-flag.** 7 new issue drafts (§2).

---

## 1. Promise table

| # | Promise (scene / time) | Status | Evidence | Gap | Issue |
|---|---|---|---|---|---|
| 1 | Project chatter moves out of chat groups ("Any update?", hook chat card, 0–6 s) | Partial | Status lives on the record; meeting minutes `/meetings`; CRM activities (`crm_activities`) | No comments or discussion on a project or task (no comments table in `src/lib/supabase/database.types.ts`) | NEW (N7) |
| 2 | Email no longer holds the project ("Inbox · 48 unread", hook) | Hidden-by-flag | Microsoft 365 integration exists, `m365_integration` defaults false (`src/lib/features.ts` `FEATURE_ENV_DEFAULT`) | Off by default. Mail capture into the record is not built (backlog Batch D1). Never proven in a client tenant | #598 |
| 3 | Budgets leave spreadsheets ("Budget_v7_FINAL.xlsx", "Spreadsheets nobody trusts", problems 0–3 s) | Delivered | `/projects/:id/budget` → `pages/ProjectBudget.tsx`; `budget_versions`, `budget_line_items`; `src/components/import/ImportWizard.tsx` (`import_export` on by default) | — | — |
| 4 | One version of every contract ("Five versions of every contract", "Which version is final?", problems 3–5 s; "The only version", Plan) | Delivered | `pages/project-detail/tabs/DocumentsTab.tsx`: register, file upload, New revision (`NewRevisionModal`), `parent_document_id`, `doc_status` incl. `Superseded` | Contract file is in the Documents tab, not on the overview card the reel shows | — |
| 5 | Tasks leave the task app (hook card, "overdue 42d") | Delivered | `pages/project-detail/tabs/TasksTab.tsx`; overdue-first sort `pages/MyTasks.tsx:16` | — | — |
| 6 | The ERP's mandatory fields stop being the user's problem (Sales Invoice "Mandatory fields required: Cost Center, Debit To, Party Type", problems 1.5 s) | Partial | Activation writes the company's account defaults (`supabase/migrations/0216_erpnext_activation.sql`); budget account map (`pages/admin/BudgetAccountMap.tsx`) | Invoice lines take a free-text ERP item code (`pages/SalesInvoices.tsx` `LineItem`). Project mapping, receivable account and activity type need an operator | #763 #772 #764 #759 |
| 7 | "Who approved this?" is answerable | Partial | Procurement approvals logged (`procurement_status_events`); timesheet approver shown ("Approved by") | No who-changed-what history on other records | #719 |
| 8 | "Is it invoiced yet?" / "Work done. Not billed." / "Day 42 · Rp 850.000.000 still not invoiced" (problems 7–11 s) | Missing | `pages/RevenueByProject.tsx:74-115` shows Total Revenue, Open AR, Invoices only; `src/lib/db/revenue.ts:237` | No remaining-to-invoice or delivered-not-invoiced figure anywhere. Milestones carry no amount (row 16) | NEW (N3); #765 covers the monthly report only |
| 9 | Updates stop being a chase ("Did the client sign?", "Where is the file?", problems 5–7 s) | Partial | Status, documents and stage are visible in one place. Notifications are written only by agent automations (`supabase/functions/agent-dispatch/dispatcher.ts:328`) and ERP alerts (`supabase/functions/_shared/erpnextFeedDeps.ts:781`). The bell shows only with the assistant flag (`src/components/shell/ContextBar.tsx:63`) | Nobody is told that something waits on them, or that their request was approved or rejected (backlog Batch A2, "verified absent") | NEW (N5) |
| 10 | "Projects, people and money. In one place." (Reveal) | Partial | Projects and people (roles, timesheets, contacts) ship. Vendor-side money (procurement invoices and payments) is native | Customer invoices and receipts exist only when ERPNext owns revenue (row 35) | NEW (N1) |
| 11 | Pipeline Lead → Tender → Negotiation → Won, with stage totals and deal count (Win, 20–23 s) | Delivered | `/sales` → `pages/SalesPipeline.tsx`; `components/salesPipeline.ts` (Leads, Pre-Qual, Quotation, Tender, Negotiation, Won, Lost); CRM flag on in the production build (commit `4f3f9740`) | — | — |
| 12 | The deal card moves column to column (Win) | Partial | Stage changes on the deal record (`pages/project-detail/PipelineLens.tsx`) | The board has no drag-and-drop, by ruling (`docs/decisions.md:337`). A buyer will try to drag | Re-cut reel or accept |
| 13 | Winning records the signed contract value with no re-keying ("Contract signed · Rp 4.25 bn") | Delivered | `projects.contract_value` + `contract_value_set_by`; `holds_won_value_authority`. A deal is the project (`App.tsx` `SalesDetailRedirect`) | — | — |
| 14 | Project page holds contract value, status and the signed contract (Plan, 23–26 s) | Delivered | `pages/project-detail/ProjectDetailHeader.tsx:164`, `tabs/OverviewTab.tsx:82`, Documents tab | — | — |
| 15 | Milestones on a schedule (Plan bars) | Delivered | `pages/project-detail/MilestoneStrip.tsx`, `ProjectGantt.tsx`; `project_milestones.target_date` | — | — |
| 16 | Milestones carry amounts (M2 = Rp 850.000.000) and a billing status: Planned / In progress / Done / Paid (Plan, Bill) | Missing | `project_milestones` = name, target_date, weight, input_pct (`database.types.ts:3662`); progress-weighted by ruling (OD-DEL-4/5) | Milestone billing is backlog G5, "demand-gated" (`docs/backlog.md:1038`) | NEW (N2); related #766 |
| 17 | "Contract, milestones and budget, together" | Delivered | Budget tab (`tabs/BudgetTab.tsx` → `ProjectBudget.tsx`, plan vs "Actual (PMO recorded)") beside milestones and contract value | — | — |
| 18 | Board ↔ Timeline of every task (Deliver, 26–29 s) | Delivered | `TasksTab.tsx:77` (list / board / timeline); `ProjectGantt.tsx` | — | — |
| 19 | Task statuses Done / In progress / In review / To do | Partial | `task_status` = To Do, In Progress, Done, Blocked (`database.types.ts:6159`) | No "In review" | Re-cut reel (show Blocked) |
| 20 | Assignees on tasks; the client meeting sits in the plan ("Client progress meeting") | Delivered | `tasks.assignee_id`, `tasks.meeting_id`; meeting action items create tasks | — | — |
| 21 | "Every task, every timeline, one view" (and a Tasks item in the nav) | Partial | Per-project Tasks tab. My Tasks shows for Engineer and Admin only (`src/components/shell/Rail.tsx:84`, OD-W2-4) | No cross-project task view for managers, by ruling | Re-cut reel nav |
| 22 | The assistant drafts the milestone invoice on request ("Invoice milestone 2" → "Drafted … Sent to Finance for approval", Bill, 29–32 s) | Missing | Agent writes: `create_activity`, `update_task_status`, `notify`, `create_automation`, `compose_view`, `ask_user` (`supabase/functions/agent-chat/actions.ts:208-625`). Readable entities exclude sales invoices and receipts (`readEntities.ts:33`) | Cannot read or draft invoices | NEW (N4) |
| 23 | A different person, Finance, approves the invoice ("Awaiting approval" → APPROVED by a Finance user) | Partial | With ERPNext: the author drafts, a non-author Finance/Admin submits (`src/auth/policy.ts:385`, server-enforced) | Without ERPNext, refused (row 35). The button is labelled "Submit", and invoices are not in the Approvals queue (`pages/Approvals.tsx:33`, procurement + timesheets only) | NEW (N1) |
| 24 | Payment in → invoice PAID ("PAYMENT RECEIVED · Bank transfer", Get paid, 32–34 s) | Partial | With ERPNext: receipt pushed, status from ERP outstanding (`sales_invoices.erp_outstanding_amount`) | Without ERPNext, refused (`src/lib/repositories/index.ts:562-580`) | NEW (N1) |
| 25 | "Payment in. Milestone closed." | Missing | `sales_invoices` links `project_id` and `work_order_id`, never a milestone (`database.types.ts:4328`) | A payment cannot close a milestone | NEW (N2) |
| 26 | Invoices and Payments are standard nav items (product chrome) | Hidden-by-flag | Sales Invoices / Incoming Payments / Revenue by Project need `revenue` (`features.ts:105`, default false); an operator entitles per org (#778) | A new org does not see them | #778 (shipped); demo-org setup |
| 27 | Dashboards with a headline figure and a trend (wall tile) | Partial | `pages/ExecutiveDashboard.tsx` KPI band + charts | No trend over time. A disabled "Board pack (coming soon)" shows on the dashboard (`ExecutiveDashboard.tsx:235`). `/reports` is a placeholder | #765 |
| 28 | Approvals (PO Pending → Approved, wall) | Delivered | `/approvals` → `pages/Approvals.tsx`: procurement + timesheets, bulk approve | — | — |
| 29 | Meetings (wall, "Client review") | Delivered | `/meetings`, `pages/MeetingDetail.tsx` (attendees, minutes, action items) | — | — |
| 30 | Procurement Requested → Ordered → Received (wall) | Delivered | `procurement_status` enum; `components/ProcurementBoard.tsx`; `/procurement/:id` | — | — |
| 31 | Timesheets weekly grid (wall) | Delivered | `/timesheets` → `pages/Timesheets.tsx` | — | — |
| 32 | "One app, two languages" (Approved / Disetujui, wall) | Partial | `public/locales/id/common.json` matches `en` key for key (1743/1743); gate `scripts/check-i18n-completeness.mjs` over `src/lib/i18n/launch-scope-routes.txt` | Budget (`ProjectBudget.tsx`, `BudgetProjection.tsx`), Sales Invoices, Incoming Payments, Revenue by Project and My Views have no translation hook and stay English in Bahasa | NEW (N6); #781 (finance date locale) |
| 33 | "On the go" (phone, wall) | Partial | Responsive layouts (`src/components/kanban/useKanbanMobileScroll.ts`, mobile breakpoints) | No web manifest in `public/`: not installable, no offline | #718 |
| 34 | Assistant answers "What's overdue this week?" with "3 tasks, 1 invoice. Drafting reminders." (wall) | Partial | Assistant on in the production build (commit `4a986bbe`); reads tasks (a project filter is required, `src/lib/viewspec/types.ts:246`), milestones, procurement | Cannot see invoices. `notify` writes only to the caller's own inbox (`actions.ts:353`), so reminders to others are impossible. The live model's tool choice is unproven (ADR-0052 eval is the gate) | NEW (N4) |
| 35 | "No ERP? No problem. Invoices and payments run right inside PMO." (ERP, 37–38 s) | Missing | Vendor side native (`repositories/index.ts:474-546`). Customer side refused with `revenue-not-enabled` (`repositories/index.ts:556-622`); native path "DECIDED (deferred)" (`docs/specs/erpnext-adapter-p3a-sales-ar.spec.md:280`). The tables' standalone insert policy already exists (`0123_sales_incoming_payments_flip.sql`) | A no-ERP org cannot raise a customer invoice or record a receipt. If an operator entitles `revenue` there, "New invoice" still shows and fails on save (`SalesInvoices.tsx:300`) | NEW (N1) |
| 36 | "Have one? Plug it in. Connect ERPNext" (ERP, 38–40 s) | Partial | Admin self-serve connect + company selection activates (ADR-0073; `external-connect`, `external-set-company`) | Project mapping has no writer. Receivable account, activity type, employing domains and party onboarding are operator-only. "Connected" shows with no checklist | #772 #773 #760 |
| 37 | "…or whenever you're ready" (connect after months live) | Partial | Crossing is Posture B: PMO stays the record and the ERP starts at connect (DD-XING-1, OD-XING-1) | Records made before connect are not pushed. The replay chooser is deferred. A buyer will assume their history flows in | #772; OD-XING-1 |
| 38 | Invoices flow out, payments flow back (ERP orbit) | Delivered (connected) | Outbox push `supabase/functions/adapter-dispatch`; read-back `erpnext-webhook`, `erpnext-sweep` | — | — |
| 39 | Rupiah figures in local format, with tax shown (Rp 850.000.000, Rp 4.25 bn) | Delivered | Currency seam (OD-CR-5), `src/lib/format.ts`, `TaxBasisLabel` (OD-TAX-1) | — | — |
| 40 | "For contract- and project-based teams" (Close) | Delivered | Generic vocabulary; tender pipeline; client work orders + drawdown (`tabs/WorkOrdersTab.tsx`, `ProjectDrawdown.tsx`) | — | — |
| 41 | "Run the projects, not the systems." (Close) | Partial | Daily work happens in PMO | ERP setup still needs an operator (row 36). Customer billing needs an ERP (row 35) | rolls up N1, #772 |

---

## 2. New issue drafts

### N1 (#784) — Customer invoices and receipts for orgs without an ERP

**Job story.** When my org runs PMO without an ERP, I want to raise a customer invoice, have a second person
approve it, and record the payment, so billing happens in PMO as the product promises.

**What breaks today.** A Finance user in a no-ERP org cannot bill at all. Every revenue write is refused
(`revenue-not-enabled`, `src/lib/repositories/index.ts:556-622`). If an operator turns the revenue section on
for that org, the "New invoice" button shows and fails on save. The ERP scene says the opposite. The tables
already accept a standalone insert (`0123`), so the data seam exists. The write path, the approval and the
paid status do not.

**Acceptance criteria**
- **AC-NAR-001** — *Given* an org where no ERP owns revenue, *when* a Finance user creates an invoice for a
  project and client, *then* it saves as Draft with tax treatment and currency, and lists under Sales Invoices.
- **AC-NAR-002** — *Given* a Draft invoice, *when* its author tries to approve it, *then* the server refuses;
  *when* a different Finance or Admin user approves it from the Approvals queue, *then* it becomes Unpaid.
- **AC-NAR-003** — *Given* an Unpaid invoice, *when* Finance records a receipt for the full amount, *then* the
  invoice shows Paid; a part payment leaves the balance outstanding.
- **AC-NAR-004** — *Given* the org later connects an ERP, *when* revenue is employed, *then* invoices from
  before connect stay readable and editable rules follow OD-XING-1 (nothing pre-connect is pushed unless the
  client chooses otherwise).

**Size** L. **Lane** Director-dispatched (money path, separation of duties); spec + ADR addendum to ADR-0055 first.

### N2 (#785) — Billing milestones: an amount per milestone, invoiced from the milestone, closed by payment

**Job story.** When a contract bills by milestone, I want each milestone to carry its amount and billing
status, invoice it in one step, and see it close when the client pays, so nothing done goes unbilled.

**What breaks today.** Milestones are progress-weighted only (`project_milestones`: no amount, no billing
status). An invoice never points at a milestone, so "Payment in. Milestone closed." cannot happen. Backlog G5
holds this as demand-gated (`docs/backlog.md:1038`); #766 covers down payments and progress claims, not
milestone amounts. **Needs an owner ruling:** build now because the reel promises it, or re-cut the Bill
beat.

**Acceptance criteria**
- **AC-BMS-001** — *Given* a project with a contract value, *when* the PM sets milestone amounts, *then* the
  page shows their sum against the contract value and warns when it differs.
- **AC-BMS-002** — *Given* a milestone marked Done, *when* Finance chooses "Invoice milestone", *then* a Draft
  invoice is created for that amount and linked to the milestone, which shows Invoiced.
- **AC-BMS-003** — *Given* a milestone's invoice is fully paid, *when* the payment is recorded or read back
  from the ERP, *then* the milestone shows Paid.
- **AC-BMS-004** — *Given* a milestone already invoiced, *when* someone invoices it again, *then* the server
  refuses a second invoice.

**Size** L. **Lane** Director-dispatched (money path); depends on N1 for no-ERP orgs; fold into #766's spec
if the owner prefers one billing spec.

### N3 (#786) — Show what is still to invoice, per project

**Job story.** When I look at a project or the portfolio, I want to see how much delivered work is not yet
invoiced, so "Is it invoiced yet?" has an answer without asking anyone.

**What breaks today.** No screen shows contract value minus invoiced, or delivered minus invoiced. Revenue by
Project shows invoiced and open AR only. The reel opens on exactly this problem ("Day 42 · Rp 850.000.000
still not invoiced").

**Acceptance criteria**
- **AC-UNB-001** — *Given* a won project with invoices, *when* I open it, *then* I see contract value,
  invoiced to date and remaining to invoice, each with its tax basis label.
- **AC-UNB-002** — *Given* milestones with amounts (N2), *when* a milestone is Done and not invoiced, *then* the
  project and the dashboard show it as unbilled, with days since it was marked Done.
- **AC-UNB-003** — *Given* invoices in mixed tax bases, *when* the figures compute, *then* both sides are
  normalised to one basis before subtracting (OD-TAX-1).

**Size** M. **Lane** ADW (read-only figures; money-display gate-tests per ADR-0030). AC-UNB-002 waits on N2.

### N4 (#787) — Assistant: see invoices, answer "what's overdue", draft an invoice for approval

**Job story.** When I ask the assistant what is overdue or to invoice something, I want it to see invoices and
payments and prepare a draft for a human to approve, so the reel's assistant beat is real.

**What breaks today.** The assistant cannot read sales invoices, receipts or meetings. Task reads need a project
filter, so an org-wide "this week" answer takes several calls the weak live model may not make. It can only
notify its own user, so "drafting reminders" to others is impossible. It cannot draft an invoice.

**Acceptance criteria**
- **AC-AIN-001** — *Given* a user with access to revenue, *when* they ask what is overdue this week, *then* the
  answer lists overdue tasks across their projects and overdue invoices, with links.
- **AC-AIN-002** — *Given* a project milestone or work order, *when* the user asks the assistant to invoice it,
  *then* the assistant proposes a Draft invoice, the user confirms, and it saves as Draft under their name,
  never approved.
- **AC-AIN-003** — *Given* the agent eval harness (ADR-0052), *when* the suite runs against the deployed model,
  *then* both journeys above pass at the agreed rate.

**Size** L. **Lane** Director-dispatched (agent write into the money path); the read-only part can split
out to ADW.

### N5 (#788) — Tell the next person when something waits on them

**Job story.** When I submit, assign or decide something, I want the person it now waits on (or the person
who asked) to be told, so nobody has to chase.

**What breaks today.** Notifications come only from agent automations and ERP alerts, and the bell shows only
with the assistant flag on. A submitted timesheet, a procurement waiting for approval, a rejection or a new
task assignment tells nobody. Backlog Batch A2 recorded "submitter notification … verified absent".

**Acceptance criteria**
- **AC-WFN-001** — *Given* a timesheet or procurement is submitted, *when* it enters the queue, *then* every user
  who may approve it gets an in-app notification linking to it.
- **AC-WFN-002** — *Given* an approval or rejection, *when* it is recorded, *then* the submitter is notified,
  with the rejection comment if there is one.
- **AC-WFN-003** — *Given* a task is assigned to someone else, *then* the assignee is notified.
- **AC-WFN-004** — *Given* any notification, *then* it reaches only users in the same org who can open the
  record (pgTAP).

**Size** M. **Lane** ADW (security reviewer checks the cross-user write and org scoping).

### N6 (#789) — Bahasa on the budget and finance screens

**Job story.** When I use PMO in Bahasa Indonesia, I want the budget and finance screens in Bahasa too, so the
"one app, two languages" promise holds on the money screens a prospect will open.

**What breaks today.** `ProjectBudget.tsx`, `BudgetProjection.tsx`, `SalesInvoices.tsx`, `IncomingPayments.tsx`,
`RevenueByProject.tsx` and the My Views pages have no translation hook, and none is on the launch-scope route
list, so the completeness gate does not cover them.

**Acceptance criteria**
- **AC-L10N-B01** — *Given* the interface language is Bahasa, *when* I open a project's Budget tab or any
  Finance page, *then* every label, status, empty state and toast is in Bahasa.
- **AC-L10N-B02** — *Given* the launch-scope list, *then* it names these routes, and the completeness gate fails
  on a missing `id` key there.
- **AC-L10N-B03** — *Given* Bahasa, *then* dates and amounts on these pages use `id-ID` formatting (closes the
  date half of #781 if not already fixed).

**Size** M. **Lane** ADW (`fe_builder` / `fe_reviewer`).

### N7 (#790) — Comments on projects and tasks

**Job story.** When I need to ask or answer something about a project or task, I want to write it on the record,
so the question and its answer stay with the work instead of a chat group.

**What breaks today.** There is nowhere on a project or task to discuss it. The hook's chat card ("Any update?",
"Which version is final??") implies PMO replaces that chat.

**Acceptance criteria**
- **AC-CMT-001** — *Given* a project or task I can read, *when* I post a comment, *then* it shows with my name and
  time to everyone who can read the record.
- **AC-CMT-002** — *Given* I mention a colleague, *then* they are notified (uses N5).
- **AC-CMT-003** — *Given* another org, *then* its users cannot read or write the comment (pgTAP).

**Size** M. **Lane** ADW.

---

## 3. Inferred promises (what a buyer would assume)

- **The Bill and Get-paid beats happen with no ERP.** The reel shows billing before the ERP scene, then says
  "No ERP? No problem." Today customer billing needs ERPNext (rows 23, 24, 35 → N1).
- **Payment closes the milestone automatically.** The reel shows it with no human step. Nothing links them
  (rows 16, 25 → N2).
- **PMO flags unbilled work by itself.** The problem scene sets up "Day 42" and the assistant beat implies PMO
  notices. Nothing computes it (row 8 → N3).
- **The assistant acts on money, safely.** "The assistant drafts. Your people approve." It approves nothing
  today and cannot draft invoices (rows 22, 34 → N4).
- **I am told when it is my turn.** Implied by "Every update is a chase" (row 9 → N5).
- **Cards drag between columns.** Both boards animate cards moving. Ruled out for the pipeline
  (`docs/decisions.md:337`); task boards have no drag either (row 12).
- **The whole app works in Bahasa.** The money screens do not (row 32 → N6).
- **It installs on my phone.** "On the go" shows a phone frame (row 33 → #718).
- **Connecting my ERP brings my history across, with no help from you.** History before connect is not pushed
  by default, and setup needs an operator (rows 36, 37 → #772).
- **PMO replaces the project chat group.** No comments (row 1 → N7).
- **What I saw, I can click in a demo.** Needs a demo org with the revenue section, CRM and assistant on, and
  seed data that reaches every beat (#492).
- **Not inferred:** "Harbor project group" is the chat app in the hook, not a project-grouping feature.
  Project grouping (sub-projects) stays parked; tags are #770.

---

## 4. Before a prospect sees the reel

**Must be true, or the beat must be re-cut.** In priority order.

1. **N1: customer billing with no ERP.** The ERP scene states it outright, and a no-ERP buyer is the
   default prospect. Build it. Re-wording the line would also break ADR-0055's "runs fully standalone".
2. **Bill / Get-paid beat (N2).** Either the owner rules milestone billing in now (G5 is demand-gated), or the
   beat is re-cut to what ships: Finance raises the invoice, a second Finance user approves it, payment marks
   it Paid. That re-cut still needs N1 for a no-ERP buyer.
3. **Assistant line "The assistant drafts. Your people approve." (N4).** Re-cut to an assistant action that
   ships (a confirmed task-status change, or a composed view), or build N4. The wall tile's "1 invoice.
   Drafting reminders." has the same problem.
4. **N3: what is still to invoice.** The reel opens on this problem. A prospect will ask to see where PMO
   answers it.
5. **Demo org ready (#492 + setup).** Revenue section entitled (#778), CRM and assistant on, rich seed reaching
   each beat. Then a rendered walk of every row marked Delivered on local seed data, before the demo.
6. **#781.** Finance lists show internal ids and a "Not found" breadcrumb, which is what a prospect sees during
   the Bill beat.
7. **N6: Bahasa on the money screens.** An Indonesian prospect will switch language during the demo.
8. **#772, for any prospect who already runs ERPNext.** "Plug it in" today needs an operator.

**Nice-to-have.**

- N5 (workflow notifications)
- #718 (installable PWA)
- #719 (record history)
- N7 (comments)
- #765 (management pack; also removes the "Board pack (coming soon)" button)
- a dashboard trend line
- reel touch-ups that cost nothing:
  - show "Blocked" rather than "In review"
  - nav labels "Sales Pipeline / Sales Invoices / Incoming Payments"
  - drop the "Tasks" nav item, or accept that only some roles see it
