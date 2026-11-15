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
| Denomination | Figures are summed only within one invoice currency. Two or more currencies (or an invoice with no currency) give a **mixed** result that carries no amount. A reader asking for the figures in a currency gets them only when the result is denominated in exactly that currency; otherwise unknown. |
| Separate quantities | The module's **document total** (Σ `amount` as stated, with its tax-basis label), the server's **contract-normalised billing** (`contract_invoiced`, Contract tab Invoiced tile, unchanged) and **cash received** (`cash_received`, unchanged) stay separately named. Settlement is not cash. |
| Out of scope | The percentage of the contract shown beside Paid; the overdue figure; the server projection; any schema. |

## 3. Requirements (EARS)

- **FR-SET-001** The settlement rule shall count only invoices whose status is Submitted, Unpaid or Paid and that are not cancelled in the accounting system (`erp_docstatus` 2 or a recorded `erp_cancelled_at`).
- **FR-SET-002** When the counted invoices carry more than one currency, or any counted invoice has no currency, the settlement rule shall return a mixed result with no document total, gross, outstanding or settled amount.
- **FR-SET-003** When the counted invoices share one currency, the settlement rule shall state that currency with the document total, gross, outstanding and settled amounts.
- **FR-SET-004** The settlement rule shall compute gross, outstanding and settled on the gross basis of §2 for every invoice regardless of its tax treatment.
- **FR-SET-005** If any counted invoice lacks an amount, a tax treatment, or (for tax-exclusive) a tax amount, then the settlement rule shall leave gross and settled unknown.
- **FR-SET-006** If any counted invoice lacks an accounting balance, then the settlement rule shall leave outstanding and settled unknown and report balances as not known; it shall never substitute zero or the invoice status.
- **FR-SET-007** Where a caller renders settlement figures in a currency, the caller shall read them through the module's currency-checked accessor, which returns nothing unless the result is denominated in exactly that currency (no counted invoice reads as zero in any currency).
- **FR-SET-008** While the Contract tab's settlement is mixed or in a currency other than the project's, the Paid tile shall read unknown ("—"), not a project-currency amount.
- **FR-SET-009** While the Money position block's settlement is mixed or in another currency, its Invoiced and Paid figures shall be left out with a reason naming more than one currency.

## 4. Acceptance criteria

- **AC-SET-001** Given a project in IDR with one submitted IDR invoice and one submitted USD invoice, When the settlement is summarised, Then the result is mixed with both currencies and no amount, and the Contract tab Paid tile reads "—", the Money position block leaves Invoiced and Paid out, and a customer order holding both invoices shows no Invoiced / Paid / Unpaid figure.
- **AC-SET-002** Given two IDR invoices — one tax-exclusive (amount 1,000, tax 110, outstanding 1,110) and one tax-inclusive (amount 1,110, tax 110, outstanding 0) — When the settlement is summarised, Then gross is 2,220, outstanding 1,110 and settled 1,110 (the unpaid exclusive invoice reads as fully unpaid, not 110 negative), and each customer-order invoice row reads paid 0 / unpaid 1,110 and paid 1,110 / unpaid 0.
- **AC-SET-003** Given a Draft, a Cancelled and an accounting-cancelled invoice in another currency beside one counted IDR invoice, When the settlement is summarised, Then the excluded invoices neither add to any amount nor make the result mixed.
- **AC-SET-004** Given a counted invoice with no accounting balance, When the settlement is summarised, Then outstanding and settled are unknown and balances are not known, while the document total is still stated; and the Money position block's cash received remains its own figure from the receipt projection.
