# Spec amendment — vendor withholding (PPh 23 / PPh 4(2)) on ERPNext-owned procurement (#876)

> **Amends** `docs/specs/erpnext-adapter.spec.md` §5.10 FR-ENA-115 (Purchase Invoice mirror) and FR-ENA-116 (the PI
> paid-detection it specified), and supersedes DD-VI-3a in part (`docs/plans/2026-10-06-purchase-tax-template.md`
> AC-520-11). Owner frame: OD-ERP-3 (ERPNext is headless for RIS — what an ERPNext screen would show is a PMO gap) and
> OD-ERP-4 (vendor withholding is a go-live item; tax registers #898 follow at the first month-end).
> Architecture: ADR-0082. Plan: `docs/plans/2026-10-07-vendor-withholding.md`. Migration slot: **0266**.

## 0. Job story

When RIS records a vendor bill on which it must withhold PPh (e.g. 2% PPh 23 on services), I want to pick the
template that withholds it and see, on the bill, the VAT, the tax withheld and what I actually owe the vendor, so that
I pay the vendor the net, the bill closes as paid, and the withheld tax is ready for the monthly tax return — without
anyone opening ERPNext.

## 1. Scope

**In:** ERPNext-owned (flipped) procurement only — the vendor-invoice create that dispatches to ERPNext with a chosen
Purchase Taxes and Charges Template (#520), the Purchase Invoice mirror, the inbound feed refresh of a mirrored bill,
the procurement ledger display, and the sales-side symmetry guard.

**Out (explicit):**
- Withholding on PMO-native (standalone) vendor invoices — they record zero; capture is not offered.
- The bukti potong (e-Bupot) number for vendor withholding — the tax registers (#898) own it.
- The per-type split (PPh 23 vs PPh 4(2)) on the bill — #898 reads it from the GL mirror per tax-payable account.
- Paying a vendor from the PMO ledger on a flipped org (OBS-VWH-002) — not wired today; separate issue.
- A pre-submit preview of the net payable (ERPNext computes it; PMO shows it once mirrored, ADR-0048).

## 2. Decisions (Director, 2026-10-07 — DD lines, revisable by the owner)

- **DD-VWH-1 — shape.** `procurement_invoices.withheld_amount numeric(14,2) not null default 0`. `amount` stays the
  gross bill (net + VAT), `tax_amount` stays VAT only, net payable = `amount − withheld_amount` (derived, never stored).
  Constraint: finite; zero, or the same sign as `amount` and no larger in magnitude. Rejected: a signed tax figure
  (VAT − withheld) and `amount` = net payable (ADR-0082 §Alternatives).
- **DD-VWH-2 — read-back.** From the ERPNext header only: gross = `grand_total` + `taxes_and_charges_deducted`,
  VAT = `total_taxes_and_charges` + `taxes_and_charges_deducted`, withheld = `taxes_and_charges_deducted`,
  outstanding = `outstanding_amount` verbatim; integer-cents addition. Deducted = 0 ⇒ byte-identical to today. A payload
  without `taxes_and_charges_deducted` leaves withholding unknown: today's figures, `withheld_amount` not written.
- **DD-VWH-3 — paid.** A bill is Paid when ERPNext's outstanding is zero, i.e. the net payable has been paid. Withheld
  tax is owed to the tax office, not the vendor; paying the gross is refused by ERPNext (allocation above outstanding).
- **DD-VWH-4 — what is refused.** DD-VI-3a is lifted for well-formed withholding templates. Refused before any ERP write
  (`config-rejected`, naming the template only — never the company or account): any negative rate (a negative Add row
  is disguised withholding ERPNext would not count as deducted); any rate above 100%; a Deduct row whose category is not
  `Total`; a Deduct row included in the item price; a Deduct row whose account is not a Liability; Deduct rates summing
  to 100% or more. A PPh-only template (Deduct rows, no VAT) is well-formed.
- **DD-VWH-5 — feed refresh (FR-ENA-116 built).** A mirrored Purchase Invoice's money and derived status refresh from
  any inbound change that carries the whole money header; a change missing any part of it writes none of it. This is
  what makes a bill reach Paid in PMO after a payment, withholding or not.
- **DD-VWH-6 — display.** A vendor invoice with tax withheld shows, under its amount in the procurement ledger, three
  labelled figures in the bill's currency: VAT, Tax withheld (PPh), Net payable. A bill with nothing withheld renders
  exactly as today.
- **DD-VWH-7 — the column default.** `default 0` is a fact for every writer except the ERP mirror (PMO-native bills
  never withhold); the mirror writer states the value on every create and never relies on the default (unit-tested and
  mutation-checked). Contrast 0196's no-default rule: there an omitted value was ambiguous for every writer.
- **DD-VWH-8 — cost stays gross.** No cost, actual, commitment or budget figure is reduced by withholding. Actuals sum
  the GL mirror by mapped expense account (debited at the net total); the withholding credits a liability. Operator
  rule: never map a PPh payable account into a budget category.
- **DD-VWH-9 — sales symmetry.** Client withholding stays on the receipt (#762, DD-RCPT-1). The sales tax-row helper
  gains the same negative-rate refusal, so a misconfigured sales template cannot land an invoice whose mirror the
  database then refuses.

## 3. Requirements (EARS)

- **FR-VWH-001 (ubiquitous)** — The vendor-invoice mirror shall record for each ERPNext-owned Purchase Invoice its gross
  amount, its VAT and its tax withheld per DD-VWH-2, in the bill's currency.
- **FR-VWH-002 (event)** — When a user records a vendor invoice on a flipped org with a chosen purchase tax template
  that has Deduct rows, the system shall send all of the template's rows — Add and Deduct — to ERPNext with every field
  ERPNext computes them from, provided the template is well-formed (DD-VWH-4).
- **FR-VWH-003 (unwanted)** — If the chosen template is malformed withholding (DD-VWH-4), then the system shall refuse
  the create with `config-rejected` before any ERPNext write, naming the template and the reason, never the company or
  an account.
- **FR-VWH-004 (state)** — While a vendor invoice carries tax withheld, the system shall show it Paid exactly when
  ERPNext's outstanding amount for it is zero.
- **FR-VWH-005 (event)** — When ERPNext reports a change to a mirrored Purchase Invoice that carries its whole money
  header, the system shall refresh the bill's gross, VAT, withheld, outstanding and derived status; when the change
  lacks any of them, the system shall leave all of them unchanged.
- **FR-VWH-006 (ubiquitous)** — The system shall not reduce any project cost, actual, commitment or budget figure by
  tax withheld.
- **FR-VWH-007 (state)** — While a vendor invoice carries tax withheld, the procurement ledger shall show its VAT, its
  tax withheld (PPh) and its net payable, each labelled, in the bill's currency.
- **FR-VWH-008 (ubiquitous)** — `withheld_amount` shall not be client-insertable or -updatable, shall be pinned by the
  procurement mirror guard while procurement is externally owned, and shall be zero on PMO-native vendor invoices.
- **FR-VWH-009 (unwanted)** — If the default sales tax template has a row with a negative rate, then the system shall
  refuse the sales-invoice dispatch with `config-rejected` before any ERPNext write.
- **NFR-VWH-001** — The sweep reads no ERPNext child tables for this; the outbound create adds one Account read per
  Deduct row, on create only (replays read nothing, AC-520-6 unchanged).
- **NFR-VWH-002** — All money arithmetic is in integer cents (mapper and display).
- **OBS-VWH-001** — Before this change a mirrored bill's status and outstanding were written only by its own dispatch;
  a bill paid in ERPNext never showed Paid in PMO (AC-ENA-053's own note).
- **OBS-VWH-002** — The ledger's vendor-payment capture on a flipped org sends `amount` and `invoiceId`; the Payment
  Entry body reads `paid_amount`, `references` and a supplier, which that path never supplies. Out of scope here.

## 4. Acceptance criteria (Given/When/Then)

- **AC-VWH-001** — Given an enabled template of the binding's company with PPN 11% (Add) and PPh 23 2% (Deduct, on a
  liability account), when a user records a vendor invoice choosing it, then the ERPNext body carries the template name
  and both rows verbatim, the Deduct row as `add_deduct_tax: 'Deduct'`, `category: 'Total'`, `included_in_print_rate: 0`.
- **AC-VWH-002** — Given a PPh-only template (one Deduct row, no VAT row), when chosen, then it is sent, not refused.
- **AC-VWH-003** — Given a template that is malformed withholding (each DD-VWH-4 case), when chosen, then the create is
  refused `config-rejected`, the message names the template and neither the company nor the account, and nothing is
  written to ERPNext.
- **AC-VWH-004** — Given an ERPNext Purchase Invoice header with `taxes_and_charges_deducted`, when it is mapped, then
  gross, VAT and withheld follow DD-VWH-2 (including a PPh-only bill → VAT 0, and a return → all negative); without
  that field, withheld is absent and the header is verbatim; the sweep's field list requests it.
- **AC-VWH-005** — Given the local ERPNext bench (company currency IDR) and a flipped org whose currency is IDR, when a
  vendor invoice of IDR 1,000,000 is recorded with the PPN 11% + PPh 23 2% template, then ERPNext holds grand total
  1,090,000 with 20,000 deducted, its GL debits the item at 1,000,000 (cost gross of withholding) and credits 20,000 to
  the PPh account, and PMO's bill shows amount 1,110,000, VAT 110,000, withheld 20,000, outstanding 1,090,000, Received;
  when a payment of 1,090,000 referencing the bill is submitted and the sweep runs, then ERPNext shows the bill Paid with
  nothing outstanding and PMO's bill is Paid, outstanding 0, with its gross, VAT and withheld unchanged.
- **AC-VWH-006** — Given a created bill canonical, when the dispatch writer mirrors it, then the insert states
  `withheld_amount` (the canonical's, or `0.00` when it carries none) and an update omits it when the canonical has none.
- **AC-VWH-007** — Given a mirrored bill, when a feed change carries the whole money header, then gross, VAT, withheld,
  outstanding, `tax_treatment` and status are refreshed (outstanding 0 ⇒ Paid); when a part is missing, none are
  written; a non-invoice kind never gets these fields.
- **AC-VWH-008** — Given the 0266 schema, then `withheld_amount` is `numeric(14,2)`, not null, default 0; a withholding
  round-trips; NaN, a negative on a positive bill, more than the gross, withholding with no amount, and a positive on a
  negative bill are refused; a return's negative withholding is accepted.
- **AC-VWH-009** — Given the 0266 schema, then neither `authenticated` nor `anon` can insert or update
  `withheld_amount`, it is readable exactly where `amount` is, a PMO-native invoice records 0, the mirror guard refuses
  a client change while procurement is externally owned, and a service-role write passes.
- **AC-VWH-010** — Given gross, VAT and withheld figures, when the display figures are computed, then net payable =
  gross − withheld in exact cents; nothing is shown when nothing was withheld or a figure is unknown.
- **AC-VWH-011** — Given a vendor invoice row with `tax_amount` and `withheld_amount`, when ledger rows are built, then
  the Invoice row carries both; rows without them are unchanged.
- **AC-VWH-012** — Given a ledger Invoice row with tax withheld, when rendered, then VAT, "Tax withheld (PPh)" and
  "Net payable" are shown, labelled, in the row's currency; a row with nothing withheld shows no breakdown.
- **AC-VWH-013** — Given a default sales tax template with a negative-rate row, when its rows are resolved, then the
  dispatch is refused `config-rejected` before any ERPNext write.

## 5. Traceability (owning layer, ADR-0010)

| AC | Requirement | Layer | Owning test |
|---|---|---|---|
| AC-VWH-001 | FR-VWH-002 | unit (Vitest) | `pmo-portal/src/lib/adapterSeam/erpnext/purchaseInvoiceTaxTemplate.test.ts` |
| AC-VWH-002 | FR-VWH-002 | unit (Vitest) | same |
| AC-VWH-003 | FR-VWH-003 | unit (Vitest) | same |
| AC-VWH-004 | FR-VWH-001 | unit (Vitest) | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` |
| AC-VWH-005 | FR-VWH-001/002/004/005/006 | served e2e (bench) | `pmo-portal/e2e/serial/AC-VWH-005-vendor-withholding.spec.ts` |
| AC-VWH-006 | FR-VWH-001 | unit (Deno) | `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts` |
| AC-VWH-007 | FR-VWH-004/005 | unit (Deno) | `supabase/functions/_shared/erpnextFeedDeps.test.ts` |
| AC-VWH-008 | FR-VWH-001 | pgTAP | `supabase/tests/0266_vendor_withholding.test.sql` |
| AC-VWH-009 | FR-VWH-008 | pgTAP | same |
| AC-VWH-010 | FR-VWH-007, NFR-VWH-002 | unit (Vitest) | `pmo-portal/src/lib/vendorWithholding.test.ts` |
| AC-VWH-011 | FR-VWH-007 | unit (Vitest) | `pmo-portal/src/lib/db/procurementLedger.test.ts` |
| AC-VWH-012 | FR-VWH-007 | unit (RTL) | `pmo-portal/pages/procurement/ProcurementLedger.test.tsx` |
| AC-VWH-013 | FR-VWH-009 | unit (Vitest) | `pmo-portal/src/lib/adapterSeam/erpnext/erpSalesTaxRows.test.ts` |

AC-520-11 (refuse every withholding template) is **retired** by DD-VWH-4; its test is replaced by AC-VWH-001..003.

## 6. Open questions (parked with defaults)

- **OQ-VWH-1 (owner/accountant)** — Does RIS's ERPNext round bill totals (rounded total on)? *Default:* PMO shows
  ERPNext's grand total as the net payable; a rounding difference under one rupiah against the outstanding is accepted.
- **OQ-VWH-2 (owner/accountant)** — The withholding templates RIS needs (PPh 23 2%, the PPh 4(2) rates by service
  type) and the PPh payable accounts. *Default:* the operator creates them in RIS's ERPNext from the accountant's list
  before go-live (OD-ERP-4: ERP setup is operator work).
- **OQ-VWH-3 (owner)** — Capture the bukti potong number per bill now? *Default:* no; #898 (tax registers) owns it.
