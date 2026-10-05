# Plan: Finance list customer labels, breadcrumbs, and locale dates

## Scope and design

Issue #781 is a bounded frontend/read-model correction. No schema, RLS, endpoint, hook, e2e, or ADR change is required.

### Root cause and data flow

- `listSalesInvoices` already makes one RLS-scoped, paged PostgREST request with the `companies` FK embedded for payment terms, but its select omits `companies.name` and its row flattener exposes no customer display value.
- Incoming-payment reads select `*`, so they neither embed nor flatten the customer. The existing migration's inline FK establishes the stable explicit PostgREST relation name `incoming_payments_customer_id_fkey`.
- The pages therefore render `customer_id`, including it in the export column, instead of a presentation-safe resolved name. Client-side search does not index the name.
- The shell classifies the three Finance paths as neither modules nor placeholders, so the unknown-route fallback produces `Not found`.
- The two lists bypass the shared short-month date seam with `formatDateOnlyNumeric`.

Keep name resolution in each existing list/single-record DAL query. This preserves one request per paged result set (no N+1 and no additional cached companies query), retains the DB/RLS scope, and still exposes a historical customer name when the customer is archived and absent from active company options. The DAL normalizes both embeds to nullable `customer_name`; pages display `—` for null and must not expose the opaque id in visible text or a title attribute. Existing DAL error propagation through `throwWrite`, paging, exports' raw ISO date values, and authorization behavior remain unchanged.

For localization, retain `PLACEHOLDER_TITLES` as the English fallback and add a small pathname-to-existing-i18n-key `Record` consumed by the placeholder branch. The `Breadcrumb` remains the sole translation boundary. Do not add catalogue keys: both shipped catalogues already contain the three `shell.nav.*` keys.

## Planned implementation file inventory

- `pmo-portal/src/lib/db/revenue.ts`
- `pmo-portal/src/lib/db/revenue.lists.test.ts`
- `pmo-portal/src/lib/db/revenue.test.ts`
- `pmo-portal/pages/SalesInvoices.tsx`
- `pmo-portal/pages/IncomingPayments.tsx`
- `pmo-portal/pages/__tests__/Finance.customerDisplay.test.tsx`
- `pmo-portal/pages/__tests__/SalesInvoices.dueDate.test.tsx`
- `pmo-portal/pages/__tests__/IncomingPayments.createForm.test.tsx`
- `pmo-portal/pages/__tests__/Revenue.exportAndCurrency.test.tsx`
- `pmo-portal/pages/__tests__/Revenue.exportNumeric.test.tsx`
- `pmo-portal/pages/__tests__/IncomingPayments.currency.test.tsx`
- `pmo-portal/src/components/shell/routeMatch.ts`
- `pmo-portal/src/components/shell/__tests__/breadcrumb.locale.test.tsx`

## Acceptance-test traceability

| Acceptance criterion | Owning layer and test | Supporting tests |
| --- | --- | --- |
| AC-FIN-001 | Unit/RTL: `pmo-portal/pages/__tests__/Finance.customerDisplay.test.tsx` — one AC-prefixed journey exercises both list pages' customer cell, customer-name search, and the actual Customer column export value. | DAL unit assertions in `pmo-portal/src/lib/db/revenue.lists.test.ts` and `pmo-portal/src/lib/db/revenue.test.ts` pin the projections and flattened values. |
| AC-FIN-002 | Unit/RTL + pure helper: `pmo-portal/src/components/shell/__tests__/breadcrumb.locale.test.tsx` — AC-prefixed Bahasa render cases and pure route-helper assertions for all three routes. | None. |
| AC-FIN-003 | Unit/RTL: `pmo-portal/pages/__tests__/Finance.customerDisplay.test.tsx` — AC-prefixed en-GB list rendering assertion for invoice date, due date, and payment date. | Existing date-format unit tests remain the seam proof. |

## Tasks

1. **Drive the sales-invoice read-model contract red, then expose the customer name.**  
   **Files:** `pmo-portal/src/lib/db/revenue.lists.test.ts`, `pmo-portal/src/lib/db/revenue.ts`  
   **AC:** AC-FIN-001 (supporting DAL proof)  
   - First extend the list-query mock fixture with `companies: { erp_payment_terms_days, name }` and add a failing DAL test that requires the captured sales-invoice select string to be exactly `*, companies!sales_invoices_customer_id_fkey(erp_payment_terms_days,name), sales_invoice_authors(user_id)` and requires the returned row to contain the embedded name as `customer_name` while preserving payment terms and author flattening.
   - Add `customer_name: string | null` to `SalesInvoiceRow`.
   - Change `SALES_INVOICE_SELECT` to request `name` in the existing explicit customer FK embed. In `toSalesInvoiceRow`, derive `customer_name` from `row.companies?.name`, defaulting to `null` for a missing relation, alongside the existing derived fields.
   - Keep the existing paged query, ordering, RLS-scoped Supabase client path, and error handling intact; do not query companies separately.
   - Verify: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/revenue.lists.test.ts`

2. **Drive incoming-payment list and single-read embedding red, then normalize both results.**  
   **Files:** `pmo-portal/src/lib/db/revenue.lists.test.ts`, `pmo-portal/src/lib/db/revenue.test.ts`, `pmo-portal/src/lib/db/revenue.ts`  
   **AC:** AC-FIN-001 (supporting DAL proof)  
   - First add failing list assertions in `revenue.lists.test.ts` that the incoming-payment query selects exactly `*, customer:companies!incoming_payments_customer_id_fkey(name)` and flattens `customer: { name }` to `customer_name`; update its query mock/fixtures accordingly.
   - Extend the focused DAL mock in `revenue.test.ts` to support the existing `.eq(...).maybeSingle()` chain, then add failing `getSalesInvoice` and `getIncomingPayment` coverage that pins their shared/customer-qualified projections and asserts each singular result flattens `customer_name` (including null relation → null name).
   - Add `customer_name: string | null` to `IncomingPaymentRow`; introduce a single incoming-payment projection constant with the exact explicit FK alias above and a `toIncomingPaymentRow` flattener. Use that projection and flattener in both `listIncomingPayments` branches and `getIncomingPayment`.
   - Use the default constraint name confirmed by `supabase/migrations/0123_sales_incoming_payments_flip.sql`; do not add a migration or change RLS.
   - Verify: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/revenue.lists.test.ts src/lib/db/revenue.test.ts`

3. **Keep all existing typed and mock list fixtures compatible with the new DAL contract.**  
   **Files:** `pmo-portal/pages/__tests__/SalesInvoices.dueDate.test.tsx`, `pmo-portal/pages/__tests__/IncomingPayments.createForm.test.tsx`, `pmo-portal/pages/__tests__/Revenue.exportAndCurrency.test.tsx`, `pmo-portal/pages/__tests__/Revenue.exportNumeric.test.tsx`, `pmo-portal/pages/__tests__/IncomingPayments.currency.test.tsx`  
   **AC:** AC-FIN-001 (fixture consistency)  
   - Add an explicit `customer_name` value or `null` to every Sales Invoice and Incoming Payment fixture that constructs one of the new row shapes, including the typed invoice factory and all export/currency fixtures.
   - Preserve each fixture's existing customer id, money, date, and assertion intent; this task changes no test oracle and no production behavior.
   - Verify: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/SalesInvoices.dueDate.test.tsx pages/__tests__/IncomingPayments.createForm.test.tsx pages/__tests__/Revenue.exportAndCurrency.test.tsx pages/__tests__/Revenue.exportNumeric.test.tsx pages/__tests__/IncomingPayments.currency.test.tsx`

4. **Write the Finance-list display/search/export test red, then replace opaque customer rendering on both pages.**  
   **Files:** `pmo-portal/pages/__tests__/Finance.customerDisplay.test.tsx`, `pmo-portal/pages/SalesInvoices.tsx`, `pmo-portal/pages/IncomingPayments.tsx`  
   **AC:** AC-FIN-001  
   - First create the page test beside the existing page tests. Mock only the list/mutation/FK/auth seams needed to render each real page under its existing router, toast, and impersonation providers. Seed two rows per page with distinct opaque UUID-like customer ids and company names.
   - Add one owning `it('AC-FIN-001: …')` journey that, for Sales Invoices and then Incoming Payments, proves: the relevant row shows its company name; the row text and customer cell title do not contain its `customer_id`; a case-insensitive fragment of that name retains only the matching row through the labelled search input; and the page's real Customer column `exportValue` returns the company name rather than the id. Keep this behavior-focused; do not snapshot or inspect DAL implementation details.
   - Replace each page's `customer_id` cell display and title with `customer_name`, falling back to `—` and an empty title when the name is null. Change each Customer `exportValue` to `customer_name ?? ''`.
   - Extend Sales Invoice filtering to case-insensitively match `customer_name` in addition to invoice number and reference number. Extend Incoming Payments filtering to match `customer_name` in addition to payment number. Do not change headers, status filters, raw ISO export date values, form customer ids, or mutation payloads.
   - Verify: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/Finance.customerDisplay.test.tsx`

5. **Write the locale-date render proof red, then route all displayed Finance dates through the shared formatter.**  
   **Files:** `pmo-portal/pages/__tests__/Finance.customerDisplay.test.tsx`, `pmo-portal/pages/SalesInvoices.tsx`, `pmo-portal/pages/IncomingPayments.tsx`  
   **AC:** AC-FIN-003  
   - First extend the new page test with an owning `it('AC-FIN-003: …')` that calls `setActiveLocale({ locale: 'en-GB', numberLocale: 'en-GB', timezone: 'UTC' })`, renders an invoice dated `2025-11-30` (with a deterministic due date) and a payment dated `2025-11-30`, and asserts displayed date cells equal `formatDateOnly('2025-11-30')` (`30 Nov 2025`) and never include `11/30/2025`. Reset the process-wide locale in `afterEach`.
   - Replace the `formatDateOnlyNumeric` import with `formatDateOnly` in both pages. Use it for Sales Invoice Date and derived Due Date, and for Incoming Payment Date.
   - Leave every date `exportValue` as the raw ISO/derived ISO string; no export value may call a formatter or `t()`.
   - Verify: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/Finance.customerDisplay.test.tsx pages/__tests__/SalesInvoices.dueDate.test.tsx`

6. **Write localized breadcrumb cases red, then register the three Finance placeholders and their existing keys.**  
   **Files:** `pmo-portal/src/components/shell/__tests__/breadcrumb.locale.test.tsx`, `pmo-portal/src/components/shell/routeMatch.ts`  
   **AC:** AC-FIN-002  
   - First extend the real-catalogue Bahasa test with an owning `it('AC-FIN-002: …')` table covering `/sales-invoices` → `Invoice Penjualan`, `/incoming-payments` → `Pembayaran Masuk`, and `/revenue-by-project` → `Pendapatan per Proyek`. In the same test, call `breadcrumbForPath` directly for all three paths and assert no returned part has label `Not found`.
   - Add those exact paths to `PLACEHOLDER_TITLES` with English fallback labels `Sales Invoices`, `Incoming Payments`, and `Revenue by Project`.
   - Replace the placeholder branch's nested pathname ternary with a local `Record<string, string>` mapping placeholder paths to i18n keys. Include the existing Administration/integrations keys and map the new paths to `shell.nav.salesInvoices`, `shell.nav.incomingPayments`, and `shell.nav.revenueByProject`; pass the resolved key to the returned breadcrumb part when one exists.
   - Do not add translation entries or promote these routes to `MODULES`, because their existing Finance rail labels already supply the required keys and this issue changes only breadcrumb resolution.
   - Verify: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/components/shell/__tests__/breadcrumb.locale.test.tsx`

7. **Run the required focused suite and local quality gate after all red-green work is complete.**  
   **Files:** no additional files  
   **AC:** AC-FIN-001, AC-FIN-002, AC-FIN-003  
   - From `pmo-portal/`, run the locked equivalents of the mandated typecheck and focused Vitest commands (the lock is required for shared-machine test isolation), then lint every implementation and test file listed in the inventory and run the i18n completeness guard.
   - Commands:
     ```bash
     cd pmo-portal
     ../scripts/with-test-lock.sh npm run typecheck
     npx eslint --max-warnings=0 src/lib/db/revenue.ts src/lib/db/revenue.lists.test.ts src/lib/db/revenue.test.ts pages/SalesInvoices.tsx pages/IncomingPayments.tsx pages/__tests__/Finance.customerDisplay.test.tsx pages/__tests__/SalesInvoices.dueDate.test.tsx pages/__tests__/IncomingPayments.createForm.test.tsx pages/__tests__/Revenue.exportAndCurrency.test.tsx pages/__tests__/Revenue.exportNumeric.test.tsx pages/__tests__/IncomingPayments.currency.test.tsx src/components/shell/routeMatch.ts src/components/shell/__tests__/breadcrumb.locale.test.tsx
     ../scripts/with-test-lock.sh npx vitest run src/lib/db/revenue.lists.test.ts src/lib/db/revenue.test.ts pages/__tests__/Finance.customerDisplay.test.tsx pages/__tests__/SalesInvoices.dueDate.test.tsx pages/__tests__/IncomingPayments.createForm.test.tsx pages/__tests__/Revenue.exportAndCurrency.test.tsx pages/__tests__/Revenue.exportNumeric.test.tsx pages/__tests__/IncomingPayments.currency.test.tsx src/components/shell/__tests__/breadcrumb.locale.test.tsx
     npm run check:i18n
     ```
   - Treat any red test, type error, lint warning, or i18n check failure as incomplete; fix production code rather than weakening/skipping a test.

## Completion notes

- No migration is planned: the FK constraints, RLS scope, and `org_id` seam already decide access; this is a read projection only.
- No cache or new hook is planned: the current React Query list cache receives the extended row shape through its existing repository/DAL seam.
- No ADR is warranted: explicit PostgREST FK embeds, shared list date formatting, and route placeholder localization are established patterns, not an architectural or irreversible decision.
