# Feature: Expense claims and cash advances (#775)

> **Status:** Draft for Director sign-off (2026-10-06). Plan: `docs/plans/2026-10-06-expense-claims.md` (+ part2…part6).
> ADR: `docs/adr/0078-expense-claims-ride-spend-routing-and-core-erp-doctypes.md`.
> **Grounds (read, not re-derived):** `docs/decisions.md` OD-PROC-5 (claims are their own flow, never inside
> `procurements`, sharing only the approve → Finance → paid tail), OD-PROC-1/OD-PROC-8 (SoD outside the Admin
> skip), OD-SAR-PMO-IS-THE-UI (ERPNext is headless; accountants work in PMO), DD-APR-1..5 + ADR-0075 (spend approval
> routing, #803 — `spend_approval_route` is the one rule; its reuse contract names this issue), ADR-0019
> (server-enforced SoD), ADR-0055/0059 (ERPNext owns money; PMO-run processes are Posture B — PMO SoT, side-mirrored),
> ADR-0058 + `docs/money-path-primer.md` (outbox/sweep), #804 / migration 0229 (`Special expenses` budget category).
> **Builds on (merged on `dev`):** #803 — `supabase/migrations/0243_spend_approval_routing.sql`
> (`spend_approval_route`, `holds_spend_approval_authority`, `spend_approvers`, `get_procurement_approval_routes`);
> #788 — migration `0237` (`notify_workflow_user`).

## 1. Job story

When staff take cash advances and claim field expenses (travel, accommodation, special expenses) for a project, I
want to enter, approve and settle them in PMO tagged to the project, so field cost reaches project cost and advance
aging isn't kept by hand. Today the first client runs these on emailed PDF forms; small amounts, but untagged claims
were a recurring year-end reclass.

## 2. Scope and phasing

| Phase | Delivers | This spec |
|---|---|---|
| **A — PMO process** (this build) | Claims and advances: entry with project + budget category + lines + receipts; approval through the #803 routing; settlement by Finance (claims net against advances); advance returns; advance aging; notifications. Runs fully standalone. | §4–§9, every AC below |
| **B — ERPNext side-mirror** (follow-on issue) | Approved claims and paid advances/claims posted to ERPNext through core doctypes (DD-EXP-9). Needed before field cost reaches the ledger-based project actuals of an ERP-connected client. | §10 only (shape + the spike that unblocks it) |

Phase B is not planned task-by-task here: its document bodies and idempotency anchors must be read off a live bench
first (the P3b/P3c precedent — every ERP kind so far was spike-frozen before it was built). Inventing them would be
inventing requirements. §10 names the spike and its exact questions.

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
- ERPNext posting (phase B, §10). Foreign-currency claims (DD-EXP-11). Entry on behalf of another person (Q2).
  Per-diem/mileage rate tables. Payroll recovery of advances. Counting claims in the dashboard committed-spend
  definition (OD-BUDGET-2; Q5). Bulk approve. A project-detail Expenses tab (the list filters by project).

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

## 9. Open questions for the owner (each has the default the build uses)
- **Q1 (ops fact). Is the HRMS app installed on the client's ERPNext site?** *Default: assume not. It does not change
  the build — DD-EXP-9 uses core doctypes either way. The phase B spike records the answer for the bench and the
  client site.*
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

## 10. Phase B — ERPNext side-mirror (shape only; planned after the spike)

Posture B (ADR-0059): PMO stays the system of record for the claim; ERPNext receives the accounting consequence
through the existing outbox (`external_command_outbox`, ADR-0058) and `adapter-dispatch`.

| PMO event | ERPNext document (core doctypes, DD-EXP-9) |
|---|---|
| Claim → Approved | Journal Entry, submitted: Dr the expense account of each line (row `project` + cost center); Cr employee payable (`party_type = Employee`) for the full amount. The advance-applied part is only known at payment, so it is cleared there. |
| Claim → Paid | Payment Entry `Pay`, party Employee, for the cash part (`amount − advance_applied`) against employee payable; and, when `advance_applied > 0`, a Journal Entry Dr employee payable / Cr employee advance for `advance_applied` (both rows party Employee). |
| Advance → Paid | Payment Entry `Pay`, party Employee, paid to the employee advance account. |
| Advance return | Payment Entry `Receive`, party Employee, from the employee advance account. |

Party = the claimant's confirmed ERP Employee link (the P3b `confirm_erp_employee_link`, 0148). Accounts come from an
Admin-maintained map (the `budget_category_account_map` / `BudgetAccountMap` pattern) keyed by expense type, plus
two org-level accounts (employee payable, employee advance).

**Spike questions (must be answered on a live bench, with and without HRMS, before phase B is planned — plan Task 46):**
1. Does `Journal Entry` accept `party_type = Employee` on both a payable and an asset (advance) account with no HRMS
   present, and does HRMS, when present, add validation that refuses it?
2. Which free-text field on `Journal Entry` survives validate + submit + re-fetch verbatim and is REST-filterable
   (candidates: `user_remark`, `cheque_no`)? That is the ADR-0058 anchor. Is it mutable after submit (C-1)?
3. For `Payment Entry` with `party_type = Employee` and no HRMS: how is `paid_to` resolved, and must PMO send it?
4. Does a JE row's `project` reach the GL Entry so the existing `erp_gl_entry_mirror` → actuals path sees it?
5. What does a cancelled JE / PE look like through the existing sweep (docstatus 2) — enough for the mirror?
