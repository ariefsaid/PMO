# ADR-0103 — Retention is held on the receivable, not as an invoice line

- **Status:** Accepted (#1572, built with #2522). Owner may overrule OD-RET-1 (the base).
- **Date:** 2026-11-19
- **Related:** ADR-0077 (down payment as advance-item invoice lines; its consequences say retention needs its own ADR),
  DD-PBL-11 (VAT on the full progress value), `docs/specs/billing-stages.spec.md` (FR-RET-*), migration 0961.

## Context

A contractor's client holds back a share of each progress claim (retention, commonly 5%) until a later event — provisional
handover, the end of the defects period — and then releases it. The down-payment recovery (ADR-0077) is a negative invoice
line: the invoice's taxable value drops. Retention cannot work that way: VAT is charged on the full progress value
(DD-PBL-11), so a negative line would understate the tax base on every claim invoice, native or ERP.

## Decision

1. **The invoice stays whole.** A claim's invoice (native, 0924, or ERP, built by `dispatchRevenue.ts`) is unchanged: no
   retention line, VAT on the full value. Nothing in either invoice builder changes.
2. **Retention is a fact on the claim.** `progress_claims.retention_pct` and `retention_amount` are stamped once, by a
   BEFORE INSERT trigger, from the project's `retention_pct`: `round(gross × pct / 100, 2)`, capped at the claim's net
   (gross − down-payment recovery). The claim's existing immutability (0250 `assert_progress_claim_update`) keeps it fixed.
   Down-payment and time-and-materials claims hold none.
3. **Releases are records, not invoices.** `retention_releases` rows are scheduled (amount, due date) and then recorded
   released (date, client reference, proof document) by Finance/Admin, only on a submitted invoice. The scheduled-plus-
   released total never exceeds the claim's retention (checked under the claim row lock and again by a trigger); a recorded
   release never changes.
4. **What is due now** on a claim's invoice is the invoice total less the retention still held (`claim_retention.held`).
   The ledger stays the oracle for what was paid (ADR-0048); the retention view explains an open balance, it does not move
   money.

## Options considered

| Option | Verdict |
|---|---|
| Negative "retention" invoice line (as the DP recovery) | Rejected: understates the VAT base (DD-PBL-11). |
| A separate retention invoice at release | Rejected for v1: a second invoice for revenue already invoiced double-counts billed work in every reader of `sales_invoice_work_billed`. |
| Hold on the receivable (this ADR) | Accepted: no invoice or tax change, one source of truth per claim, reversible. |

## Consequences

- Billed work, left to bill and the management pack are unchanged: retention does not reduce billed revenue.
- A receivable report that wants "due now" subtracts `claim_retention.held`; ERPNext's outstanding amount still shows the
  full invoice until the client pays it. Matching a short payment to retention is a reading, not a posting.
- OD-RET-1: the base is the gross progress value before tax. If a contract states retention on the net after the
  down-payment recovery, change the stamp function's expression; existing claims keep their stamped amount.
- Reversal: the 0961 rollback refuses while any claim holds retention or any release exists.
