# Plan — flipped org: the user chooses the ERPNext purchase tax template (#520)

Lane: money path (procurement → ERPNext Purchase Invoice). No migration: the template list is read live
from ERPNext and the choice travels in the dispatch command (outbox payload).

## Shape (mirrors #856 / DD-PBL-13 on the sales side)

- **Picker** — on a flipped org (`taxIsPmoAuthored() === false`) the vendor-invoice capture form
  (`pages/procurement/RecordCaptureForm.tsx`, the only VI create that dispatches to ERPNext) shows an
  optional "ERPNext tax template" select. First option "ERPNext default" (empty value) — the issue's stated
  fallback and today's behaviour. Options come from `external-items` (`purpose: 'purchase-tax-templates'`):
  enabled `Purchase Taxes and Charges Template`s of the binding's company.
- **Wire** — the choice rides the existing `CreateInvoiceInput.taxTemplate` through the staged confirm
  (`ProcurementDetails.tsx` `createVI`) into `repositories.procurement.createInvoice`, which forwards it as
  `taxTemplate` on the external dispatch only when one was chosen.
- **Server** — `dispatchFactory.resolvePurchaseInvoiceTaxes`: purchase-invoice + `create` + not a replay.
  Caller `taxes` always dropped. No template → nothing sent (unchanged). A template → `getDoc` it, refuse
  (`config-rejected`) unless it exists, is enabled, belongs to the binding company and has ≥1 row; every row
  must be `On Net Total` with an account and a finite rate (`category`/`add_deduct_tax` carried verbatim from
  the known values). Rows + the name are written onto the command record before the outbox snapshot, so the
  payload digest covers them and a sweep replay makes no ERPNext read. Non-create operations send none.
- **Body** — `piToBody` adds `taxes_and_charges` + `taxes` when the record carries rows.

## Tasks

1. Helper `erpPurchaseTaxRows.ts` (`listPurchaseTaxTemplates`, `resolvePurchaseTaxRows`) + `piToBody` +
   dispatch wiring. Test `purchaseInvoiceTaxTemplate.test.ts` (AC-520-1..6) red first.
   `npx vitest run src/lib/adapterSeam/erpnext/purchaseInvoiceTaxTemplate.test.ts`
2. `external-items` purpose `purchase-tax-templates` + deno test in `items.test.ts` (shipped handler,
   mocked `globalThis.fetch`) (AC-520-7).
3. Repository forward + `listPurchaseTaxTemplates` + hook + form select + staged confirm; tests
   `index.test.ts` (AC-520-8) and `RecordCaptureForm` test (AC-520-9); i18n en + id.
4. DD line in `docs/decisions.md`; mutation-check the template-ownership refusal.

## Acceptance

- AC-520-1 chosen template → body carries `taxes_and_charges` + explicit rows from that template.
- AC-520-2 no template chosen → no `taxes`/`taxes_and_charges`, no template read (unchanged).
- AC-520-3 a template of another company, disabled, missing, or with no rows → `config-rejected`, no ERP write.
- AC-520-4 caller-supplied `taxes` are dropped.
- AC-520-5 a non-`On Net Total` row is refused before any write.
- AC-520-6 replay keeps persisted rows: no ERPNext read, same digest.
- AC-520-7 `external-items` lists the binding company's enabled purchase templates.
- AC-520-8 the repository forwards `taxTemplate` on the external dispatch only when chosen.
- AC-520-9 the flipped-org VI form offers the templates and stages the chosen one.
