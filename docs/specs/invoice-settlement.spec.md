# Invoice settlement summary — issue #2204

> Scope: the shared invoice-settlement rule behind the Paid / Unpaid figures on the project Contract
> tab, the Overview Money position block and the customer-order billing figures. Parent critique: #2133.

## 1. Job story

When I read how much of a project's (or a customer order's) invoicing is settled, I want Paid and Unpaid
to be stated in the invoices' own currency on one comparable tax basis, so that a figure I read as
"IDR paid" never silently contains USD, and an invoice raised excluding tax never reads as part-paid
merely because its balance includes the tax.

## 2. Decisions

| Ruling | Decision |
|---|---|
| Owner of the rule | One module, `pmo-portal/src/lib/invoiceSettlement.ts`, owns which invoices count, the comparable basis and the denomination. Page components only read its result. |
| Comparable basis | The **gross** basis (tax included), the same rule the server finance projection (`get_project_finances`, migrations 0392 → 0791) already applies: gross = `amount` for a tax-inclusive invoice, `amount + tax_amount` for a tax-exclusive one; `erp_outstanding_amount` is already gross (what the client still owes); settled = gross − outstanding. |
| Figures that stand together | Wherever Invoiced, Paid and Unpaid are shown together, all three read gross and are labelled including tax, so Paid + Unpaid = Invoiced. A fully paid tax-exclusive invoice therefore never reads Paid above Invoiced. |
| Share of the contract | A Paid (or gross Invoiced) percentage or bar against the contract value is shown only when that contract value is also stated including tax. A BoQ-priced contract is priced excluding tax, so it never takes a gross share. The Money position's lead "% invoiced" reads the projection's contract-basis billing, like the Contract tab's Invoiced tile. |
| Project scope reads the projection | The Contract tab Paid tile and the Money position block read the projection's per-currency invoice bucket (`settled`, `outstanding`, `invoiced`, `tax_basis`). More than one bucket is mixed; a null `settled` is unknown; gross invoiced is `settled + outstanding`, or the stated total for an all-inclusive bucket. The row rule serves per-order and per-invoice figures. |
| Contract tab Paid | The Invoiced tile stays the projection's contract-basis billing (#2212). The neighbouring Paid tile states its own gross comparison: "of X invoiced, including tax". |
| Denomination | Figures are summed only within one invoice currency. Two or more currencies (or an invoice with no currency) give a **mixed** result that carries no amount. The same applies to the overdue callout. |
| Separate quantities | Gross invoiced and settled (this module), the server's **contract-normalised billing** (`contract_invoiced`) and **cash received** (`cash_received`) stay separately named. Settlement is not cash. Where the project's receipts may carry withholding, settled-but-unmatched cash is not reported, since withheld tax settles an invoice without being cash. |
| Out of scope | The server projection; any schema. |

## 3. Requirements (EARS)

- **FR-SET-001** The settlement rule shall count only invoices whose status is Submitted, Unpaid or Paid and that are not cancelled in the accounting system (`erp_docstatus` 2 or a recorded `erp_cancelled_at`).
- **FR-SET-002** When the counted invoices carry more than one currency, or any counted invoice has no currency, the settlement rule shall return a mixed result with no document total, gross, outstanding or settled amount.
- **FR-SET-003** When the counted invoices share one currency, the settlement rule shall state that currency with the document total, gross, outstanding and settled amounts.
- **FR-SET-004** The settlement rule shall compute gross, outstanding and settled on the gross basis of §2 for every invoice regardless of its tax treatment.
- **FR-SET-005** If any counted invoice lacks an amount, a tax treatment, or (for tax-exclusive) a tax amount, then the settlement rule shall leave gross and settled unknown.
- **FR-SET-006** If any counted invoice lacks an accounting balance, then the settlement rule shall leave outstanding and settled unknown and report balances as not known; it shall never substitute zero or the invoice status.
- **FR-SET-007** Where a caller renders settlement figures labelled in a currency, the module shall supply them only when every counted invoice is in exactly that currency, and shall supply no figures otherwise; with no counted invoice it shall supply zero.
- **FR-SET-008** While the Contract tab's settlement is mixed or in a currency other than the project's, the Paid tile shall read unknown ("—"), not a project-currency amount.
- **FR-SET-009** While the Money position block's settlement is mixed or in another currency, its Invoiced and Paid figures shall be left out with one reason saying the invoices are not all in the project currency.
- **FR-SET-010** The overdue callout shall add balances only within one currency; while overdue invoices span currencies it shall read unknown ("—").
- **FR-SET-011** While a customer order's invoices are in more than one currency, its Invoiced, Paid and Unpaid figures shall read "—" with that reason.
- **FR-SET-012** Where Invoiced, Paid and Unpaid stand together, each shall be on the gross basis; a share of the contract shall be shown only against a contract value stated including tax.

## 4. Acceptance criteria

- **AC-SET-001** Given a project in IDR with one submitted IDR invoice and one submitted USD invoice, When the settlement is summarised, Then the result is mixed with both currencies and no amount, and the Contract tab Paid tile reads "—", the Money position block leaves Invoiced and Paid out, and a customer order holding both invoices reads "—" for Invoiced, Paid and Unpaid with the currency reason.
- **AC-SET-002** Given two IDR invoices — one tax-exclusive (amount 1,000, tax 110, outstanding 1,110) and one tax-inclusive (amount 1,110, tax 110, outstanding 0) — When the settlement is summarised, Then gross is 2,220, outstanding 1,110 and settled 1,110 (the unpaid exclusive invoice reads as fully unpaid, not 110 negative), and each customer-order invoice row reads paid 0 / unpaid 1,110 and paid 1,110 / unpaid 0.
- **AC-SET-003** Given a Draft, a Cancelled and an accounting-cancelled invoice in another currency beside one counted IDR invoice, When the settlement is summarised, Then the excluded invoices neither add to any amount nor make the result mixed.
- **AC-SET-004** Given a counted invoice with no accounting balance, When the settlement is summarised, Then outstanding and settled are unknown and balances are not known, while the document total is still stated; and the Money position block's cash received remains its own figure from the receipt projection.
- **AC-SET-005** Given one tax-exclusive invoice of 1,000,000 with tax 110,000, fully paid, When the Contract tab, the Money position block and the customer-order card render, Then Paid reads 1,110,000 beside an Invoiced of 1,110,000 including tax (Unpaid 0), and no percentage above 100 appears.
- **AC-SET-006** Given two overdue invoices with balances in two currencies, When the Contract tab or a customer order renders its overdue callout, Then it reads "—" and no summed balance.
