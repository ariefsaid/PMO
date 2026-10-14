# Issue #991 — Sales invoice record follow-ups

## Scope and decisions

- **No schema, DAL, command, approval, e-Faktur, PDF, or route changes.** This is a presentation, URL-validation, and localized-copy correction only.
- Keep `SalesInvoiceApprovalPreview` as the single record/approval evidence component. Its `SalesInvoiceRow.pmo_native` provenance is the authoritative discriminator: PMO-native rows retain their existing line-items section; ERP-owned rows render one quiet, localized source-of-truth sentence instead of an empty heading/list.
- Derive the selected invoice status from the current revenue mode's fixed filter set, not from the union of both sets. While ownership is unresolved, do not normalize the URL; once it resolves, preserve a valid status verbatim or replace an invalid one with the default `All` view and remove only `status` with router `replace` semantics. Keep `q` and every unrelated query parameter intact.
- Use the existing calm record typography: the ERP provenance sentence is body-size `text-muted-foreground`, not an empty-state card, table, status badge, or action. It introduces no new color, control, motion, or layout primitive and remains readable at phone width.
- The issue supplied explicit acceptance outcomes but no companion `docs/specs/*` file or preassigned IDs. The plan-local IDs below are exact anchors for those stated outcomes only; they do not add requirements.

## Issue-local acceptance traceability

| ID | Explicit issue outcome | Owning proof |
|---|---|---|
| AC-991-001 | An ERP-owned invoice record tells the user that its line items live in ERPNext and renders no empty line-items list; a PMO-native invoice record continues to show its lines. | RTL in `pmo-portal/pages/__tests__/SalesInvoices.native.test.tsx` |
| AC-991-002 | In each ownership mode, a valid `?status=` remains selected and in the URL; a value invalid for that current mode becomes the default view and the URL removes `status`, never falsely saying there are no invoices. | RTL in `pmo-portal/pages/__tests__/SalesInvoices.native.test.tsx` |
| AC-991-003 | The Indonesian ERP draft handoff names the same submission verb as the visible `Ajukan faktur` action. | RTL in `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` |

## Implementation plan

### Task 1 — Write the failing record and current-mode URL regression tests

**Files:**
- Modify `pmo-portal/pages/__tests__/SalesInvoices.native.test.tsx`

**TDD (red first):**
1. Extend the existing router test harness so `page()`/`renderPage()` accepts an initial `/sales-invoices...` or `/sales-invoices/:invoiceId...` entry and mounts a small `useLocation()` output with `data-testid="location"`. Keep the current query client, i18n provider, permission/ownership mocks, and route definitions; do not duplicate a page harness in a new file.
2. Add `AC-991-001` record-route assertions using the real `SalesInvoiceApprovalPreview` already imported by `SalesInvoices`:
   - Arrange `h.route = 'external'` and an ERP-owned row (`pmo_native: false`, no `native_lines`) at `/sales-invoices/<id>`. Assert the localized ERPNext line-items sentence is visible and `queryByRole('heading', { name: 'Line items' })` plus `queryByRole('list', { name: 'Line items' })` are null.
   - Arrange a PMO-native row with the existing `nativeInvoice()` fixture at its record URL. Assert its `Line items` heading, labelled list, and `Site survey` line remain visible.
3. Add four `AC-991-002` URL/filter assertions against rows whose status makes the filter result unambiguous:
   - PMO mode: `?status=Unpaid` remains in `location`, selects `Unpaid`, and excludes a `Paid` fixture; `?status=Submitted` asynchronously becomes `/sales-invoices` (no `status`), selects `All`, and renders both fixture rows rather than the filtered-empty message.
   - ERP mode: `?status=Submitted` remains in `location`, selects `Submitted`, and excludes a `Paid` fixture; `?status=PartlyPaid` asynchronously becomes `/sales-invoices` (no `status`), selects `All`, and renders both rows.
   Use `waitFor` only for the router normalization effect. Assert the status tab through its accessible tab state and assert row content, so the tests prove the user-facing default view rather than merely a changed URL.
4. Run this command and confirm the new assertions fail for the pre-change behavior:
   ```bash
   scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.native.test.tsx'
   ```

**ACs:** AC-991-001, AC-991-002.

### Task 2 — Render ERP provenance instead of an empty line-items section

**Files:**
- Modify `pmo-portal/pages/approvals/SalesInvoiceApprovalRow.tsx`
- Modify `pmo-portal/public/locales/en/common.json`
- Modify `pmo-portal/public/locales/id/common.json`

**Implementation (after Task 1 is red):**
1. Add one `financeCopy` key in both catalogues for the exact source-of-truth message: English `Line items are kept in ERPNext for this invoice.` and Indonesian `Rincian item untuk faktur ini disimpan di ERPNext.`.
2. In `SalesInvoiceApprovalPreview`, branch only the current line-items evidence block on `inv.pmo_native`:
   - for `true`, retain the exact existing `<section>`, `Line items` heading, labelled `<ul>`, line rendering, and totals;
   - for `false`, render the new localized sentence as a compact muted body paragraph and render neither the section heading nor the list.
3. Do not alter the shared facts block, amount/tax/total calculation, approval controls, or the approval-queue caller. The record route and approval queue continue to use the same preview component without a second implementation.
4. Re-run the focused RTL suite until Task 1 is green:
   ```bash
   scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.native.test.tsx'
   ```

**ACs:** AC-991-001.

### Task 3 — Validate `status` against the active ownership mode and normalize invalid links

**Files:**
- Modify `pmo-portal/pages/SalesInvoices.tsx`

**Implementation (after Task 1 is red):**
1. Replace the current `useState` initialization that accepts the combined ERP/native status union with a derived `statusFilter`: it is the requested URL value only when it belongs to the current `statusFilters`, otherwise `All`. Preserve the existing search state.
2. Add a `useEffect` that runs only after `mode` is resolved. When a non-null `status` is absent from that current mode's `statusFilters`, call `setSearchParams` with `{ replace: true }` to delete **only** `status`; leave `q` and unrelated parameters unchanged. A missing status is already the valid default and must not cause a navigation.
3. Make `ViewToggle` read that derived value. Its `onChange` must continue to update the URL through `updateListParam`, analytics must retain the current option-count argument, and `All` must continue to be represented by an absent `status` parameter.
4. Do not change `matchesStatus`, the filter arrays, row data, empty-state copy, commands, approvals, e-Faktur, or PDF behavior.
5. Re-run the Task 1 focused suite:
   ```bash
   scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.native.test.tsx'
   ```

**ACs:** AC-991-002.

### Task 4 — Align the Indonesian ERP draft-handoff verb with the submission action

**Files:**
- Modify `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx`
- Modify `pmo-portal/public/locales/id/common.json`

**TDD (red first):**
1. In the existing ERP-created-draft test area, add an `AC-991-003` Bahasa test that switches `financeTestI18n` to `id`, renders through `FinanceI18nTestProvider`, opens the mocked invoice modal, clicks `modal-created-numbered`, and asserts the handoff text is exactly `Draf dibuat. Pengguna Finance atau Admin lain harus mengajukan faktur ini.`. Restore English in `finally`, following the existing Bahasa test pattern in this file.
2. Run the focused test and confirm it fails while the catalogue still says `mengirimkannya`:
   ```bash
   scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx'
   ```
3. Change only `projectDetail.workOrders.billing.draftHandoffErp` in the Indonesian catalogue to that asserted sentence. Do not alter English copy, the handoff link, toast behavior, the `Ajukan faktur` label, or any invoice workflow.
4. Re-run the same focused suite until it is green.

**ACs:** AC-991-003.

### Task 5 — Run the bounded verification and rendered Discover check

**Files:** no production-file changes expected; update a test only if this check finds a reproducible in-fence defect, then return to the appropriate red-green task above.

1. Run the relevant regression suites, including the #990 deep-link, e-Faktur, and work-order-modal coverage:
   ```bash
   scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.native.test.tsx pages/__tests__/SalesInvoices.deepLink.test.tsx pages/__tests__/SalesInvoices.efaktur.test.tsx pages/__tests__/SalesInvoices.invoicePdf.test.tsx pages/project-detail/__tests__/InvoiceWorkOrderModal.test.tsx pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx'
   ```
2. Validate both edited catalogues and then run the required local code gates:
   ```bash
   cd pmo-portal && npm run check:i18n
   npm run typecheck
   npx eslint --max-warnings=0 pages/SalesInvoices.tsx pages/approvals/SalesInvoiceApprovalRow.tsx pages/__tests__/SalesInvoices.native.test.tsx pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx
   ```
3. Run the Impeccable mechanical detector once after the UI changes:
   ```bash
   /Users/ariefsaid/Coding/PMO/.claude/skills/impeccable/scripts/impeccable detect --json pmo-portal/pages/SalesInvoices.tsx pmo-portal/pages/approvals/SalesInvoiceApprovalRow.tsx
   ```
4. Perform one bounded rendered Discover pass with a PMO-native invoice containing lines and an ERP-owned mirrored invoice with no PMO `native_lines`. At **1440×900** and **390×844**, inspect the invoice record in **English and Indonesian**: PMO records retain their readable line list; ERP records show only the localized ERPNext provenance sentence; filters fit/scroll without horizontal page overflow; valid status links retain the selected tab; and invalid cross-mode links land on All rather than a false no-results state. Record the four locale×viewport observations and any finding in the issue/QA evidence; do not change the ownership mode or money data merely to make the view look correct.

**ACs:** AC-991-001, AC-991-002, AC-991-003.

## Final traceability and risk review

| AC | Owner / test | Why this layer is sufficient |
|---|---|---|
| AC-991-001 | `pages/__tests__/SalesInvoices.native.test.tsx` | The defect is deterministic conditional rendering from an already typed invoice row; mocked RTL directly proves both provenance branches and accessible semantics. |
| AC-991-002 | `pages/__tests__/SalesInvoices.native.test.tsx` | Router query parsing, current-mode option selection, URL replacement, and filtered render are all in the page component and are deterministically exercised with `MemoryRouter`. |
| AC-991-003 | `pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` | The component reads the shipped Indonesian catalogue through the real i18n test instance and proves the visible handoff copy. |

No ADR is needed: the work applies existing invoice provenance, router, i18n, and DESIGN.md patterns without a schema, public API, tenancy, authorization, or irreversible architectural decision. There is no caching, database, RLS, or performance-path change. The main regression risk is confusing PMO-native historical rows with ERP-owned rows; the `pmo_native` branch and two-sided RTL proof prevent that. The second risk is normalizing a status before ownership resolves; the implementation explicitly defers normalization until `mode` is known.
