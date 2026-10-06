# ADR-0077 — Progress is assessed, not invoiced; billing claims post the down payment and its recovery as invoice lines on an advance-account item

- **Status:** Proposed (2026-10-06, issue #766; revised the same day after the owner's ruling)
- **Related:** ADR-0048 (ERPNext is the accounting engine; PMO mirrors money, never recomputes it), ADR-0055
  (external system is SoT per domain; PMO keeps read models and additive enhancements), ADR-0058 (outbox: one
  PMO record mints at most one ERP document), ADR-0019 (server-enforced SoD), ADR-0076 (management pack:
  recognition is a PMO estimate over billing; `project_progress_entries`), ADR-0071 and the 2026-06-12
  document-register rule (issued content is frozen), OD-WO-1/OD-WO-2, DD-WO-6 (no Sales Order push in v1),
  DD-RCPT-1 (mirror ERPNext's own document shape).
- **Spec:** `docs/specs/progress-billing.spec.md` (DD-PBL-1..11). **Plan:** `docs/plans/2026-10-06-progress-billing.md`.

## Context

A contract bills a down payment (DP) and then periodic quantity-based claims against a bill of quantities (BoQ).
Each claim must recover part of the DP so billed-to-date and remaining contract value are right, and in the
ledger the DP must sit in a customer-advance (liability) account until recovered — not in revenue. Today PMO has
no BoQ, claim or DP concept, a DP invoice counts as billed work and is never netted, and the first client's
accountant moved a DP invoice from sales to unearned revenue by hand at a half-year close.

The owner then ruled (2026-10-06): *"Progress claims by the project manager are not tied to invoicing. They
mainly capture a subjective assessment of project progress, operationally. An invoice needs more administrative
evidence that the work is done — reports etc."* So there are two acts with different owners and different
consequences: the PM's **assessment** of progress, and Finance's **billing** of it.

#765 already holds operational progress: `project_progress_entries`, one cumulative percent complete per
project per month, recorded by the project's PM or Finance rank and above, read by the management pack as
"recognised to date" (ADR-0076).

The first client bills its DP as a tax invoice; under Indonesian PPN rules the tax on a DP is due when invoiced,
and each later progress invoice is taxed on its value **minus** the DP already taxed.

ERPNext (v15 bench, v16 at the client) offers these stock mechanisms for the money:

1. **Advance Payment Entry + Sales Invoice `advances` allocation** ("Get Advances",
   `allocate_advances_automatically`, optionally "Book Advance Payments in Separate Party Account"). The DP is a
   *receipt*, not an invoice; an invoice later allocates part of it, reducing *outstanding* but not the invoice
   total or its tax base.
2. **Payment Entry against a Sales Order** — needs a Sales Order, which PMO does not push (DD-WO-6).
3. **Sales Invoice lines whose item maps to an account** — each line's `income_account` is server-derived from
   the item's Item Default for the company. A line on an item whose default "income" account is the
   customer-advance account posts there; a negative-rate line on the same item reverses it.

## Decision

1. **Assessment and billing are separate records.** A progress assessment never creates an invoice, an outbox
   command or an ERP write. A billing claim is the only path to an invoice.
2. **Assessment extends #765's record; it does not duplicate it.** An assessment is the
   `project_progress_entries` row for a project and month, optionally with per-BoQ-line quantities done to date
   in a child table (`progress_assessment_quantities`). When quantities are recorded, `pct_complete` is derived
   from them (BoQ-value-weighted, each line capped at its BoQ quantity), so every reader of #765's percent —
   the management pack first — sees quantity-measured progress unchanged. A month measured by quantities
   refuses a typed percent. Who may assess stays #765's rule (the project's PM, or Finance rank and above).
3. **The DP is a Sales Invoice with one line on the org's configured down-payment item**, whose ERPNext Item
   Default income account is the customer-advance (liability) account. ERP setup configures the item and
   account (DD-OPS-3); PMO stores the item code per org (`organizations.down_payment_item`, Admin, audited) and
   snapshots it onto each claim.
4. **Each billing claim is a Sales Invoice with its quantity lines plus one negative-rate line on the same
   down-payment item for the recovery.** ERPNext debits the advance account by the recovery, credits revenue with
   the gross value, and taxes the net — exactly the client's tax treatment. PMO sends no account.
5. **Rejected for the money:** advance Payment Entries with invoice allocation (cannot bill the DP as a tax
   invoice, leaves each claim's tax base gross, allocates up to the full outstanding rather than a per-claim
   percentage); a Sales Order (out of v1 and still option 1 underneath); a Journal Entry per claim (a new money
   command with its own SoD and reconciliation, for what option 3 does on the invoice already being raised).
6. **A billing claim IS its invoice's PMO record and needs evidence.** The claim id is the Sales Invoice's PMO
   record id, so the outbox's existing constraints give one claim at most one invoice. The server builds the
   invoice body from the claim alone on every resolution and refuses edit/amend. Evidence is one or more
   documents from the project's own register that are Issued or Approved (content frozen by the 2026-06-12
   rule) and carry a file; a cited document cannot be deleted. A database trigger on the outbox refuses to raise
   a claim that is withdrawn or has no evidence — the outbox insert precedes every ERP POST, so neither can mint.
7. **Recovery is computed once, in the database, under the project row lock**, when the claim is created.
8. **The claim's creator joins the invoice's author set**, so neither the person who set the quantities nor the
   person who raised the invoice can submit it.
9. **"Billed work" has one definition.** The `security_invoker` view `sales_invoice_work_billed` states, per
   invoice, whether it is a DP invoice and the recovery its claim removed. The billing summary and the
   management pack both read it. Assessed to date and "work done, not yet billed" are the pack's recognised-to-
   date and unbilled, computed with the pack's own helper.

## Consequences

- The ledger is right with stock ERPNext: no custom app, no new doctype command, no account in any PMO body.
- The PM's judgement and the invoice are visibly different numbers; the gap between them is the management pack's
  unbilled figure, now visible on the project itself.
- One table holds operational progress. #765's typed percent keeps working for projects without a BoQ.
- Correctness depends on ERP setup: a down-payment item mapped to a revenue account books DPs as revenue again.
  The e2e (AC-PB-003) checks the account; PMO cannot see it.
- ERPNext must accept a negative-rate line on a non-stock item and a liability account as an item's income
  account — verified on the local bench before build (plan Task 0); re-verify on a v16 bench before enabling.
- `project_progress_entries.pct_complete` remains directly writable (#765's grant); a direct write on a
  quantity-measured month would disagree with its quantities. Accepted: an assessment moves no money.
- Editing a claim invoice's lines in ERPNext Desk is legitimate (ADR-0055) but not reflected into the claim; the
  money figures follow the ERP invoice because they are read from its mirror.
- Retention cannot reuse the recovery mechanism: PPN is charged on the full progress value. It needs its own ADR.
- Reversal: dropping the PMO tables does not touch posted ERP documents.
