# Work order material completion (printable close-out document)

Lane 1124d, decision 2. IDs: `FR-WMC-###`, `AC-WMC-###`. Not a money path: a read-only report over existing stock ledger figures.

**Job story.** When a work order is ready to close, I want one printable page of the materials it used, so that I can attach it to the close-out item as its document.

## As is
`get_work_order_stock_balance` (1313) already derives, per item and location, what moved onto the site's stock, what moved off, what was issued (net of returns) and the on-site balance. The close-out checklist (`CloseoutSection`) takes a project document as each item's evidence. Nothing shows issued and returned apart, nor the counted difference, nor totals, in a form fit to print.

## Requirements (EARS)
- FR-WMC-001 The system shall provide one read, `get_work_order_material_completion(work order)`, returning per material: issued, returned, moved in, moved out, counted difference and balance, and totals per unit. It shall write nothing and add no table.
- FR-WMC-002 Moved in, moved out and balance shall come from the existing work-order balance read (`get_work_order_stock_balance`); issued, returned and the counted difference from the same ledger rows filtered to the work order. A work order with no movements returns no rows.
- FR-WMC-003 The read shall be open to whoever may read the work order in the organisation (the rule of the existing balance read) and refuse another organisation's work order.
- FR-WMC-004 While the caller lacks cost access (`stock_can_see_cost()`), the read shall carry no value field at all; with access it adds issued value, returned value, balance value and their totals.
- FR-WMC-005 The work order's Close-out group shall link to a printable page for the organisation's with stock module; the page shall print to PDF (header, table, totals, two signature blocks) so the PDF can be attached to the close-out item as its document through the existing project documents.
- FR-WMC-006 The page shall be read-only, in English and Bahasa Indonesia, and show an empty state instead of a row of zeros.

## Acceptance criteria (owning layer)
- AC-WMC-001 pgTAP `2101` and unit `WorkOrderMaterialCompletion.test.tsx`: the issued material is listed with its issued and returned figures; another work order shows none of them.
- AC-WMC-002 pgTAP `2101`: totals per unit add the rows.
- AC-WMC-003 pgTAP `2101` and unit: cost figures appear only with cost access.
- AC-WMC-004 pgTAP `2101` (mutation `mut:org`): another organisation cannot read it.
- AC-WMC-006 unit `src/lib/db/stockSiteWork.test.ts`: the read is mapped, quantities stay decimal strings.
- AC-WMC-007 unit `MaterialCompletionLink.test.tsx`: the Close-out group links to the page, and only for organisations with the stock module.

## Notes
A count difference appears only for count documents that carry the work order; counts are normally per location, so most work orders show zero there. Making counts attributable to a work order is a product decision, listed in `docs/briefs/decisions-1124/stock-open.md`.
