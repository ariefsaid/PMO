# Feature: Expense claims and cash advances (#775)

> **Status:** Phase A signed off and merged (migration 0247). **Phase B (§10) drafted 2026-10-07 for Director sign-off.**
> Plans: phase A `docs/plans/2026-10-06-expense-claims.md` (+ part2…part6); phase B
> `docs/plans/2026-10-07-expense-claims-phase-b.md` (+ part2…part6).
> ADRs: `docs/adr/0078-expense-claims-ride-spend-routing-and-core-erp-doctypes.md`;
> `docs/adr/0081-expense-postings-single-originator.md` (phase B).
> **Grounds (read, not re-derived):** `docs/decisions.md` OD-PROC-5 (claims are their own flow, never inside
> `procurements`, sharing only the approve → Finance → paid tail), OD-PROC-1/OD-PROC-8 (SoD outside the Admin
> skip), OD-SAR-PMO-IS-THE-UI and OD-ERP-3 (ERPNext is headless; nobody at the client logs in to it), DD-APR-1..5 +
> ADR-0075 (spend approval routing, #803 — `spend_approval_route` is the one rule; its reuse contract names this
> issue), ADR-0019 (server-enforced SoD), ADR-0055/0059 (ERPNext owns money; PMO-run processes are Posture B — PMO SoT,
> side-mirrored), ADR-0058 + `docs/money-path-primer.md` (outbox/sweep), OD-XING-1 (nothing before the binding is
> pushed by default), #804 / migration 0229 (`Special expenses` budget category).
> **Phase B grounds:** `docs/spikes/2026-10-07-erpnext-employee-expense-postings.md` (live v15 bench, every body and
> anchor below was observed there).
> **Builds on (merged on `dev`):** #803 — `supabase/migrations/0243_spend_approval_routing.sql`
> (`spend_approval_route`, `holds_spend_approval_authority`, `spend_approvers`, `get_procurement_approval_routes`);
> #788 — migration `0237` (`notify_workflow_user`); P3b — migrations `0136` (`erp_employees`) and `0148`
> (`confirm_erp_employee_link`).

## 1. Job story

When staff take cash advances and claim field expenses (travel, accommodation, special expenses) for a project, I
want to enter, approve and settle them in PMO tagged to the project, so field cost reaches project cost and advance
aging isn't kept by hand. Today the first client runs these on emailed PDF forms; small amounts, but untagged claims
were a recurring year-end reclass.

## 2. Scope and phasing

| Phase | Delivers | This spec |
|---|---|---|
| **A — PMO process** (merged) | Claims and advances: entry with project + budget category + lines + receipts; approval through the #803 routing; settlement by Finance (claims net against advances); advance returns; advance aging; notifications. Runs fully standalone. | §4–§9, AC-EXP-001..070 |
| **B — ERPNext side-mirror** (this amendment) | Approved claims and paid advances/claims posted to ERPNext through core doctypes (DD-EXP-9), so field cost reaches the ledger-based project actuals of an ERP-connected client. | §10, AC-EXP-100..140 |

**Why phase A alone does not finish the job story for an ERP-connected client:** that client's project actuals are
read from the mirrored ERPNext ledger (`erp_gl_entry_mirror` → `erp_actuals_snapshot`). Until phase B posts the
claim, PMO shows the claim and its effect on budget headroom, but the ledger figure does not move.

## 3. Director decisions (`DD-EXP-n` — ruled 2026-10-06, see `docs/decisions.md`)

- **DD-EXP-1 — One record, two kinds; reuse the routing, not the procurement table.** A claim and an advance are rows
  of one table `expense_claims` with `kind ∈ {claim, advance}`, one status machine and one transition RPC. Reused
  as-is: `spend_approval_route` (#803), the per-line advisory lock key, `next_procurement_doc_number` (new prefixes
  `EXP`, `ADV`), `notify_workflow_user` (#788), `log_audit`, `stamp_org_id`, `stamp_currency`, the
  procurement-files storage pattern. **Not reused:** `procurements` / `transition_procurement` — OD-PROC-5 forbids it,
  and its status machine (vendor, quote, PO, receipt) has nothing a claim passes through.
- **DD-EXP-2 — Approval follows spend routing.** A claim or advance is decided by the route
  `spend_approval_route(org, project, budget category, amount, currency, claimant, decider, submitted_at)` returns,
  exactly as a purchase request is. Approved and paid **claims** count toward the budget line's used amount (inside
  that one function). **Advances do not** — an advance is cash in the claimant's custody, not cost; the claims that
  settle it are the cost. Counting both would count the same rupiah twice.
- **DD-EXP-3 — Four separations of duty, all server-enforced outside the Admin break-glass.** Approver ≠ claimant;
  payer ≠ approver; payer ≠ claimant; the person recording an advance return ≠ the claimant.
- **DD-EXP-4 — Who sees claims.** The claimant sees their own; anyone holding approval rank (Project Manager and
  above — the same population that can decide spend) sees all of the org's. An Engineer sees only their own.
- **DD-EXP-5 — The claimant is the signed-in person.** No entry on someone else's behalf (owner question Q2).
- **DD-EXP-6 — Settling against an advance.** A claim may name one of the claimant's own paid advances. When Finance
  pays the claim, the advance pays first: `applied = min(claim amount, advance outstanding)`, cash paid =
  remainder. Advance outstanding = advance amount − Σ applied by paid claims − returned cash. An advance stays
  outstanding until claims or Finance-recorded cash returns bring it to zero. One advance per claim; many claims per
  advance.
- **DD-EXP-7 — Aging.** Age in days = (today in the org's timezone) − the advance's paid date (also the org's
  timezone, stamped at payment). Buckets `0-30`, `31-60`, `61-90`, `90+`. A paid advance with no paid date (imported)
  ages as `90+`.
- **DD-EXP-8 — "Special expenses" is the existing budget category.** The owner's ruling ("certain staff expenses
  stay as special expenses for owner review for now; no special workflow") is met by the `Special expenses`
  `budget_category` value #804 added, set on the claim. It routes like any other category and is a list filter.
- **DD-EXP-9 — ERPNext path: core doctypes only, whether or not HRMS is installed.** Phase B posts a claim as a
  **Journal Entry** (expense rows tagged with project + cost center; credit to the employee payable account with
  party type `Employee`) and settles with a **Payment Entry** (party type `Employee`) plus, for the advance-applied
  part, a Journal Entry from the employee advance account. An advance is a Payment Entry to the employee's advance
  account; a cash return is a receiving Payment Entry. HRMS `Expense Claim` / `Employee Advance` are **never** used.
  *Deciding fact:* ERPNext is headless here (OD-SAR-PMO-IS-THE-UI) — nobody opens HRMS's forms, reports or approval
  fields, so HRMS adds a second approval model to map and an install dependency, and buys nothing. `Journal Entry`,
  `Payment Entry` and `Employee` are core ERPNext and exist on every site. *What would reopen it:* the client's
  accountants needing HRMS documents themselves (e.g. HRMS payroll recovering advances from salary).
- **DD-EXP-10 — Content frozen after submission.** Project, budget category, amount, lines, receipts and the advance
  link change only in Draft (or after a rejection sends it back to Draft). Routing decides on them now, and phase B
  derives its idempotency key from them later (the DD-APR-6 / DD-WO-5 shape).
- **DD-EXP-11 — One currency.** A claim is in the org's default currency, stamped server-side; the client never
  sends it. Foreign-currency claims are out of scope.

Phase B decisions (DD-EXP-12..22) are in §10.2.

## 4. Functional requirements (EARS)

### Records
- **FR-EXP-001** The system shall store claims and advances in `public.expense_claims` with `kind` (`claim` |
  `advance`), `status` (`Draft`, `Submitted`, `Approved`, `Rejected`, `Paid`, `Cancelled`), claimant, optional
  project (none = overhead), optional `budget_category`, title, purpose, currency, amount, optional advance link,
  advance-applied amount, returned amount, and the submission/decision/payment stamps.
- **FR-EXP-002** When a member creates a claim or advance, the system shall stamp `org_id` from the caller, set the
  claimant to the caller, set `status` to `Draft`, and stamp the currency from the org default. The client shall not
  be able to set `org_id`, claimant, status, number, currency or any stamp.
- **FR-EXP-003** The system shall store a claim's lines in `public.expense_claim_lines` (date, type ∈ `Travel`,
  `Accommodation`, `Meals`, `Local transport`, `Other`; description; amount > 0). Lines exist only on claims.
- **FR-EXP-004** While a claim exists, its `amount` shall equal the sum of its lines, maintained by the server.
  When a client tries to set a claim's amount directly, the system shall refuse (42501 on update, P0001 on insert).
  An advance's amount is entered by the claimant.
- **FR-EXP-005** The system shall store receipt attachments in `public.expense_claim_files` with objects in the
  private bucket `expense-receipts` at `{org}/{claim}/{file}/{filename}` (PDF, PNG, JPEG, WebP; 5 MB).
- **FR-EXP-006** While a claim or advance is `Draft` or `Rejected`, only its claimant shall be able to change its
  header, lines, receipts and advance link. In any other status no client shall change them (DD-EXP-10).
- **FR-EXP-007** When a claim names an advance, the system shall require it to be one of the claimant's own `Paid`
  advances in the same org; otherwise refuse (23514).

### Visibility
- **FR-EXP-010** The system shall let a caller read a claim, its lines and its receipts only when the caller is an
  active member of its org **and** is the claimant or holds approval rank (DD-EXP-4).

### Lifecycle (server — `transition_expense_claim(p_id, p_to, p_notes, p_payment_reference)`)
- **FR-EXP-020** The legal moves shall be: Draft → Submitted | Cancelled; Submitted → Approved | Rejected |
  Cancelled; Approved → Paid | Cancelled; Rejected → Draft. Paid and Cancelled are terminal.
- **FR-EXP-021** When a claim is submitted, the system shall require the caller to be the claimant, a claim to have at
  least one line, and the amount to be greater than zero; it shall mint the number once (`EXP-YYMMDD####` for a claim,
  `ADV-YYMMDD####` for an advance) and stamp `submitted_at`.
- **FR-EXP-022** When a Submitted record is approved or rejected, the system shall take the spend-line lock for its
  (project, category), compute the route with `spend_approval_route` (decider = caller, submitted-at = the stamp),
  refuse a caller the route excludes with the #803 messages, require approval rank (≥ Project Manager) of a non-Admin
  caller, and write `audit_events` `expense_claim.approval_route` (to, route, reason, request amount, line budget,
  line used, category, break_glass).
- **FR-EXP-023** The system shall refuse, for every caller including an Admin: a claimant approving or rejecting their
  own record; the approver paying it; the claimant paying it (DD-EXP-3).
- **FR-EXP-024** When an Approved record is paid, the system shall require a Finance or Admin caller; stamp payer,
  `paid_at`, `paid_on` (org-timezone date) and the payment reference; and, for a claim linked to an advance, lock the
  advance and set `advance_applied` per DD-EXP-6.
- **FR-EXP-025** When a payment reference is sent with any move other than → Paid, the system shall refuse (P0001).
- **FR-EXP-026** The claimant may cancel a Draft or Submitted record; Finance or an Admin may cancel a Draft, Submitted
  or Approved one; only the claimant may send a Rejected record back to Draft.
- **FR-EXP-027** Every successful transition shall write `audit_events` `expense_claim.transition` (from, to, notes,
  advance_applied).

### Routing integration (server — re-creates `spend_approval_route`, #803 reuse contract)
- **FR-EXP-030** `spend_approval_route`'s line-used sum shall add claims (`kind = claim`) in `Approved` or `Paid` on
  the same project + category, and treat a currency difference among them as `currency_mismatch`. Advances shall not
  be added (DD-EXP-2).
- **FR-EXP-031** The system shall expose `get_expense_claim_approval_routes(p_ids uuid[])` (SECURITY INVOKER) returning,
  for each visible `Submitted` id, route, reason, approvers (id + name), request amount, line budget, line used.

### Advances
- **FR-EXP-040** The system shall expose `expense_advance_outstanding(p_id)` = amount − Σ `advance_applied` of `Paid`
  claims on it − `returned_amount`.
- **FR-EXP-041** When Finance or an Admin records a cash return with `record_expense_advance_return(p_id, p_amount,
  p_reference)`, the system shall require a `Paid` advance, a caller who is not the claimant, and
  `0 < amount ≤ outstanding` (NaN and Infinity refused); add it to `returned_amount`; and audit
  `expense_advance.return`.
- **FR-EXP-042** The system shall expose `get_expense_advance_aging()` (SECURITY INVOKER) returning each visible `Paid`
  advance with outstanding > 0: number, claimant, project, currency, amount, settled, returned, outstanding, paid
  date, age in days and bucket (DD-EXP-7).

### Notifications (#788 pattern)
- **FR-EXP-050** When a record is submitted, the system shall notify the route's approvers (route `project`/`org`),
  the org's Admins (route `admin`), or every approval-rank member (route `flat`) — never the claimant.
- **FR-EXP-051** When a record is approved, the system shall notify the claimant and the org's Finance members other
  than the claimant and the approver ("ready to pay"); when rejected, the claimant; when paid, the claimant.

### Front end (UX only — ADR-0016; the server is the authority)
- **FR-EXP-060** `/expenses` shall list visible records newest first with filters for status, kind and budget category
  (including `Special expenses`), at most 200 rows with a visible "showing the latest 200" notice when more exist.
- **FR-EXP-061** `/expenses` shall offer **New claim** and **Request advance** to every role; the form collects title,
  project (or overhead), budget category (or none), purpose, and — advance only — amount; — claim only — an optional
  outstanding advance of the caller's.
- **FR-EXP-062** `/expenses` shall show **Advances outstanding**: totals per aging bucket per currency and the rows,
  hidden when there are none, with an error state when the read fails.
- **FR-EXP-063** `/expenses/:claimId` shall show the header, lines (editable by the claimant in Draft/Rejected),
  receipts (upload/remove by the claimant in Draft/Rejected; download for every viewer), and only the actions the
  server would allow the viewer (`submit`, `approve`, `reject`, `pay`, `cancel`, `reopen`, `recordReturn`).
- **FR-EXP-064** While a Submitted record is routed to people who do not include the viewer, the record page shall
  show the #803 route note naming them and the reason, and no Approve/Reject.
- **FR-EXP-065** The pay dialog shall preview, for a claim linked to an advance, the advance applied and the cash to
  pay, computed in integer cents, and shall show "—" while the advance's outstanding is unknown.
- **FR-EXP-066** `/approvals` shall show an **Expense claims awaiting you** section (approval-rank roles) listing
  Submitted records the viewer may decide; hidden when there are none; an error state when the read fails.
- **FR-EXP-067** A notification about an `expense_claim` shall open `/expenses/:id`.
- **FR-EXP-068** The rail shall show **Expenses** to every role; the breadcrumb and ⌘K shall know the module.

## 5. Non-functional requirements
- **NFR-EXP-001 (tenancy)** No client sends `org_id`. All three tables FORCE RLS; every policy conjoins
  `is_active_member()` (0203 composition rule); children inherit `org_id` from the parent claim.
- **NFR-EXP-002 (reversible)** One migration with a written statement-by-statement reverse in its header.
- **NFR-EXP-003 (definer surface)** Exactly two new client-callable SECURITY DEFINER functions
  (`transition_expense_claim`, `record_expense_advance_return`), each re-asserting org, active membership and role in
  its body, each added to the 0178 allow-list with pgTAP proof; every other new function is SECURITY INVOKER or a
  trigger function with EXECUTE revoked from `public`, `anon`, `authenticated`.
- **NFR-EXP-004 (money)** Every money column is `numeric(14,2)` with a range CHECK that rejects NaN and Infinity; FE
  arithmetic on money is in integer cents.
- **NFR-EXP-005 (performance)** List reads are bounded (200 + 1 sentinel); routes resolve in one RPC per read; the
  line-used sum reaches claims through `(project_id, budget_category)`; aging is bounded at 500 rows with a visible
  truncation notice.
- **NFR-EXP-006 (a11y/i18n)** Every new screen is on the launch-scope i18n gate (en + id); status is text, not colour.

## 6. Acceptance criteria (Given/When/Then) — each owned by one test

pgTAP files in `supabase/tests/`; unit tests in `pmo-portal/`.

**Records and RLS — `expense_claims_schema_rls.test.sql`**
- **AC-EXP-001** *Given* an Engineer in org A, *when* they create a claim sending only kind, title and project,
  *then* it lands Draft with `org_id` = A, claimant = them, currency = A's default; *when* they send `status`,
  *then* 42501 `permission denied for table expense_claims`; *when* they create a claim with amount 50, *then* P0001
  "an expense claim's amount is the sum of its lines…". (FR-EXP-001/002/004)
- **AC-EXP-002** *Given* Engineer E1's claim and Engineer E2's claim, *then* E1 sees only theirs, a Project Manager
  sees both, and org B's Admin sees neither. (FR-EXP-010)
- **AC-EXP-003** *Given* E1's Draft claim, *when* E1 adds lines of 100 and 250, *then* its amount is 350; *when* E1
  changes the 250 line to 200, *then* 300; *when* E1 removes the 100 line, *then* 200; *when* E1 sets the claim's
  amount directly, *then* 42501 "an expense claim's amount is the sum of its lines…". (FR-EXP-003/004)
- **AC-EXP-004** *Given* E1's Submitted claim, *when* E1 updates its title, *then* no row changes; *when* E1 adds a
  line, *then* 42501; *given* E1's Draft claim, *when* a PM updates its title, *then* no row changes. (FR-EXP-006)
- **AC-EXP-005** *Given* E1's paid advance, E2's paid advance and E1's unpaid advance, *when* E1 links a claim to
  E2's, *then* 23514; to E1's unpaid one, *then* 23514; to E1's paid one, *then* it lands; *when* an advance names an
  advance, *then* 23514 "only a claim can be settled against an advance". (FR-EXP-007)
- **AC-EXP-006** *Given* E1's Draft claim, *when* E1 records a receipt row, *then* it lands with org A; *when* E2
  records one on it, *then* 42501; *given* E1's Submitted claim, *when* E1 records one, *then* 42501. (FR-EXP-005/006)

**Lifecycle — `expense_claims_transition.test.sql`**
- **AC-EXP-010** *Given* E1's Draft claim with one line, *when* E1 submits, *then* status Submitted, number matches
  `^EXP-\d{10}$`, `submitted_at` set; *given* E1's Draft advance of 500, *then* `^ADV-\d{10}$`; *when* a PM submits
  E1's claim, *then* 42501 "only the claimant can submit…"; *given* a claim with no lines, *then* P0001 "…needs at
  least one line…". (FR-EXP-021)
- **AC-EXP-011** *Given* an Admin's own Submitted claim, *when* that Admin approves it, *then* 42501 "separation of
  duties: a claimant cannot approve or reject their own expense claim". (FR-EXP-023) — *mutation-worthy*
- **AC-EXP-012** *Given* E1's Submitted claim and no spend approvers configured, *when* E2 approves, *then* 42501
  "not authorized for transition Submitted -> Approved"; *when* a PM approves, *then* Approved, `approved_by_id` = PM,
  and an `expense_claim.transition` audit row exists. (FR-EXP-022/027)
- **AC-EXP-013** *Given* an Approved claim that Finance user F1 approved, *when* a PM pays it, *then* 42501 "not
  authorized for transition Approved -> Paid"; *when* F1 pays, *then* 42501 "separation of duties: the approver cannot
  also pay this expense claim"; *given* F2's own Approved claim, *when* F2 pays it, *then* 42501 "separation of duties:
  a claimant cannot pay their own expense claim"; *when* F2 pays the F1-approved claim with reference "TRF-9", *then*
  Paid, `paid_by_id` = F2, `payment_reference` = "TRF-9", `paid_on` = today in the org's timezone. (FR-EXP-023/024)
  — *mutation-worthy*
- **AC-EXP-014** *Given* a Rejected claim, *when* a PM sends it to Draft, *then* 42501; *when* the claimant does,
  *then* Draft; *when* they resubmit, *then* the number is unchanged. (FR-EXP-020/026)
- **AC-EXP-015** *Given* a Submitted claim, *when* its claimant cancels, *then* Cancelled; *given* an Approved claim,
  *when* its claimant cancels, *then* 42501; *when* Finance cancels, *then* Cancelled. (FR-EXP-026)
- **AC-EXP-016** *Given* a Submitted claim, *when* a PM approves sending a payment reference, *then* P0001 "a payment
  reference belongs only to the payment step". (FR-EXP-025)

**Routing — `expense_claims_routing.test.sql`**
- **AC-EXP-020** *Given* a project with a 1000 `Overheads` line, PM-A named as its approver and E1's Submitted 400
  claim on that line, *when* PM-B approves, *then* 42501 "approval routing: within_budget requires a named approver";
  *when* PM-A approves, *then* Approved. (FR-EXP-022) — *mutation-worthy*
- **AC-EXP-021** *Given* that approved 400 claim, *then* a 700 purchase request on the same line reads route `org`,
  reason `exceeds_line`, line used 400 through `get_procurement_approval_routes`. (FR-EXP-030)
- **AC-EXP-022** *Given* a Paid 900 advance on the same line, *then* line used for a new claim on it is 400 — the
  advance is not counted. (FR-EXP-030, DD-EXP-2)
- **AC-EXP-023** *Given* a `Special expenses` line of 500, PM-A named and a 300 `Special expenses` claim, *then* route
  `project`, reason `within_budget`, approvers PM-A — no other path. (DD-EXP-8)
- **AC-EXP-024** *Given* a routed claim, *when* an un-named Admin approves, *then* Approved and the
  `expense_claim.approval_route` audit row has `break_glass = true`. (FR-EXP-022)
- **AC-EXP-025** *Given* a Submitted and an Approved claim, *then* `get_expense_claim_approval_routes` returns one row
  (the Submitted one); an org-B caller passing a Submitted id gets none. (FR-EXP-031)

**Line lock — `expense_claims_line_lock.test.sql`**
- **AC-EXP-026** *Given* a second session holding `spend-line:<project>:<category>` (the key procurement uses), *when*
  the named approver approves a claim on that line under a 200 ms `lock_timeout`, *then* 55P03; *when* the session
  ends, *then* the same approval succeeds. (FR-EXP-022) — *mutation-worthy*

**Advances and ACL — `expense_advances.test.sql`**
- **AC-EXP-017** *Then* `anon` holds no EXECUTE on `transition_expense_claim` or `record_expense_advance_return`, and
  `authenticated` does. (NFR-EXP-003)
- **AC-EXP-030** *Given* E1's paid 1000 advance and two Approved claims of 300 and 900 linked to it, *when* Finance
  pays the 300 claim, *then* `advance_applied` 300 and outstanding 700; *when* Finance pays the 900 claim, *then*
  `advance_applied` 700 and outstanding 0. (FR-EXP-024/040, DD-EXP-6) — *mutation-worthy*
- **AC-EXP-031** *Given* E1's paid 500 advance, *when* Finance records a 100 return, *then* outstanding 400 and an
  `expense_advance.return` audit row; *when* 450, *then* P0001 "a return of 450.00 exceeds the 400.00 still
  outstanding on this advance"; *when* `'NaN'`, *then* P0001; *given* an unpaid advance, *then* P0001; *when* a
  Finance user records a return on their own advance, *then* 42501; *when* a PM records one, *then* 42501.
  (FR-EXP-041)
- **AC-EXP-032** *Given* org timezone `Asia/Jakarta`, E1's advance paid 45 org-days ago with 500 outstanding and two
  fully settled advances, *when* a PM reads aging, *then* that advance's row reads age 45, bucket `31-60`,
  outstanding 500, and neither settled advance appears; *when* E2 (no advances) reads, *then* no rows.
  (FR-EXP-042, DD-EXP-7)

**Notifications — `expense_claims_notify.test.sql`**
- **AC-EXP-040** *Given* a project whose named approver is PM-A, *when* E1 submits a within-budget claim, *then* PM-A
  gets "Expense claim awaiting your approval" and PM-B does not; *given* no senior set configured, *when* E1 submits an
  overhead advance, *then* PM-A, PM-B and Finance get "Cash advance awaiting your approval"; E1 is never notified of
  their own submission. (FR-EXP-050)
- **AC-EXP-041** *When* PM-A approves, *then* E1 gets "Your expense claim was approved" and Finance F1 gets "Expense
  claim ready to pay"; *when* a claim is rejected, *then* E1 gets "Your expense claim was rejected"; *when* F1 pays,
  *then* E1 gets "Your expense claim was paid". (FR-EXP-051)

**Front end (Vitest)**
- **AC-EXP-050** `src/lib/db/expenseClaims.test.ts` — create sends only the granted body (no `org_id`, claimant,
  status, number, currency; `amount` only for an advance; `advance_id` only for a claim); list applies status/kind/
  category filters, orders newest first, reads 201 rows and reports `truncated`; a write that lands nothing is a 42501;
  transition sends `p_payment_reference` only when given; routes map and an empty id list makes no call; aging maps
  numerics and is bounded.
- **AC-EXP-051** `src/lib/db/expenseReceipts.test.ts` — the object path has 4 segments with the org read from the
  claim row (never the caller); a `.exe` is refused before any call; confirm inserts only `claim_id`, `file_path`,
  `title`; an archive that lands nothing throws 42501.
- **AC-EXP-052** `src/lib/expenses/expenseRules.test.ts` — `availableExpenseActions` returns exactly the server's
  allowed moves for each (status, role, identity, route) case; `settlementPreview` is cent-exact (0.1 + 0.2 class);
  `claimsAwaitingViewer` keeps flat/unrouted/named rows and drops own and routed-elsewhere rows; `agingTotals` sums
  per currency per bucket in cents.
- **AC-EXP-053** `src/hooks/useExpenseClaims.test.tsx` — query keys carry the org; every mutation invalidates list,
  record, lines, route, outstanding, aging and awaiting; the awaiting query fetches Submitted rows then one routes call,
  and a failed routes call leaves rows unrouted.
- **AC-EXP-054** `src/auth/policy.test.ts` — `expenseClaim`: view and create for all roles; edit only for the
  claimant while Draft/Rejected.
- **AC-EXP-055** `src/lib/repositories/index.test.ts` — `expenseClaim` and `expenseReceipts` are in the repository
  key set.
- **AC-EXP-060** `pages/ExpenseClaims.test.tsx` — rows render with number, claimant, project, amount, status; choosing
  the `Special expenses` filter queries with that category; **New claim** creates `kind: 'claim'` and opens the record;
  **Request advance** cannot be created without an amount; the truncation notice shows when `truncated`.
- **AC-EXP-061** `pages/ExpenseClaimDetail.test.tsx` — claimant on Draft sees Submit and Add line; un-named PM on a
  routed Submitted claim sees the route note and no Approve; the named approver sees Approve; Finance on an Approved
  advance-linked claim opens Pay and sees the advance applied and the cash to pay; the claimant on Approved sees no Pay.
- **AC-EXP-062** `pages/expenses/ExpenseLinesCard.test.tsx` — adding a line sends the parsed amount; a zero amount is
  refused before any write; read-only mode shows no add/edit/remove.
- **AC-EXP-063** `pages/expenses/AdvanceAgingCard.test.tsx` — bucket totals per currency and rows render; no rows
  renders nothing; a failed read renders the error state.
- **AC-EXP-064** `pages/approvals/ExpenseClaimApprovalSection.test.tsx` — lists only records awaiting the viewer, each
  linking to `/expenses/:id`; renders nothing when none.
- **AC-EXP-065** `src/components/shell/__tests__/NotificationBell.test.tsx` — an `expense_claim` notification
  navigates to `/expenses/<id>`.
- **AC-EXP-066** `pages/expenses/ExpenseReceiptsCard.test.tsx` — every viewer can download; Attach and Remove show
  only when writable.

**Cross-stack (Playwright)**
- **AC-EXP-070** `e2e/AC-EXP-070-expense-claim-journey.spec.ts` — *given* a budgeted project whose named approver is
  the PM seed user, *when* the Engineer seed user files a `Special expenses` claim with one line and submits, *then*
  the PM approves it from the record, Finance pays it with a reference, and the Engineer sees it Paid.

## 7. Out of scope
- Foreign-currency claims (DD-EXP-11). Entry on behalf of another person (Q2). Per-diem/mileage rate tables. Payroll
  recovery of advances. Counting claims in the dashboard committed-spend definition (OD-BUDGET-2; Q5). Bulk approve. A
  project-detail Expenses tab (the list filters by project).
- Phase B: HRMS `Expense Claim` / `Employee Advance` documents (DD-EXP-9); reversing a **Paid** claim or advance in
  ERPNext (Paid is terminal in PMO, FR-EXP-020); back-posting events that happened before the org employed the
  `expenses` domain (OD-XING-1 default); an operator screen to re-attribute a posting whose actor was offboarded (Q9);
  per-line descriptions on the Journal Entry; returns recorded before migration 0263 as `expense_advance_returns` rows
  (they remain audit events only).

## 8. Traceability

| AC | Owning layer | Test file |
|---|---|---|
| AC-EXP-001–006 | pgTAP | `supabase/tests/expense_claims_schema_rls.test.sql` |
| AC-EXP-010–016 | pgTAP | `supabase/tests/expense_claims_transition.test.sql` |
| AC-EXP-020–025 | pgTAP | `supabase/tests/expense_claims_routing.test.sql` |
| AC-EXP-026 | pgTAP | `supabase/tests/expense_claims_line_lock.test.sql` |
| AC-EXP-017, 030–032 | pgTAP | `supabase/tests/expense_advances.test.sql` |
| AC-EXP-040–041 | pgTAP | `supabase/tests/expense_claims_notify.test.sql` |
| AC-EXP-050 | Unit | `pmo-portal/src/lib/db/expenseClaims.test.ts` |
| AC-EXP-051 | Unit | `pmo-portal/src/lib/db/expenseReceipts.test.ts` |
| AC-EXP-052 | Unit | `pmo-portal/src/lib/expenses/expenseRules.test.ts` |
| AC-EXP-053 | Unit | `pmo-portal/src/hooks/useExpenseClaims.test.tsx` |
| AC-EXP-054 | Unit | `pmo-portal/src/auth/policy.test.ts` |
| AC-EXP-055 | Unit | `pmo-portal/src/lib/repositories/index.test.ts` |
| AC-EXP-060 | Unit (RTL) | `pmo-portal/pages/ExpenseClaims.test.tsx` |
| AC-EXP-061 | Unit (RTL) | `pmo-portal/pages/ExpenseClaimDetail.test.tsx` |
| AC-EXP-062 | Unit (RTL) | `pmo-portal/pages/expenses/ExpenseLinesCard.test.tsx` |
| AC-EXP-063 | Unit (RTL) | `pmo-portal/pages/expenses/AdvanceAgingCard.test.tsx` |
| AC-EXP-064 | Unit (RTL) | `pmo-portal/pages/approvals/ExpenseClaimApprovalSection.test.tsx` |
| AC-EXP-065 | Unit (RTL) | `pmo-portal/src/components/shell/__tests__/NotificationBell.test.tsx` |
| AC-EXP-066 | Unit (RTL) | `pmo-portal/pages/expenses/ExpenseReceiptsCard.test.tsx` |
| AC-EXP-070 | E2E | `pmo-portal/e2e/AC-EXP-070-expense-claim-journey.spec.ts` |
| AC-EXP-100–140 | see §10.6 | phase B |

## 9. Open questions for the owner (each has the default the build uses)
- **Q1 (ops fact). Is the HRMS app installed on the client's ERPNext site?** *Default: assume not. It does not change
  the build — DD-EXP-9 uses core doctypes either way. Phase B's pre-enable checklist re-runs the spike's §8 checks on
  the client site before the `expenses` domain is employed there.*
- **Q2. May Finance enter a claim for field staff who have no PMO login?** *Default: no. Every claimant files their
  own; field staff get a login (Engineer role sees only their own claims).*
- **Q3. Which budget category does routine field travel and accommodation charge to?** *Default: the claimant picks;
  a claim with no category routes to the senior set (#803 `no_category`).*
- **Q4. Who may see claims?** *Default: the claimant, plus Project Manager and above (DD-EXP-4).*
- **Q5. Should approved claims count in the project's committed spend on the dashboards (standalone orgs)?** *Default:
  not in this issue. They already count against budget headroom for approvals; for an ERP-connected org they reach
  project cost through the ledger once phase B ships.*
- **Q6. Should special expenses need your own signature?** *Default: no special workflow (your ruling). If you want
  to see them first, name yourself as a senior-set or project approver in Administration › Accounting.*
- **Q7 (ops fact). Which ERPNext accounts does the client use for employee expenses?** *Default: the operator creates
  one Liability account of type Payable named `Employee Payable - <abbr>` under Accounts Payable, uses the stock
  `Employee Advances - <abbr>` (Asset, type Payable) for advances, and maps each expense type to the client's own
  expense account; an Admin enters them in Administration › Accounting › Expense account map.*
- **Q8. Claims approved before the client switched expense posting on.** *Default (OD-XING-1 option 2): nothing that
  happened before the switch is posted. If such a claim is paid after the switch, its payment posts against the
  employee payable account with no link to an approval entry, so the operator must carry the claim in the opening
  balance of that account.*
- **Q9. A posting whose approver or payer has since left the company.** *Default: the posting is refused, recorded as
  failed and raised as an action-required notice (the timesheet precedent: an offboarded person's authority does not
  keep posting). Postings normally land within one sweep tick, so this needs someone to leave in that window; no
  re-attribution screen is built until it happens.*
- **Q10. Which account are staff paid from?** *Default: the connected company's default cash account, else its default
  bank account — the same account supplier payments already use.*

## 10. Phase B — ERPNext side-mirror

### 10.1 Shape

Posture B (ADR-0059): PMO stays the system of record for the claim; ERPNext receives the accounting consequence
through the existing outbox (`external_command_outbox`, ADR-0058). Every body and anchor below was observed on a live
v15 bench (`docs/spikes/2026-10-07-erpnext-employee-expense-postings.md`).

| PMO event | Posting (`posting`) | ERPNext document (core doctypes, DD-EXP-9) |
|---|---|---|
| Claim → Approved | `approval` | Journal Entry, submitted: Dr the mapped expense account of each expense type present (sum of that type's lines), each row with the claim's ERP project and the binding cost center; Cr employee payable for the full amount, party `Employee`. |
| Claim → Paid, `amount − advance_applied > 0` | `claim-payment` | Payment Entry `Pay`, party `Employee`, `paid_from` = cash/bank, `paid_to` = employee payable, for the cash part; `references` = the approval Journal Entry. |
| Claim → Paid, `advance_applied > 0` | `settlement` | Journal Entry: Dr employee payable (party `Employee`, `reference_type/name` = the approval Journal Entry) / Cr employee advance (party `Employee`) for `advance_applied`. |
| Advance → Paid | `advance-payment` | Payment Entry `Pay`, party `Employee`, `paid_from` = cash/bank, `paid_to` = employee advance. |
| Advance return recorded | `advance-return` | Payment Entry `Receive`, party `Employee`, `paid_from` = employee advance, `paid_to` = cash/bank. |
| Claim Approved → Cancelled (after its approval was queued) | `approval-cancel` | Cancel of the approval Journal Entry (`docstatus 2`). |

### 10.2 Director decisions (phase B — proposed 2026-10-07 by eng-planner, for Director ratification into `docs/decisions.md`)

- **DD-EXP-12 — One originator: a durable intent written in the event's own transaction, driven only by the sweep.**
  A trigger on `expense_claims` (status changes) and on the new `expense_advance_returns` writes a `pending` row into the
  side mirror `expense_posting_erp_mirror` in the same transaction as the PMO event. The ERPNext sweep is the only
  component that turns an intent into an ERP document; `adapter-dispatch` has no `expenses` route and refuses the
  domain. Recorded as ADR-0081. *Why:* every Posture-B defect class of P3b came from two originators (the browser and
  the sweep) — the absent-queue, the foreground/sweep race, the lost mirror update. A claim needs no sub-minute posting.
- **DD-EXP-13 — The `expenses` domain; employment is explicit.** A new PMO domain `expenses` (Posture B, no RLS flip).
  An intent is written only while the org has an activated ERPNext binding **and** an `external_domain_ownership` row
  for `expenses` on the `erpnext` tier. Events before that are never posted (OD-XING-1 default, Q8).
- **DD-EXP-14 — Three ERP kinds, deterministic keys.** `expense-journal` (Journal Entry, anchor `user_remark`,
  immutable — reissue-capable), `expense-payment` (Payment Entry `Pay`, anchor `reference_no`, mutable — held on an
  inconclusive recovery, C-1), `expense-receipt` (Payment Entry `Receive`, same). Key =
  `<prefix>:<subject uuid>:<state stamp as epoch ms>` with prefixes `expj` (approval), `exps` (settlement), `expx`
  (approval cancel), `expp` (claim payment), `expa` (advance payment), `expr` (advance return). Subject = the claim, the
  advance, or the return row.
- **DD-EXP-15 — Everything is resolved before the outbox row exists, and frozen into its payload.** Employee, accounts,
  ERP project, cost center, cash account, approval Journal Entry name, posting date. A replay sends exactly the body
  the digest was taken over; an intent whose outbox row exists is replayed, never re-decided.
- **DD-EXP-16 — The account map is written only through a validating server action.** `expense_account_map` holds 7
  keys (`employee_payable`, `employee_advance`, and one per expense type). Clients can read it, never write it; Admin
  saves go through `external-set-company` (`save-expense-account` / `clear-expense-account`), which reads the account
  from ERPNext and refuses it unless it fits (FR-EXP-112). The same rule re-runs before every posting.
- **DD-EXP-17 — Each cash return is its own row.** `record_expense_advance_return` additionally writes an
  `expense_advance_returns` row; each row is the subject of one `advance-return` posting.
- **DD-EXP-18 — Only an approval is ever cancelled, and only after it posted.** Paid is terminal, so PMO never cancels
  a Payment Entry or a settlement. An `approval-cancel` waits until the approval Journal Entry is posted (the approval
  is always posted first, then cancelled), which also satisfies the spike's cancel order (no dependent document can
  exist on an approval of a claim that was cancelled before payment).
- **DD-EXP-19 — Never adopt; poll only what is ours.** A Journal Entry or Employee Payment Entry created in ERPNext
  directly is acknowledged and skipped (no notice: payroll and other native employee entries are normal). The procurement
  and revenue Payment Entry polls stop reading Employee entries (a revenue-domain org would otherwise have adopted an
  employee cash return as a customer receipt); the Journal Entry poll admits only rows whose `user_remark` is a PMO key.
- **DD-EXP-20 — Posting date = the org-timezone date of the event's stamp** (`approved_at`, `paid_at`, the return's
  `recorded_at`, `cancelled_at`).
- **DD-EXP-21 — The ERP Employee master is polled for an org that employs `timesheets` or `expenses`.**
- **DD-EXP-22 — `expenses` becomes employable from the Admin setup screen only in the release that carries the cancel
  path and lands after #901**, so no org can post approvals that PMO could not later cancel cleanly.

### 10.3 Functional requirements (EARS)

**Intent (server, migration 0263)**
- **FR-EXP-100** While an org employs the `expenses` domain (DD-EXP-13), when one of the §10.1 events commits, the
  system shall write in the same transaction one `pending` intent per posting into `expense_posting_erp_mirror` with the
  posting, its subject, the event's stamp and the event's actor (approver, payer, return recorder, or the cancelling
  caller). While it does not, the system shall write none.
- **FR-EXP-101** When a claim is paid, the system shall write `claim-payment` only when `amount − advance_applied > 0`
  and `settlement` only when `advance_applied > 0`. When a claim moves Approved → Cancelled, the system shall write
  `approval-cancel` only when the claim has an `approval` intent.
- **FR-EXP-102** When a cash return is recorded, the system shall store it as a row of `expense_advance_returns`
  (advance, amount, reference, recorder, time, org-timezone date) in the same transaction that adds it to
  `returned_amount`; every phase-A rule of FR-EXP-041 is unchanged.

**Driving (sweep)**
- **FR-EXP-103** The system shall turn an intent into an ERP document only in the ERPNext sweep. When
  `adapter-dispatch` receives a command in the `expenses` domain, it shall refuse it (400 `UNSUPPORTED_DOMAIN`).
- **FR-EXP-104** Before each fresh attempt, the sweep shall re-read from the database, through
  `expense_posting_for_push`, the record's kind and status, the stamp the intent was written with, the amounts, and the
  recorded actor's current standing (active member of the same org; approval rank or Admin for `approval`; Finance or
  Admin for every other posting). When any check fails, it shall record the intent `failed` with the reason, raise an
  action-required notice and send nothing.
- **FR-EXP-105** The system shall key every posting with the DD-EXP-14 key and run it through the ADR-0058 outbox (the
  outbox row is attributed to the recorded actor); a Journal Entry carries the key in `user_remark`, a Payment Entry in
  `reference_no`. When an outbox row already exists for an intent's key, the sweep shall replay that row from its frozen
  payload (re-authorizing the recorded actor) and shall not re-decide it.
- **FR-EXP-106** Before any ERP write, the system shall resolve, and refuse the attempt (intent `failed`, reason named)
  when it cannot: the claimant's **confirmed** ERP Employee (`employee-unlinked`); every account key the posting needs
  (`expense-account-unmapped`); the ERP project of a claim that has a project (`project-unmapped`); the binding's cash,
  else bank, account for a Payment Entry (`expense-cash-account-unconfigured`); each account passing FR-EXP-112
  (`expense-account-invalid`); the ERP company currency equal to the claim currency (`config-rejected`).
- **FR-EXP-107** Journal Entry bodies shall put `project` and `cost_center` only on expense rows, put `party_type
  Employee` + `party` on every payable and advance row, and refuse an unbalanced or zero entry before any write.
  Payment Entry bodies shall always carry `paid_from`, `paid_to`, `party_type Employee`, `party`, `paid_amount =
  received_amount`, and `reference_date` = the posting date.
- **FR-EXP-108** When PMO builds an amended Journal Entry, the body shall carry the posting's key in `user_remark`
  again (ERPNext does not copy it, spike §2).
- **FR-EXP-109** The posting date shall be the org-timezone date of the event's stamp (DD-EXP-20).
- **FR-EXP-110** While a claim has an `approval` intent that is not yet posted, its `claim-payment` and `settlement`
  shall stay `pending`; once posted, both shall reference the approval Journal Entry (the Payment Entry through
  `references`, the settlement through its payable row). When the claim has no `approval` intent (approved before
  employment), both shall post without a reference.
- **FR-EXP-111** An `approval-cancel` shall stay `pending` until the approval Journal Entry is posted, then cancel it;
  when ERPNext already shows it cancelled, the intent shall be recorded done without a write.
- **FR-EXP-112** The system shall accept an account for a key only when ERPNext reports it as a leaf, enabled account
  of the binding's company whose currency (when stated) is the company currency, and: `employee_payable` — root type
  Liability, account type Payable, and not the company's default payable account (`Creditors`), refused outright when
  that default is unknown; `employee_advance` — root type Asset, account type Payable (a blank type is refused); an
  expense type — root type Expense.
- **FR-EXP-113** Inbound, the system shall mirror only lifecycle for the three kinds (docstatus, modified, amended
  from, cancel time), never adopt an ERP document it did not post, raise an action-required notice when a posted
  document is cancelled in ERPNext unless PMO's own `approval-cancel` did it, and poll: Employee Payment Entries only
  for the expense kinds, non-Employee Payment Entries only for the procurement and revenue kinds, Journal Entries only
  when `user_remark` is an expense key.
- **FR-EXP-114** The ERP Employee master shall be polled for an org that employs `timesheets` or `expenses`.
- **FR-EXP-115** Each intent shall carry `push_state ∈ {pending, failed, held, pushed}`, the classified reason and
  the ERP document name. An intent whose outbox command ran out of attempts, or whose Payment Entry recovery was
  inconclusive, shall be `held`. `pushed`, `held` and ERPNext-cancelled intents shall never be re-driven.

**Admin and record page (UX only — the server is the authority)**
- **FR-EXP-116** Administration › Accounting shall show **Expense account map** — the 7 keys, each mapped account or
  a "Not mapped" warning — with Save and Clear for Admins; a refusal from the server shall be shown in the form.
- **FR-EXP-117** `/expenses/:claimId` shall show **Ledger postings** — each intent's label, state, ERP document name
  and reason — to every viewer of the claim, and nothing when the claim has none.
- **FR-EXP-118** An Admin shall be able to employ the `expenses` domain from ERP setup only once FR-EXP-111 has
  shipped and #901 is on `dev` (DD-EXP-22).

### 10.4 Non-functional requirements (phase B)
- **NFR-EXP-010 (tenancy)** The three new tables FORCE RLS; their `org_id` has no default and is written explicitly by
  the trigger, the RPC or the service-role writer; `authenticated` holds SELECT only (scoped like the parent claim, or
  the org for the account map), `anon` nothing.
- **NFR-EXP-011 (reversible)** Migration `0263` only, with `supabase/migrations/rollback/0263_expense_postings_down.sql`.
- **NFR-EXP-012 (definer surface)** No new client-callable function: the gate is SECURITY INVOKER and executable only
  by `service_role`; the two trigger functions are SECURITY DEFINER with EXECUTE revoked from `public`, `anon`,
  `authenticated`, `service_role`. The migration ends with an in-database assertion of this ACL shape (hosted grant
  defaults), and the 0178 allow-list count stays 59.
- **NFR-EXP-013 (bounded)** At most 200 intents per org per sweep tick (index-served); before its write a posting
  makes at most one ERP read per distinct account it needs (≤ 7, usually 2–3), one company read, and for a cancel one
  Journal Entry read; the poll discriminators are server-side filters.
- **NFR-EXP-014 (a11y/i18n)** Both new UI sections are on the launch-scope i18n gate (en + id); state is text.

### 10.5 Acceptance criteria (Given/When/Then)

**Intent — `supabase/tests/0263_expense_postings_enqueue.test.sql`**
- **AC-EXP-100** *Given* org A with an activated ERPNext binding and the `expenses` domain employed, and org C with
  the binding but no `expenses` row, *when* a PM approves E1's Submitted claim in each, *then* A holds exactly one
  `approval` intent, `pending`, with `state_stamp` = the claim's `approved_at` and `actor_id` = the PM, and C holds
  none. (FR-EXP-100) — *mutation-worthy*
- **AC-EXP-101** *Given* org A, E1's paid 500 advance and two Approved claims of 800 and 300 (the 300 on a second paid
  1000 advance), *when* Finance pays them, *then* the 800 claim has `claim-payment` and `settlement` intents, the 300
  claim has only `settlement`, and *when* Finance pays a 200 advance, *then* it has one `advance-payment` intent.
  (FR-EXP-100/101) — *mutation-worthy*
- **AC-EXP-103** *Given* org A, *when* Finance cancels an Approved claim that has an `approval` intent, *then* an
  `approval-cancel` intent exists with `actor_id` = that Finance user; *when* the claimant cancels a Submitted claim,
  or Finance cancels an Approved claim with no `approval` intent, *then* none. (FR-EXP-101)

**Returns — `supabase/tests/0263_expense_advance_returns.test.sql`**
- **AC-EXP-102** *Given* org A and E1's paid 500 advance, *when* Finance F1 records a 100 return with reference "CB-1",
  *then* `returned_amount` is 100, one `expense_advance_returns` row holds 100, "CB-1", recorder F1 and today's
  Asia/Jakarta date, and one `advance-return` intent names that row; *when* F1 records 450, *then* P0001 and no new row.
  (FR-EXP-102, FR-EXP-041)

**ACL — `supabase/tests/0263_expense_postings_acl.test.sql`**
- **AC-EXP-104** *Then* `authenticated` holds SELECT and no INSERT/UPDATE/DELETE on the three new tables and `anon`
  holds nothing; E1 sees the intents and returns of their own advance, E2 sees none of them, a PM sees every intent,
  org B's Admin sees none; a member of org A reads org A's account map and org B's Admin reads none of it; `anon` and
  `authenticated` cannot execute `expense_posting_for_push`, `org_employs_expense_postings` or the enqueue functions and
  `service_role` can execute the first two; the account map's key CHECK admits exactly the `expense_type` labels plus
  `employee_payable` and `employee_advance`. (NFR-EXP-010/012)

**Gate — `supabase/tests/0263_expense_posting_gate.test.sql`**
- **AC-EXP-105** *Given* an `approval` intent for a claim with lines Travel 100 + 50 and Meals 25 approved at
  `2026-10-07 18:30:00+00` in an Asia/Jakarta org, *when* the service role reads the gate, *then* it returns amount
  `175.00`, lines `[{Meals, 25.00}, {Travel, 150.00}]`, posting date `2026-10-08` and that the claim has an approval
  intent; *given* an approval intent whose recorded approver is disabled, *then* 42501 `expense-posting-actor-inactive`;
  *given* a `claim-payment` intent whose recorded actor is an Engineer, *then* 42501
  `expense-posting-actor-not-authorized`; *when* the intent's stamp no longer equals the claim's, *then* P0001
  `expense-posting-precondition-failed`; *when* org B's id is passed, *then* P0002; *when* an authenticated user calls
  it, *then* 42501 permission denied. (FR-EXP-104, FR-EXP-109) — *mutation-worthy*

**Adapter seam (Vitest, `pmo-portal/src/lib/adapterSeam/erpnext/`)**
- **AC-EXP-110** `expensePostingKey.test.ts` — each posting maps to its prefix; the key is
  `<prefix>:<lowercase uuid>:<epoch ms>`; the PostgREST, SQL and offset spellings of one instant yield one key; a
  missing or unparseable stamp throws `commit-rejected`; the outbox identity of `approval-cancel` is the approval's.
  (FR-EXP-105)
- **AC-EXP-111** `bodies/expenseJournal.test.ts` — an approval body has one debit row per type with project and cost
  center and one Employee credit row with neither; an overhead approval has no project key; a settlement body's payable
  row carries `reference_type: 'Journal Entry'` and the approval name; an unbalanced, zero, short or malformed body
  throws before any call. (FR-EXP-107)
- **AC-EXP-112** `adapter.expenseJournalAmend.test.ts` — an amend of an `expense-journal` creates the new document
  with `amended_from` and `user_remark` = the command's key. (FR-EXP-108) — *mutation-worthy*
- **AC-EXP-113** `bodies/expensePayment.test.ts` — every payment body carries `paid_from`, `paid_to`,
  `party_type: 'Employee'`, `reference_date`; a claim payment carries one Journal Entry reference for the full amount,
  an advance payment and a return carry none; a direction that contradicts the kind, a missing account and a zero
  amount throw. (FR-EXP-107)
- **AC-EXP-114** `expenseKinds.test.ts` — the three kinds' doctype, anchor and reissue policy; `KIND_DOMAIN` maps
  them to `expenses`; `kindFromDoctype('Payment Entry')` is unchanged and `kindFromDoctypeAndPaymentType` (and the
  webhook decoder) route an Employee entry to the expense kinds; the three are company-scoped;
  `sweepKindsForOrg(['expenses'])` includes the Employee master; the poll discriminators of FR-EXP-113; the never-adopt
  code is terminal. (FR-EXP-113/114)
- **AC-EXP-115** `expensePostingResolve.test.ts` — each refusal of FR-EXP-106 with its code and no ERP read before it;
  a payment waits while the approval is unposted, references it once posted, is refused when ERPNext cancelled the
  approval, and has no reference (and no approval read) when there is no approval intent; a cancel waits, is done when
  ERPNext already shows docstatus 2, else is ready; a ready result carries exactly the accounts the posting needs.
  (FR-EXP-106/110/111) — *mutation-worthy*
- **AC-EXP-116** `recoveryProbe.employee.test.ts` — an Employee composite probe adopts the unique candidate citing the
  approval Journal Entry, adopts a unique no-reference candidate when the posting cites none, holds on two candidates,
  and a Supplier probe is unchanged. (FR-EXP-105)
- **AC-EXP-117** `expensePostingCommand.test.ts` — the command for each posting: kind, operation, outbox identity,
  key, frozen payload fields (including the composite-probe fields of a Payment Entry); a cancel is a `transition`
  with `verb: 'cancel'` on the approval's ERP name; a missing reference refuses the build. (FR-EXP-105/110/111)
- **AC-EXP-118** `expenseAccountRules.test.ts` — FR-EXP-112's rule for every key: refuses `Creditors - X` as
  `employee_payable` (and any payable when the company default is unknown), a blank-typed advance account, a group, a
  disabled account, another company's account, a foreign-currency account and the wrong root type; accepts the spike's
  accounts. (FR-EXP-112) — *mutation-worthy*
- **AC-EXP-127** `expensePostingCommand.test.ts` — a built `approval-cancel` run through the adapter issues exactly one
  `PUT …/Journal Entry/<approval name>` with `docstatus 2`, then re-reads it. (FR-EXP-111)

**Edge functions (Deno)**
- **AC-EXP-120** `supabase/functions/external-set-company/setup.test.ts` — an Admin saving `employee_payable` =
  `Creditors - EX`, or an untyped advance account, gets 422 and nothing is written; a valid account is upserted
  (trimmed) with the actor and audited; `clear-expense-account` deletes the key; a Project Manager gets 403; an unknown
  key gets 400. (FR-EXP-112, DD-EXP-16) — *mutation-worthy*
- **AC-EXP-121** `supabase/functions/erpnext-sweep/expensePostingBackstop.test.ts` — a gate refusal is recorded
  `failed` and nothing is driven; a resolver refusal likewise with its code; a wait leaves the intent untouched;
  already-done is recorded `pushed` with the ERP name; a ready intent is driven once; an intent with an outbox row is
  replayed without running the gate; a row that throws is recorded per row and the queue drains.
  (FR-EXP-104/105/106/110)
- **AC-EXP-122** `supabase/functions/erpnext-sweep/expensePollDiscriminators.test.ts` — the `payment` and
  `incoming-payment` polls filter `party_type != Employee`, the expense Payment Entry polls `= Employee` in their
  direction, the Journal Entry poll `user_remark like exp%` and its row filter admits only expense keys of the binding's
  company; each poll requests the fields its filters read. (FR-EXP-113)
- **AC-EXP-123** `supabase/functions/adapter-dispatch/expensesRefused.test.ts` — a well-formed `expenses` command from
  an authenticated user gets 400 `UNSUPPORTED_DOMAIN` and touches no outbox and no ERP. (FR-EXP-103) —
  *mutation-worthy*
- **AC-EXP-124** `supabase/functions/adapter-dispatch/readModelWriters.expenses.test.ts` — a landed posting marks its
  intent `pushed` with the ERP name; a landed cancel marks the cancel `pushed` and the approval cancelled; a command
  without a posting identity throws. (FR-EXP-115)
- **AC-EXP-125** `supabase/functions/adapter-dispatch/authGuard.expenses.test.ts` — an `expenses` command by an active
  Project Manager passes the role half (delegated to the gate); an inactive actor and a kind of another domain are
  refused. (FR-EXP-104)
- **AC-EXP-126** `supabase/functions/_shared/erpnextFeedDeps.expenses.test.ts` — a native Journal Entry for the expense
  kind has no adopt strategy, throws `native-expense-posting-not-adopted` and writes nothing; a cancel of a posted
  approval raises `expense-posting-desk-cancelled` unless an `approval-cancel` intent exists. (FR-EXP-113)
- **AC-EXP-128** `supabase/functions/external-set-company/setup.test.ts` — `employ-domain` with `expenses` probes
  Journal Entry, Payment Entry and Employee read access and records the ownership. (FR-EXP-118)

**Front end (Vitest)**
- **AC-EXP-130** `pages/admin/ExpenseAccountMap.test.tsx` — 7 rows render with mapped accounts or "Not mapped"; an
  Admin's Save sends the key and the trimmed account; the server's refusal shows in the form; a non-Admin sees no
  actions. (FR-EXP-116)
- **AC-EXP-131** `pages/expenses/ExpensePostingsCard.test.tsx` — one row per intent with label, state text and ERP name;
  a failed intent shows its reason; an ERPNext-cancelled posting says so; no intents renders nothing; a failed read
  renders the error state. (FR-EXP-117)
- **AC-EXP-132** `src/lib/repositories/expensePostings.test.ts` — the postings read filters by claim and orders by
  creation; the account-map read maps keys; both throw with the error code. (FR-EXP-116/117)

**Cross-stack (Playwright, served lane against the local bench)**
- **AC-EXP-140** `e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts` — *given* an org in IDR with an `expenses`
  binding, a project in IDR with `subject_to_vat` stated, the account map, and the Engineer's confirmed Employee link,
  *when* the Engineer takes a 50,000 advance (approved and paid), files a 150,000 Travel claim settling it, the PM
  approves, Finance pays and the sweep runs, *then* ERPNext holds one approval Journal Entry whose `user_remark` is the
  approval key and whose Travel row carries the project, one Payment Entry `Pay` of 100,000 from cash to employee payable
  referencing that Journal Entry, one settlement Journal Entry of 50,000 and one advance Payment Entry of 50,000 to the
  advance account, and all four intents are `pushed`; *when* the sweep runs again, *then* ERPNext holds no further
  documents and the GL mirror holds the Travel debit with the project. (FR-EXP-100..110)

### 10.6 Traceability (phase B)

| AC | Owning layer | Test file |
|---|---|---|
| AC-EXP-100, 101, 103 | pgTAP | `supabase/tests/0263_expense_postings_enqueue.test.sql` |
| AC-EXP-102 | pgTAP | `supabase/tests/0263_expense_advance_returns.test.sql` |
| AC-EXP-104 | pgTAP | `supabase/tests/0263_expense_postings_acl.test.sql` |
| AC-EXP-105 | pgTAP | `supabase/tests/0263_expense_posting_gate.test.sql` |
| AC-EXP-110 | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/expensePostingKey.test.ts` |
| AC-EXP-111 | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/expenseJournal.test.ts` |
| AC-EXP-112 | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/adapter.expenseJournalAmend.test.ts` |
| AC-EXP-113 | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/expensePayment.test.ts` |
| AC-EXP-114 | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/expenseKinds.test.ts` |
| AC-EXP-115 | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.test.ts` |
| AC-EXP-116 | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.employee.test.ts` |
| AC-EXP-117, 127 | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/expensePostingCommand.test.ts` |
| AC-EXP-118 | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/expenseAccountRules.test.ts` |
| AC-EXP-120, 128 | Deno | `supabase/functions/external-set-company/setup.test.ts` |
| AC-EXP-121 | Deno | `supabase/functions/erpnext-sweep/expensePostingBackstop.test.ts` |
| AC-EXP-122 | Deno | `supabase/functions/erpnext-sweep/expensePollDiscriminators.test.ts` |
| AC-EXP-123 | Deno | `supabase/functions/adapter-dispatch/expensesRefused.test.ts` |
| AC-EXP-124 | Deno | `supabase/functions/adapter-dispatch/readModelWriters.expenses.test.ts` |
| AC-EXP-125 | Deno | `supabase/functions/adapter-dispatch/authGuard.expenses.test.ts` |
| AC-EXP-126 | Deno | `supabase/functions/_shared/erpnextFeedDeps.expenses.test.ts` |
| AC-EXP-130 | Unit (RTL) | `pmo-portal/pages/admin/ExpenseAccountMap.test.tsx` |
| AC-EXP-131 | Unit (RTL) | `pmo-portal/pages/expenses/ExpensePostingsCard.test.tsx` |
| AC-EXP-132 | Unit | `pmo-portal/src/lib/repositories/expensePostings.test.ts` |
| AC-EXP-140 | E2E (serial, served) | `pmo-portal/e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts` |

### 10.7 Dependency

**#901 (the GL mirror does not re-read cancelled rows)** must be on `dev` before part 6 (the `expenses` employ switch)
lands. Before #901, a cancelled approval Journal Entry would stay live in `erp_gl_entry_mirror` and overstate project
actuals. Parts 2–5 build the whole path including the cancel, but are inert without the employ switch, so they may land
first; phase B is correct either way because no org can employ `expenses` until part 6.
