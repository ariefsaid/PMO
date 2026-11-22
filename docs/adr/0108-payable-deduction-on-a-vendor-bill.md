# ADR-0108 — A backcharge is a payable deduction on the vendor bill, not part of its amount

- **Status:** Accepted as the built default of OD-SPC-5 (#2584); the owner may overrule it.
- **Date:** 2026-11-20
- **Related:** `docs/specs/subcontractor-progress-certificate.spec.md` (FR-SPC-015, OD-SPC-5), the shipped subcontract bill capture
  (`0472`, FR-SCA-023), the payment ceiling (`0793` `create_payment`), the work-order cost read (`0999`), migrations 1137.

## Context

A subcontractor progress certificate certifies measured work at agreed rates (the gross) and takes off backcharges the organisation
is owed (rework, damage, materials it supplied). The vendor bill that results must still state its BoQ lines, and the shipped
capture requires the bill's pre-tax amount to equal those lines. So the backcharge cannot be subtracted inside the bill's amount,
and it cannot be a tax withholding (a different legal figure on a different slip).

## Decision

1. **The deduction is its own field.** `procurement_invoices.deduction_amount numeric(14,2) not null default 0`, written only by
   `bill_subcontract_certificate` (a guard trigger refuses any other writer and any later change), beside `certificate_id`.
   The bill's amount stays the gross, equal to its lines, at no more than the PO rate (the cap and the rate check are unchanged).
2. **The payable falls by it.** One trigger on `payments` (`guard_payment_net_of_deduction`) refuses a live payment that would take
   the purchase's live payments above its live bills' payable, the sum of (amount + exclusive tax − deduction) in the purchase's
   currency. One seam covers `create_payment`, the Paid transition and imports. The shipped gross ceiling stays and only tightens.
3. **Cost on the work order is net, with no reader rewritten.** The work-order cost read (`0999`) is payment based: it spreads
   what was paid over the bill's pre-tax amount. With payments capped at the net, a fully paid certificate bill reads as its net.
   Project totals, which read the gross bill amount, are NOT changed here (see Consequences).
4. **Standalone only.** An organisation connected to an ERP is refused a certificate with backcharges until the ERP route (#1505)
   carries the deduction. A voided bill returns its certificate to `approved` through an after-update trigger that can never block
   the void.

## Options considered

| Option | Verdict |
|---|---|
| Subtract inside the bill's amount | Rejected: breaks FR-SCA-023 (amount equals lines) and the PO-rate check. |
| Reuse the tax withholding field | Rejected: corrupts withholding slips. |
| A negative bill line | Rejected: the shipped bill allows one positive line per item. |
| Ignore it (pay gross) | Rejected: overpays the vendor by the backcharge. |
| A deduction field plus one payment seam (this ADR) | Accepted. |

## Consequences

- **Reader inventory (the OD-SPC-5 condition).** Readers of bill amounts that do NOT subtract the deduction: project finance
  totals and the committed/open-commitment readers (they show gross billed), the void routine's remaining-bills check, the
  Paid transition's one-payment shortcut. The payments seam makes the money safe regardless: a Paid transition for a purchase
  with a deduction is refused with a clear message until payments are recorded at the net (the transition only converts existing
  Scheduled payments and inserts a gross payment only when none exist). Subtracting the deduction in those readers is the
  follow-up the owner decides (OD-SPC-5, "project totals follow only after the reader inventory").
- A credit note remains unmodelled; a certificate whose backcharges exceed its gross is refused (OD-SPC-8).
