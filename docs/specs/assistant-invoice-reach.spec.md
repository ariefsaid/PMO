# Spec: Assistant invoice reach — "what's overdue?" and "invoice this" (#787)

**Spec ID prefix:** AIN
**Issue:** #787 (showreel audit N4, `docs/reviews/2026-10-05-showreel-promise-audit.md` rows 22 + 34; OD-REEL-1)
**ADR refs:** ADR-0079 (this feature's architecture: coarse tools, server-resolved proposals, server-rendered
answers), ADR-0050 (layered prompt), ADR-0052 (eval harness), ADR-0051 (approval predicate), ADR-0039 (deputy +
untrusted-output boundary), ADR-0016 (`can()` is UX only), ADR-0019 (server-enforced SoD), ADR-0048 (ERP money is
read, never recomputed), ADR-0010 (test pyramid).
**Plan:** `docs/plans/2026-10-06-assistant-invoice-reach.md`
**Status:** Draft — 2026-10-06 · **Author:** eng-planner (for the Director)
**Lane:** money path (agent write into sales invoices) → Director-dispatched for the write half; the read half
may run as a factory slice (plan §2).

---

## Director decisions (DD-AIN-n — ruled 2026-10-06, see `docs/decisions.md`)

- **DD-AIN-1 — what "overdue" means.** Past its due date and still open, as of today in the user's time zone
  (profile zone, else the org's default zone). "This week" does not narrow it: something three weeks late is still
  overdue this week. A task is overdue when its end date is before today, its status is To Do / In Progress /
  Blocked, and it is neither archived nor tombstoned. An invoice is overdue when it is Unpaid (submitted, money
  still outstanding) and its due date is before today, where the due date is the **same rule the Sales Invoices
  "Due" column already uses** (ERP due date, else invoice date + the customer's payment terms, else + 30 days —
  FR-SAR-141 / AC-SAR-051).
- **DD-AIN-2 — "their projects", by role.** Engineer: tasks assigned to them, no invoices. Project Manager: tasks on
  projects they manage plus tasks assigned to them; invoices on projects they manage. Admin, Executive, Finance:
  the whole organisation. Invoices appear only when the org has Revenue switched on **and** the role may view
  invoices (Admin, Executive, Project Manager, Finance — the existing Sales Invoices view rule).
- **DD-AIN-3 — who can have the assistant draft an invoice.** Finance and Admin only — the same people who may
  press "New invoice" today, and the same set the server enforces. Anyone else gets a plain refusal and no
  proposal. Drafting needs revenue connected to ERPNext, because that is the only invoice create path that exists
  until native invoicing (#784) ships.
- **DD-AIN-4 — what can be invoiced, for how much.** An Issued or Closed work order (not Draft, not Cancelled), or
  a project milestone named by its name or its position in the project ("milestone 2" = the second milestone in
  the project's order). Amount: a work order's value **before tax**, taken from its own recorded tax facts; a
  milestone has no amount until #785, so the user must state one. An amount the user states always wins.
- **DD-AIN-5 — the invoice line.** One line. The ERPNext item the user names; else the org's only sales item;
  else the assistant asks which item, offering the catalogue. Line description = work-order number and title, or
  project and milestone name. A work order's client PO number becomes the invoice reference. The invoice is **not**
  linked to the work order record, because today's create path has no field for that link.
- **DD-AIN-6 — what the user confirms is what is saved.** The proposal is resolved on the server before the user
  sees it; the confirmed draft is saved exactly as shown (no re-resolution after approval). It saves as a Draft
  under the confirming user's name, through the same server path as the Sales Invoices form. Submitting stays a
  separate act by a different Finance or Admin user (existing SoD). The assistant never submits or approves.
- **DD-AIN-7 — the overdue answer is written by the server, not the model.** Deterministic list, English, at most
  10 rows per section with the true counts in the heading; each task links to its project's Tasks tab and each
  invoice to Sales Invoices filtered to its number. The model adds at most one sentence.
- **DD-AIN-8 — out of scope.** Reminders to other people: the assistant can only write to the asking user's own
  inbox, so "drafting reminders" to others is not in this issue. Generic invoice / receipt / meeting reads through
  the assistant's general read tool are deferred: the two journey tools cover the acceptance criteria, and fewer
  tools is better for the weak model.
- **DD-AIN-9 — how reliability is proven.** The eval suite (ADR-0052) runs each journey 10 times against the
  deployed model and needs 9 passes. It only proposes — it never approves — so an eval run never creates an ERP
  document. A server switch turns invoice drafting off without a redeploy. If the deployed model misses the bar,
  OD-REEL-1 lets the model be changed; the eval decides.

---

## 1. Context and job story

> **When** I ask the assistant what is overdue or to invoice something,
> **I want** it to see invoices and payments and prepare a draft for a human to approve,
> **so** the reel's assistant beat ("3 tasks, 1 invoice" · "Invoice milestone 2 → drafted, Finance approves") is
> real.

**What breaks today** (verified against the tree, 2026-10-06):
- The assistant's read whitelist has no sales invoices or receipts (`supabase/functions/agent-chat/readEntities.ts`).
- Task reads require a project filter (`pmo-portal/src/lib/viewspec/types.ts` `tasks.requiredFilter`), so an
  org-wide answer needs one read per project — a multi-call plan the live model (deepseek-v4-flash, a weak
  tool-selector) does not reliably make. The prompt even maps "overdue" to a plain `tasks` read.
- The assistant has no invoice write. Its four approval-gated writes are `create_activity`,
  `update_task_status`, `create_automation`, plus `notify` (own inbox only).

**What already exists and is reused:**
- The only sales-invoice create path: `revenue.createInvoice` → `adapter-dispatch` (`domain:'revenue'`,
  `operation:'create'`, `erp_doc_kind:'sales-invoice'`) with its gates — ERPNext tier ownership, Admin/Finance role
  (`authGuard.ts`), project gate, create-target guard, money outbox, author recorded from the verified JWT. A
  create is an ERPNext Draft (docstatus 0). Submit is SoD-gated (`grant_sales_invoice_submit_clearance`, approver ≠
  any author).
- The approve/deny chip (`needs-approval` → `ApprovalChip`), deputy re-auth and `can()` re-check on approve, the
  persistence de-dupe journal.
- The due-date rule `deriveArDueDate` (`pmo-portal/src/lib/repositories/revenueDisplay.ts`), the tax re-basing
  `normalizeTaxAmount` (`pmo-portal/src/lib/taxTreatment.ts`), the ERP item catalogue fn `external-items`.

**Out of scope:** see DD-AIN-8. Also: native (no-ERP) invoicing (#784), milestone amounts (#785), linking an invoice
to a work order record, a Bahasa rendering of the server-written list (follows the money-screen Bahasa sweep).

---

## 2. Requirements (EARS)

### 2.1 Overdue journey

- **FR-AIN-001** — The assistant shall offer one read tool, `whats_overdue`, taking no arguments, that returns the
  caller's overdue tasks and (where DD-AIN-2 allows) overdue invoices in a single call.
- **FR-AIN-002** — When `whats_overdue` runs, the system shall compute "today" as the calendar date in the caller's
  profile time zone, else the org default time zone, else UTC.
- **FR-AIN-003** — When `whats_overdue` runs, the system shall select tasks whose end date is before today, whose
  status is To Do, In Progress or Blocked, and which are neither archived nor tombstoned, scoped per DD-AIN-2.
- **FR-AIN-004** — Where the org has the Revenue feature on and the caller's role may view invoices, the system shall
  select Unpaid sales invoices whose due date (per `deriveArDueDate`) is before today, scoped per DD-AIN-2.
- **FR-AIN-005** — While the caller's role may not view invoices, or the org's Revenue feature is off, the system
  shall issue no sales-invoice read and shall render no invoice section.
- **FR-AIN-006** — When `whats_overdue` returns, the handler shall show the server-rendered list to the user verbatim
  and shall give the model only a compact receipt (counts, truncation flags, an instruction not to repeat the list).
- **FR-AIN-007** — The rendered list shall link each task that has a project to `/projects/<projectId>/tasks` and each
  invoice to `/sales-invoices?q=<invoice number>`, show at most 10 rows per section, and state the true counts
  (with "+" when a cap truncated them).
- **FR-AIN-008** — The rendered list shall escape every user-authored string (task, project, person, customer and
  invoice names) so it renders as text, never as a link, emphasis or HTML.
- **FR-AIN-009** — When the Sales Invoices page is opened with `?q=<text>`, the page shall start with its search box
  holding that text and the list filtered by it.
- **FR-AIN-010** — The prompt shall route "overdue / late / past due / behind" questions to `whats_overdue` and shall
  no longer route "overdue" to a `tasks` read.

### 2.2 Draft-invoice journey

- **FR-AIN-020** — Where invoice drafting is enabled on the server, the assistant shall offer one confirm-gated
  write tool, `draft_invoice`, taking exactly one of `workOrder` or `milestone`, and optionally `project`,
  `amount` (before tax) and `itemCode`.
- **FR-AIN-021** — When `draft_invoice` is requested, the system shall resolve the proposal on the server, under the
  caller's own access, before any approval chip is shown: role, Revenue feature, ERPNext ownership of revenue,
  project, source, client, client's ERPNext link, amount, item (DD-AIN-3/4/5).
- **FR-AIN-022** — If the caller is not Finance or Admin, then the system shall refuse with "Only Finance or Admin
  can raise an invoice." and shall show no chip.
- **FR-AIN-023** — If any resolution step cannot produce exactly one answer, then the system shall return a refusal
  the model can act on — a reason, what is needed (`amount`, `itemCode` or `choice`) and up to 8 candidates shaped
  as `{id, label}` — and shall show no chip.
- **FR-AIN-024** — When resolution succeeds, the system shall always show the approval chip (no auto-approve), whose
  summary is server-composed, at most 120 characters, and states the customer, the amount before tax, the source,
  and that the invoice will not be submitted.
- **FR-AIN-025** — When the user approves, the system shall re-check the caller's role (`can('create',
  'salesInvoice')`), rebuild the draft from an allow-list of its fields (dropping anything else in the replayed
  arguments), and send exactly one `operation:'create'` revenue command to `adapter-dispatch` with the caller's JWT,
  reusing the proposal's record id and idempotency key.
- **FR-AIN-026** — The `draft_invoice` tool shall never send any operation other than `create`, and shall never call
  any submit, approve or transition path.
- **FR-AIN-027** — If the dispatch fails or does not answer within 25 seconds, then the system shall report the
  failure in plain words (and, on timeout, tell the user to check Sales Invoices before asking again) and shall not
  claim the draft was saved.
- **FR-AIN-028** — The prompt shall describe `draft_invoice` only when it is registered, shall tell the model to pass
  refusal candidates to `ask_user`, and shall forbid saying an invoice is approved or submitted.

### 2.3 Non-functional

- **NFR-AIN-SEC-001** — Both tools shall act only through the caller-JWT client (`ctx.supabase`), never
  `service_role`; RLS remains the row authority and `adapter-dispatch` the money-write authority.
- **NFR-AIN-SEC-002** — Search terms from the model shall have PostgREST pattern characters (`% _ * \`) removed before
  any `ilike`.
- **NFR-AIN-SEC-003** — Changing `draft_invoice`'s operation from `create` to anything else shall turn its owning
  test red (mutation check).
- **NFR-AIN-PERF-001** — `whats_overdue` shall read at most 51 task rows per query and scan at most 201 invoice rows,
  and shall give up after 8 seconds with a plain error.
- **NFR-AIN-QUAL-001** — Each journey shall pass the eval suite at least 9 times in 10 runs against the deployed model
  (DD-AIN-9).

---

## 3. Acceptance criteria (Given/When/Then)

AC-AIN-001..003 are the issue's own. AC-AIN-004..017 are derived from existing rulings and the decisions above, so
each requirement has a falsifiable test.

- **AC-AIN-001** — *Given* a user with revenue access (Finance), an org with Revenue on, an overdue open task on a
  project and an Unpaid invoice past its due date, *when* they ask what is overdue this week, *then* the answer lists
  the overdue task with a link to its project's Tasks tab and the overdue invoice with a link to Sales Invoices
  filtered to its number, and the model receives only the receipt, not the list.
- **AC-AIN-002** — *Given* a Finance user and an Issued work order on a project whose client is linked to ERPNext,
  *when* they ask the assistant to invoice it, *then* a chip proposes a Draft invoice for the work order's value
  before tax; *when* they approve, *then* exactly one `operation:'create'` revenue command reaches
  `adapter-dispatch` with the caller's client, carrying the proposal's record id and idempotency key, and no
  submit/transition is sent.
- **AC-AIN-003** — *Given* the eval harness (ADR-0052) against the deployed agent, *when* each journey runs 10 times,
  *then* at least 9 runs pass: the overdue journey calls `whats_overdue` and the answer carries a task link and an
  invoice link; the work-order and milestone journeys end in a `draft_invoice` proposal with the expected amount.
- **AC-AIN-004** — *Given* an Engineer, *when* `whats_overdue` runs, *then* tasks are filtered to their own
  assignments, no sales-invoice read is issued, and the answer has no invoice section.
- **AC-AIN-005** — *Given* a Project Manager who manages project P, *when* `whats_overdue` runs, *then* tasks come
  from P plus their own assignments (de-duplicated, oldest due first) and invoices are filtered to P.
- **AC-AIN-006** — *Given* an org with Revenue off, *when* a Finance user's `whats_overdue` runs, *then* no
  sales-invoice read is issued and there is no invoice section.
- **AC-AIN-007** — *Given* a Project Manager, Executive or Engineer, *when* they ask to invoice a work order, *then*
  the assistant refuses with "Only Finance or Admin can raise an invoice.", no chip appears and nothing is
  dispatched.
- **AC-AIN-008** — *Given* a milestone and no stated amount, *when* the user asks to invoice it, *then* the refusal
  asks for the amount before tax (`needs:'amount'`) and no chip appears; *given* "milestone 2" and a project,
  *then* the second milestone in the project's order is used.
- **AC-AIN-009** — *Given* a term matching two work orders, *when* the user asks to invoice it, *then* the refusal
  carries `needs:'choice'` and both as `{id,label}` candidates, and no chip appears; *given* a Draft or Cancelled work
  order, *then* the refusal says only an Issued or Closed work order can be invoiced.
- **AC-AIN-010** — *Given* a pending draft chip, *when* the user's role is no longer Finance/Admin at approval, *then*
  the run ends `PERMISSION_DENIED` and nothing is dispatched.
- **AC-AIN-011** — *Given* a replayed approval whose arguments were altered to add `verb:'submit'`,
  `operation:'transition'` or `author_user_id`, *when* it is approved, *then* the dispatched command is still
  `operation:'create'` and carries none of those fields.
- **AC-AIN-012** — *Given* a task named `[x](https://evil.example)`, *when* it appears in the overdue answer,
  *then* it renders as escaped text, not a link.
- **AC-AIN-013** — *Given* Unpaid invoices dated 2026-09-01 (terms 30), 2026-09-20 (terms 30) and 2026-08-20 (no
  terms), and today 2026-10-06, *when* overdue invoices are computed, *then* the first (due 1 Oct) and third (due 19
  Sep) are overdue and the second (due 20 Oct) is not — the same dates the Sales Invoices "Due" column shows.
- **AC-AIN-014** — *Given* a tax-inclusive work order of 1,110,000 with recorded tax 110,000, *when* it is proposed,
  *then* the line rate is 1,000,000 (before tax).
- **AC-AIN-015** — *Given* `/sales-invoices?q=ACC-SINV-2026-00002`, *when* the page opens, *then* the search box holds
  that number and only that invoice is listed.
- **AC-AIN-016** — *Given* an approved draft, *when* `adapter-dispatch` rejects it or does not answer in 25 s, *then*
  the tool result is an error (on timeout: check Sales Invoices before asking again) and never `ok:true`.
- **AC-AIN-017** — *Given* the system prompt, *then* "overdue" routes to `whats_overdue` (not a `tasks` read), and
  `draft_invoice` with its "never say approved or submitted" rule appears only when drafting is enabled.

---

## 4. Traceability (owning layer per ADR-0010)

| AC | Owning test | Layer |
|---|---|---|
| AC-AIN-001 | `pmo-portal/src/lib/agent/handlerOverdue.test.ts` | Vitest (handler, mocked model + client) |
| AC-AIN-002 | `pmo-portal/src/lib/agent/handlerDraftInvoice.test.ts` | Vitest (handler) |
| AC-AIN-003 | `pmo-portal/evals/cases/invoice-reach.eval.ts` | Eval (ADR-0052, non-deterministic, off the merge lane) |
| AC-AIN-004/005/006/013 | `pmo-portal/src/lib/agent/overdue.test.ts` | Vitest |
| AC-AIN-007/008/009/014 | `pmo-portal/src/lib/agent/draftInvoice.prepare.test.ts` | Vitest |
| AC-AIN-010/011 | `pmo-portal/src/lib/agent/handlerDraftInvoice.test.ts` | Vitest (handler) |
| AC-AIN-012 | `pmo-portal/src/lib/agent/agentFormat.test.ts` | Vitest |
| AC-AIN-015 | `pmo-portal/pages/__tests__/SalesInvoices.deepLink.test.tsx` | Vitest/RTL |
| AC-AIN-016 | `pmo-portal/src/lib/agent/draftInvoice.run.test.ts` | Vitest |
| AC-AIN-017 | `pmo-portal/src/lib/agent/prompt.experience.test.ts` | Vitest |

No pgTAP: no schema, policy or grant changes; the invoice create authority (role, SoD author record, project gate)
is the existing `adapter-dispatch` path with its existing proofs (`supabase/functions/adapter-dispatch/authGuard.test.ts`,
`sodGuard.test.ts`, `supabase/tests/si_submit_sod*.test.sql`). No new e2e: edge functions do not run in the e2e
stack, the chip and markdown rendering are already covered (AC-AW-012, `Markdown.test.tsx`), and the real-model
journey is the eval's job.

---

## 5. Open questions for the owner (each has a default the plan builds to)

1. **Pass bar** — 9 of 10 runs per journey? *Default: yes.*
2. **Who may draft through the assistant** — Finance and Admin only, as the form and server already rule? (The reel
   implies a PM asks.) *Default: Finance and Admin only.*
3. **Language of the server-written overdue list** — English now, Bahasa with the money-screen sweep? *Default: yes.*
4. **Running the eval** needs this `agent-chat` deployed to the hosted project (an owner-approved deploy) and an eval
   org there: Revenue on, revenue bound to a test ERPNext with exactly one sales item, a Finance test user, an
   overdue task, an overdue Unpaid invoice, Issued work order `WO-EVAL-0001` (exclusive, 1,000,000.00) and project
   `EVAL-P1` with two milestones. *Default: the Director prepares the org; the owner approves the deploy.*
