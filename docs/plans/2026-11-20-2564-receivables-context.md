# Plan: receivables row context (#2564)

1. Test first: `pmo-portal/pages/__tests__/SalesInvoices.context.test.tsx` (AC-RECV-CTX-001..004) - red.
2. `salesInvoiceColumns.tsx`: extract `projectManagerNameOf` and `deliveryLabelOf`, reuse in the client and delivery columns, add a context line to `mobileCardDetails`; return both helpers.
3. `SalesInvoicePanelDrawer.tsx`: add the Project manager and Delivery fields.
4. `SalesInvoices.tsx`: pass the helpers through.
5. Locale: add `finance:receivables.projectManager` (en, id). Existing delivery strings are reused.
6. Gates: check:guards, typecheck, eslint, vitest related.
