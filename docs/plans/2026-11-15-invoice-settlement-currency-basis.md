# Plan: invoice settlement keeps currency and gross basis (#2204)

Spec: `docs/specs/invoice-settlement.spec.md`. One module (`pmo-portal/src/lib/invoiceSettlement.ts`) owns the rule; the Contract tab, the Money position block and the customer-order card read its result.

## Scope kept to the ticket

Kept beyond the bare helper, each because the fix cannot read right without it:
- Money position **Invoiced** reads gross (own test: `ProjectPosition.test.tsx` "a fully paid tax-exclusive invoice reads Paid equal to Invoiced, both including tax"). Why: Paid is now gross, so Invoiced beside it must be too or Paid reads above it.
- Contract tab **Paid** names the gross invoiced it is a part of (own test: `ContractCascade.orderless.test.tsx` "a fully paid tax-exclusive invoice names the gross invoiced its Paid is a part of"). Why: the neighbouring Invoiced tile stays contract-basis billing (#2212), so without it Paid can read above Invoiced.

Left as before the fix: "% invoiced" (document total over contract value), Paid % (shown whenever Paid is known), the "settled, no receipt matched" note, and a Paid invoice reading Unpaid 0.

## Traceability (one owning test per AC)

| AC | Owning test (file : title) |
|---|---|
| AC-SET-001 | `pmo-portal/src/lib/invoiceSettlement.test.ts` : AC-SET-001 never adds two submitted invoice currencies into one amount |
| AC-SET-002 | `pmo-portal/src/lib/invoiceSettlement.test.ts` : AC-SET-002 tax-exclusive and tax-inclusive invoices settle on one gross basis, paid + unpaid = invoiced |
| AC-SET-003 | `pmo-portal/src/lib/invoiceSettlement.test.ts` : AC-SET-003 drafts, cancelled and accounting-cancelled invoices are excluded entirely |
| AC-SET-004 | `pmo-portal/src/lib/invoiceSettlement.test.ts` : AC-1402 AC-SET-004 an unknown balance leaves settled and outstanding unknown, never partial or zero |
| AC-SET-005 | `pmo-portal/src/lib/invoiceSettlement.test.ts` : AC-SET-005 a fully paid tax-exclusive invoice never reads paid above what it invoiced |
| AC-SET-006 | `pmo-portal/src/lib/invoiceSettlement.test.ts` : AC-SET-006 never adds overdue balances in two currencies |

Mounted-caller tests (titled `#2204 …`, no AC id) bind each caller to the rule: `ContractCascade.orderless.test.tsx`, `ProjectPosition.test.tsx`, `WorkOrdersTab.billing.test.tsx`.
