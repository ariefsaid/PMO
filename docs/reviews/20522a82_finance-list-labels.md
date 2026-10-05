# Issue #781 — Finance list customer labels, breadcrumbs, and locale dates

## What changed and why it matters

Three frontend/read-model corrections to the Finance lists (`/sales-invoices`,
`/incoming-payments`, `/revenue-by-project`), shipped as a bounded slice with no schema, RLS,
endpoint, hook, e2e, or ADR change:

1. **The Customer column showed the internal `customer_id` UUID instead of the company name.**
   `SalesInvoices.tsx` and `IncomingPayments.tsx` rendered the raw id in the cell, the cell `title`,
   and the export column, and the client-side search only matched invoice/payment numbers. Both lists
   now resolve the customer's company name in the *same* DB read and display, search, and export the
   **name** — never the opaque id.
2. **The breadcrumb read "Not found"** on those three routes. `breadcrumbForPath` had no entry for
   them and fell through to the unknown-route fallback. They now resolve to their own titles and
   localized labels (reusing the existing Finance rail i18n keys).
3. **Dates rendered US-style numeric** (`11/30/2025`) via `formatDateOnlyNumeric`. Both lists now use
   the shared short-month locale-aware `formatDateOnly` (e.g. `30 Nov 2025` under `en-GB`), matching
   the rest of the app.

## Files that carry it

**Name resolution in the DAL — `pmo-portal/src/lib/db/revenue.ts`**
- `SalesInvoiceRow` gained `customer_name: string | null`.
- `SALES_INVOICE_SELECT` now requests `name` inside the existing explicit customer FK embed
  (`companies!sales_invoices_customer_id_fkey(erp_payment_terms_days,name)`); `toSalesInvoiceRow`
  flattens it to `customer_name` (null when the relation is missing).
- `IncomingPaymentRow` gained `customer_name: string | null`.
- A new shared projection `INCOMING_PAYMENT_SELECT =
  '*, customer:companies!incoming_payments_customer_id_fkey(name)'` and a `toIncomingPaymentRow`
  flattener are used by both `listIncomingPayments` branches and `getIncomingPayment`. The embed is
  explicit-FK qualified (matching `projects.ts`) because PostgREST embeds break when a table gains a
  second FK to the same target; the inline `references` in migration `0123` yields that default
  constraint name.
- All existing error propagation (`throwWrite`), paging, ordering, and the RLS-scoped caller are
  unchanged. The name is resolved in the one paged query — no N+1, no extra `useCompanies()` request,
  and the name survives for archived customers (the company-options list hides archived rows).

**Pages — `pmo-portal/pages/SalesInvoices.tsx`, `pmo-portal/pages/IncomingPayments.tsx`**
- Customer cell renders `customer_name` (falls back to `—`; empty `title`) and `exportValue` is
  `customer_name ?? ''`. The UUID never appears in visible text or a title.
- Search now also matches `customer_name` case-insensitively (in addition to `si_number` /
  `reference_number` on invoices and `ip_number` on payments).
- Column keys are unchanged; the header stays "Customer".
- Imported `formatDateOnly` in place of `formatDateOnlyNumeric` for the displayed Date / Due Date
  cells. Date **export** values stay raw ISO (no export value passes through a formatter).
- Mutations/payloads/status filters/form customer ids are untouched.

**Breadcrumbs — `pmo-portal/src/components/shell/routeMatch.ts`**
- `PLACEHOLDER_TITLES` gained `/sales-invoices`, `/incoming-payments`, `/revenue-by-project` with
  English fallback labels.
- The placeholder branch's nested ternary was replaced by a `PLACEHOLDER_I18N_KEY: Record<string,
  string>` mapping route → existing key (`shell.nav.salesInvoices`, `shell.nav.incomingPayments`,
  `shell.nav.revenueByProject`, plus the existing Administration/Integrations keys). No catalogue
  entries were added — the keys and Bahasa translations already shipped for the rail.

**Tests** (see below, under "How to verify").

## How to use / verify it

The behaviour is covered by new AC-prefixed tests plus existing suites extended for the new row
shape:

- **AC-FIN-001** — `pmo-portal/pages/__tests__/Finance.customerDisplay.test.tsx` (a new file, the
  owning journey): for both lists it asserts the cell shows the company name and the UUID text
  appears nowhere in the row, typing a case-insensitive fragment of the name retains only the
  matching row, and the real exported Customer cell value is the name (the actual click → export →
  workbook path is parsed back with exceljs). A separate case covers the null-name row rendering
  `—` and never the id. Supporting DAL proofs live in
  `pmo-portal/src/lib/db/revenue.lists.test.ts` (pins the two list projections and flattening,
  including null-relation → null) and `pmo-portal/src/lib/db/revenue.test.ts` (pins the singular
  `getSalesInvoice` / `getIncomingPayment` projections and flattening).
- **AC-FIN-002** — `pmo-portal/src/components/shell/__tests__/breadcrumb.locale.test.tsx` adds the
  three routes: each renders its Bahasa rail label under the real `id` catalogue, and a pure
  `breadcrumbForPath` assertion confirms none returns a `Not found` part.
- **AC-FIN-003** — `Finance.customerDisplay.test.tsx` sets the active locale to `en-GB` and asserts an
  invoice dated `2025-11-30` renders as `formatDateOnly('2025-11-30')` (`30 Nov 2025`, and the derived
  due date), never `11/30/2025`. `SalesInvoices.dueDate.test.tsx` was updated to assert the shared
  formatter output instead of a numeric pattern.
- Fixtures across `SalesInvoices.dueDate`, `IncomingPayments.createForm`, `IncomingPayments.currency`,
  `Revenue.exportAndCurrency`, and `Revenue.exportNumeric` gained `customer_name` to satisfy the new
  typed row shape; none of their assertions changed.

### Local gate (from `pmo-portal/`)

```
../scripts/with-test-lock.sh npm run typecheck
npx eslint --max-warnings=0 src/lib/db/revenue.ts src/lib/db/revenue.lists.test.ts src/lib/db/revenue.test.ts pages/SalesInvoices.tsx pages/IncomingPayments.tsx pages/__tests__/Finance.customerDisplay.test.tsx pages/__tests__/SalesInvoices.dueDate.test.tsx pages/__tests__/IncomingPayments.createForm.test.tsx pages/__tests__/Revenue.exportAndCurrency.test.tsx pages/__tests__/Revenue.exportNumeric.test.tsx pages/__tests__/IncomingPayments.currency.test.tsx src/components/shell/routeMatch.ts src/components/shell/__tests__/breadcrumb.locale.test.tsx
../scripts/with-test-lock.sh npx vitest run src/lib/db/revenue.lists.test.ts src/lib/db/revenue.test.ts pages/__tests__/Finance.customerDisplay.test.tsx pages/__tests__/SalesInvoices.dueDate.test.tsx pages/__tests__/IncomingPayments.createForm.test.tsx pages/__tests__/Revenue.exportAndCurrency.test.tsx pages/__tests__/Revenue.exportNumeric.test.tsx pages/__tests__/IncomingPayments.currency.test.tsx src/components/shell/__tests__/breadcrumb.locale.test.tsx
npm run check:i18n
```

## Out of scope / not changed

No migration, no RLS change, no new hook or endpoint, no e2e spec, and nothing under `adws/`. No
translation keys were added. `SalesInvoiceRow` / `IncomingPaymentRow` consumers (agent tools,
project-detail revenue tab) were covered by the typecheck; any fixture building these rows now carries
`customer_name`.