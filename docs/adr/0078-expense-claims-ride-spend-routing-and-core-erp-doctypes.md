# ADR-0078 — Expense claims are one PMO record on the spend-routing rule, posted to ERPNext through core doctypes only

- **Status:** Proposed (2026-10-06)
- **Context:** #775; spec `docs/specs/expense-claims.spec.md`; plan `docs/plans/2026-10-06-expense-claims.md`
- **Related:** OD-PROC-5 (claims are not procurements), OD-PROC-1/8 (SoD outside the Admin skip), OD-SAR-PMO-IS-THE-UI
  (ERPNext is headless), ADR-0075 (spend approval routing — its §3 names this issue as a caller), ADR-0019
  (server-enforced SoD), ADR-0055/0059 (external system owns money; PMO-run processes are Posture B), ADR-0058
  (money outbox), ADR-0070 (approval authority is rank)

## Context

Field staff at the first client take cash advances and claim travel, accommodation and special expenses on emailed PDF
forms. Claims arrive untagged to projects and advances are aged by hand. PMO needs an entry → approval → settlement
flow that tags spend to a project, applies the same "who approves this spend" rule purchase requests now follow
(#803), and leaves the accounting to ERPNext.

Three questions decide the architecture:

1. **Reuse the procurement record, or a new one?** OD-PROC-5 already ruled claims must not live in `procurements`
   ("post-spend, employee-paid, manager-approved, no vendor/PO/GR"), sharing only the approve → Finance → paid tail.
2. **How does approval routing apply?** ADR-0075 built `spend_approval_route` record-agnostic so claims could call it,
   and said claims extend only that function's "line used" sum.
3. **Which ERPNext documents?** ERPNext's own `Expense Claim` and `Employee Advance` live in the separately installed
   HRMS app. The plan must work whether or not a client site has HRMS.

## Decision

1. **One table, two kinds.** `expense_claims(kind ∈ {claim, advance})` with one status machine
   (Draft → Submitted → Approved → Paid, with Rejected/Cancelled) and one SECURITY DEFINER transition RPC. Lines and
   receipts are child tables. An advance is the same record shape with an entered amount and no lines; it is not a
   separate module because it is decided, paid and audited exactly like a claim.
2. **Routing is called, never copied.** The transition RPC calls `spend_approval_route` with the claim's project,
   budget category, amount, currency, claimant, decider and submission time, under the same per-line advisory lock
   key procurement uses, so a claim and a purchase request on one budget line serialize against each other. Approved
   and paid claims join that function's line-used sum; advances do not (cash in custody is not cost, and counting both
   the advance and the claims that settle it would double-count).
3. **SoD in the RPC body, outside the Admin break-glass:** approver ≠ claimant, payer ≠ approver, payer ≠ claimant,
   return-recorder ≠ claimant.
4. **Settlement nets against the advance at payment time.** `advance_applied = min(claim, advance outstanding)` is
   computed under a row lock on the advance and stored on the claim; outstanding is derived, never stored.
5. **ERPNext posting uses core doctypes only — Journal Entry and Payment Entry with `party_type = Employee` — on every
   site, HRMS or not.** HRMS `Expense Claim` / `Employee Advance` are never written. The posting is Posture B (PMO is
   the system of record; ERPNext receives the accounting consequence through the ADR-0058 outbox) and ships as a
   separate phase after a bench spike pins the Journal Entry idempotency anchor.

## Consequences

- Good: one rule decides who approves any spend; one lock protects each budget line across both record types; no new
  routing configuration.
- Good: the ERP path has no app-install precondition and one code path. Employee, Journal Entry and Payment Entry exist
  on every ERPNext site; the claimant's ERP Employee link already exists for timesheets (0148).
- Good: Phase A runs fully standalone, so a client without ERPNext gets the whole workflow.
- Cost: an ERP-connected client's ledger-based project actuals do not include claims until phase B ships; phase A
  shows the claim and its budget-headroom effect only.
- Cost: with HRMS installed, HRMS's own expense reports stay empty — the GL, the project-wise ledger and PMO carry the
  truth instead. Acceptable while ERPNext is headless; reopen if accountants start working in HRMS.
- Cost: `spend_approval_route` is re-created by this migration, so its body now has two authors' lines; the migration
  marks every added line `-- 0247` and its reverse removes exactly those.
- Cost: approved claims are not part of OD-BUDGET-2's committed-spend definition on the dashboards (owner question Q5).

## Alternatives considered

- **Put claims in `procurements`.** Rejected by OD-PROC-5; the procurement machine's vendor/quote/PO/receipt states
  would all be skipped, and its committed-spend definition would silently absorb personal reimbursements.
- **Two tables (claims, advances).** Rejected: two copies of the status machine, SoD, routing call, notifications and
  list UI for records that differ by one field.
- **HRMS doctypes when installed, Journal/Payment Entry otherwise.** Rejected: two posting paths to build, spike and
  keep correct, selected by a per-site fact, for a UI nobody opens. HRMS's `expense_approver` would also have to be
  mapped from PMO's routed approver — a second approval record of the same decision.
- **Count advances in the budget line instead of claims.** Rejected: an advance can be returned or under-spent; the
  claim is the cost.
