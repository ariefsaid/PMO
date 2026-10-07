# ADR-0082 — Vendor withholding: the bill keeps its gross amount, the tax withheld is its own column, and the feed refreshes bill money

- **Status:** Proposed (Director, 2026-10-07, #876)
- **Deciders:** Director (DD-VWH-1..9); owner frame OD-ERP-3 / OD-ERP-4
- **Supersedes in part:** DD-VI-3a (the blanket refusal of withholding purchase tax templates)
- **Related:** ADR-0048 (ERPNext is the accounting oracle), ADR-0055 (integration architecture), ADR-0058 (outbox),
  0196 (#505 vendor-invoice tax columns), 0232 / DD-RCPT-1 (#762 client withholding on receipts)

## Context

RIS withholds income tax (PPh 23, PPh 4(2)) from what it pays vendors. In ERPNext that is a Purchase Taxes and Charges
Template with a `Deduct` row: the Purchase Invoice books the expense at the net (pre-tax) total, input VAT on the `Add`
row, the withheld tax as a credit to a tax-payable (liability) account, and the vendor's creditor balance at the
**net payable** (`grand_total` = net + VAT − withheld). `outstanding_amount` therefore starts at the net payable, and a
payment of that net closes the bill.

PMO today cannot hold this:

- `procurement_invoices.amount` mirrors `grand_total` and `tax_amount` mirrors `total_taxes_and_charges` (0196).
  With a Deduct row, `grand_total` is the net payable and `total_taxes_and_charges` is VAT − withheld, which is
  negative for a PPh-only bill — refused by 0196's sign-parity rule, so the mirror write fails on every replay.
  DD-VI-3a therefore refuses every withholding template before the ERP write.
- OD-ERP-3 makes ERPNext headless for RIS: whatever an ERPNext screen would show about a bill (VAT, PPh withheld,
  net payable, paid) PMO must show. OD-ERP-4 puts vendor withholding in the go-live set and the tax registers (#898)
  in the first month-end.
- A mirrored bill's money and status are written only by its own dispatch. Nothing refreshes them when a payment
  settles the bill in ERPNext, so a bill never reaches **Paid** in PMO — the paid-detection FR-ENA-116 specified was
  never built on the PMO side.

## Decision

1. **Shape.** `procurement_invoices` gains `withheld_amount numeric(14,2) not null default 0`. `amount` stays the
   **gross** bill (net + VAT, the figure on the vendor's invoice), `tax_amount` stays **VAT only**, and the net payable
   is derived (`amount − withheld_amount`), never stored. A constraint keeps `withheld_amount` finite, sign-matched to
   `amount` and no larger than it. Not client-writable; the procurement mirror guard pins it.
2. **Read-back.** The mapper reads ERPNext's header field `taxes_and_charges_deducted` (a list-endpoint field — no
   child-table read): gross = `grand_total` + deducted, VAT = `total_taxes_and_charges` + deducted, withheld = deducted,
   `erp_outstanding_amount` = `outstanding_amount` verbatim. With deducted = 0 every figure is byte-identical to today.
   A payload that omits the field leaves withholding unknown (not written) rather than guessing 0.
3. **Paid.** A bill is Paid when ERPNext's outstanding is zero — i.e. when the net payable has been paid. The withheld
   tax is a liability to the tax office, never owed to the vendor.
4. **Feed refresh.** The inbound feed (sweep / webhook) refreshes a mirrored Purchase Invoice's money and derived status
   when, and only when, the change carries the whole money header (gross inputs, VAT, withheld, outstanding). This
   builds FR-ENA-116's paid-detection for every connected bill, withholding or not.
5. **Outbound.** A chosen template with Deduct rows is sent with its rows intact when well-formed (Deduct rows: rate
   0–100, category `Total`, not included in the item price, on a liability account; withholding rates sum below 100%;
   no negative rate anywhere). Anything else is refused before any ERP write.
6. **Cost stays gross.** Project cost and budget actuals never read `procurement_invoices`; they sum the GL mirror by
   mapped expense account, where the expense is debited at the net total and the withholding credits a liability.
   Nothing in PMO subtracts withholding from a cost, commitment or budget figure.

## Consequences

- One additive column, one constraint, a one-line guard edit (migration 0266, reversible). No RPC signature changes:
  PMO-native bills keep recording through `create_procurement_invoice` and get 0.
- `amount` deliberately departs from verbatim `grand_total` on a withholding bill. This is still ERP truth (two header
  figures ERPNext states, added in integer cents), the same move DD-RCPT-1 made for receipts. Consumers of `amount`
  (ledger, budget signal, import, agent read) keep meaning "the bill's gross total".
- Sales/purchase symmetry: both sides now hold the same three facts — gross, cash, withheld. Sales records them on the
  receipt (the client withholds when paying, #762); purchases on the bill (RIS withholds through the bill's template),
  because that is where ERPNext books each.
- The per-type split (PPh 23 vs PPh 4(2)) is not stored on the bill. The tax registers (#898) read it from the GL mirror
  per tax-payable account, the ledger being the oracle.
- A bill already mirrored before 0266 with deductions (an ERPNext default template) keeps its old figures until ERPNext
  next modifies it. Deploy precondition: count such bills on the target ERPNext and re-mirror any found.
- Operator rule: a PPh payable account must never be mapped into a budget category (it would net withholding against
  cost in actuals).

## Alternatives rejected

- **Signed `tax_amount` (VAT − withheld).** `tax_amount` would stop meaning VAT, the registers would have to split it
  back apart, and 0196's sign rule would have to be weakened for exactly the documents it protects.
- **`amount` = net payable (verbatim `grand_total`).** Every consumer of `amount` would silently change meaning on
  withholding bills only, and the gross the vendor actually invoiced would be unrecoverable from PMO.
- **Per-type columns (`pph23_amount`, `pph42_amount`).** The header does not carry the split; it would need a child
  read per bill and duplicate the GL mirror the registers already read.
- **Refreshing the bill from the payment dispatch (re-read the referenced bills after a payment submit).** Deterministic
  but covers only PMO-originated payments and needs an ERP client inside the read-model writers; the feed refresh
  covers every change. Kept as the fallback if the bench spike (plan Task 0) shows a payment does not bump the bill's
  `modified`.
