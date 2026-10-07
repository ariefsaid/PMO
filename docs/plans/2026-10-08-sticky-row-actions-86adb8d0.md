# #925 — Keep DataTable row actions visible during horizontal scroll

## Acceptance contract

`docs/specs/` has no issue-specific specification for #925. This plan transcribes the issue's stated acceptance condition as `AC-TBL-STICKY-001` solely for test traceability:

- **AC-TBL-STICKY-001:** Given a desktop DataTable has a `rowMenu` and its columns overflow horizontally, when the user views `/sales-invoices` at 1280px or 1440px, then a visible row-actions (`⋯`) trigger remains within the visible bounds of `dt-table-branch`; the header and row action cells remain separated from scrolling content in both themes. The `<768px` card branch remains unchanged.

## Design

### Root cause and decision

`pmo-portal/src/components/ui/DataTable.tsx` renders the `rowMenu` header and body cell as the last ordinary table column. Its desktop branch already owns the `relative overflow-x-auto` scroll container and the `cardBelow` container-width switch used by the Work Orders table. On wide lists such as Sales Invoices, the final cell therefore leaves that container with the rest of the table content.

Extend this one shared desktop DataTable branch; do not add a page-level wrapper, a Sales Invoices override, a second responsive breakpoint, or a new DataTable prop. When `rowMenu` is present, give its generated final `<th>` and `<td>` the same reusable sticky-right base class. Use `bg-card`, `border-l border-border`, and a subtle left-cast shadow using the existing `--foreground` token so the pinned surface is opaque and visually separated in light and dark themes. Keep the existing header stacking hierarchy above the sticky body cells (`z-[3]` versus `z-[1]`) so the table header remains the topmost table surface. The existing `rowMenu` condition means tables without a row-actions column are unchanged, and the existing mobile card branch continues to put `RowMenu` in each card's top-right corner unchanged.

This is a CSS-only presentation repair: no schema, RLS, repository, API, authorization, localization, seed, migration, or package-lock change is needed. The shared implementation automatically covers every existing consumer that passes `rowMenu`, including wide money and project-document tables; no per-page edits are permitted.

### Test strategy and QA portfolio

- **Unit/RTL support proof:** assert the conditional desktop `rowMenu` output has sticky-right, opaque-card, border/shadow, and ordered z-index classes on both its Actions header and its row cell. This is fast structural proof that all consumers receive the shared behavior.
- **Owning E2E proof:** a read-only, network-stubbed Sales Invoices list creates a deliberately wide, realistic invoice row and measures the actual `dt-table-branch` viewport and visible `Row actions` trigger after fonts settle at 1280px and 1440px. It asserts the table genuinely overflows and that every visible trigger's left/right edges remain inside the scroller's visible client-width box (with a 1px rendering tolerance). This is the browser geometry oracle; a `scrollWidth`-only assertion would not prove the action is reachable.
- **Portfolio cell:** data-correctness / action-completeness × `/sales-invoices` at desktop 1280/1440, retained by the E2E geometry spec. The existing `AC-TBL-OVERFLOW-001` remains its separate no-overflow Projects contract.

No ADR is required: this is a reversible implementation detail within the existing DataTable pattern.

## Implementation plan

### Task 1 — Add the failing shared-table structure test (2–3 min)

**Files:** `pmo-portal/src/components/ui/__tests__/DataTable.test.tsx`

1. Before changing production code, add an RTL test titled with `AC-TBL-STICKY-001` that renders the existing fixture rows with `rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}` in the desktop branch.
2. Locate the accessible `Actions` column header and the first `td` that contains the `Row actions` button. Assert both generated cells contain `sticky`, `right-0`, `bg-card`, `border-l`, and `border-border`; assert the header has `z-[3]`, the body cell has `z-[1]`, and both contain the same left-cast tokenized shadow utility `shadow-[-4px_0_6px_-4px_hsl(var(--foreground)/0.12)]`.
3. Run the test and confirm it fails against the current ordinary row-menu column before proceeding.

**Covers:** `AC-TBL-STICKY-001` (unit support proof; E2E owns acceptance).

**Red verification:**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/ui/__tests__/DataTable.test.tsx'
```

### Task 2 — Add the failing Sales Invoices browser geometry test (3–5 min)

**Files:** `pmo-portal/e2e/AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts`

1. Create a Chromium-lane spec tagged `// @e2e-isolation: read-only — it only signs in, stubs the Sales Invoices GET response, and measures layout; it performs no database write.`
2. Model setup on `AC-TBL-OVERFLOW-001-projects-table-no-page-scroll.spec.ts` and `AC-BWO-004-work-order-billing-geometry.spec.ts`: for each viewport width in `[1280, 1440]`, set a 900px height, sign in as `finance@acme.test`, and intercept only GET requests matching `**/rest/v1/sales_invoices?**` before navigating to `/sales-invoices`.
3. Fulfil that request with at least one complete Unpaid invoice projection (including `companies`, `sales_invoice_authors`, currency, tax treatment, dates, outstanding amount, and e-Faktur fields) whose long customer-PO/reference value forces the desktop table's `scrollWidth` above its `clientWidth`; let all unrelated requests fall through. Do not add a seed row or make an API write.
4. Wait for `dt-table-branch`, its first table body row, and `waitForFonts(page)`. In page evaluation, collect `clientWidth`, the scroller left edge, and each visible `tbody button[aria-label="Row actions"]` bounding rectangle. Assert there is at least one trigger, the scroller actually overflows, and each trigger is within `[scrollerLeft - 1, scrollerLeft + clientWidth + 1]`. Name each case `AC-TBL-STICKY-001` and make the failure message include the measured scroller and trigger boxes.
5. Run the focused spec and confirm it fails before the production CSS change.

**Covers:** `AC-TBL-STICKY-001` (owning E2E test).

**Red verification:**
```bash
scripts/e2e-local.sh AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts
```

### Task 3 — Make the generated row-actions column sticky in the shared desktop branch (3–5 min)

**Files:** `pmo-portal/src/components/ui/DataTable.tsx`

1. Define one module-local base class constant for desktop row-actions cells: `sticky right-0 border-l border-border bg-card shadow-[-4px_0_6px_-4px_hsl(var(--foreground)/0.12)]`. This intentionally uses only existing `card`, `border`, and `foreground` design tokens and gives the pinned strip an opaque surface in both themes.
2. In the existing `rowMenu && (...)` header branch, compose that base class with the current width/bottom-border classes and `z-[3]`; preserve `scope="col"` and the screen-reader-only `Actions` label.
3. In the existing desktop row `rowMenu && (...)` body branch, compose the same base class with its current `px-2 align-middle` classes and `z-[1]`. Leave the `RowMenu` rendering, click propagation protection, portal behavior, menu z-index, table scroller, all ordinary columns, and the entire mobile `dt-card-branch` untouched.
4. Re-run the new unit test and geometry spec, then inspect the established regression suites to ensure the sticky action cell did not alter the row-menu portal or card layout contracts.

**Covers:** `AC-TBL-STICKY-001`.

**Green verification:**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/ui/__tests__/DataTable.test.tsx src/components/ui/__tests__/DataTable.mobile.test.tsx src/components/ui/__tests__/DataTable.rowmenu-clip.test.tsx'
scripts/e2e-local.sh AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts
```

### Task 4 — Record the shared DataTable rule and its graduation (2–3 min)

**Files:** `DESIGN.md`; `docs/qa-portfolio.md`

1. In `DESIGN.md`'s **Data Table (signature)** section, add a rule directly after the existing always-visible row-`⋯` rule: on the desktop table branch, a generated `rowMenu` column is sticky to the right whenever the table scrolls horizontally; its header is above its body cells, and both use the `card` surface, `border` left divider, and tokenized left separation shadow. State that mobile cards retain their existing top-right action placement.
2. Add one completed #925 graduation-registry entry to `docs/qa-portfolio.md` that names `AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts` as the lock, `data-correctness / action-completeness × /sales-invoices @1280/1440` as the matrix cell, and the new DESIGN.md Data Table rule as the retained design knowledge.
3. Confirm the written contract describes the shared `rowMenu` behavior rather than a Sales Invoices-only workaround.

**Covers:** `AC-TBL-STICKY-001` documentation and portfolio traceability.

**Verification:**
```bash
grep -n "AC-TBL-STICKY-001\|sticky to the right" DESIGN.md docs/qa-portfolio.md
```

### Task 5 — Run the scoped local final gate (2–5 min)

**Files:** no additional files.

1. Keep `package-lock.json`, migrations, seeds, and environment files untouched. The focused E2E command starts its own Vite server through Playwright; allow that command to exit so no server remains running.
2. Run typecheck and changed-test dependency coverage under the test lock, lint only the three touched TypeScript files, then re-run the focused browser journey through the DB-locked helper. Do not substitute a page-scroll assertion for the trigger geometry assertion.

**Covers:** `AC-TBL-STICKY-001` final regression verification.

**Verification:**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'
cd pmo-portal && npx eslint --max-warnings=0 src/components/ui/DataTable.tsx src/components/ui/__tests__/DataTable.test.tsx e2e/AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts
scripts/e2e-local.sh AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts
```

## Traceability

| Acceptance criterion | Owning test | Supporting proof | Tasks |
| --- | --- | --- | --- |
| `AC-TBL-STICKY-001` | `pmo-portal/e2e/AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts` — desktop 1280/1440 trigger-in-scroller geometry | `pmo-portal/src/components/ui/__tests__/DataTable.test.tsx` — shared generated header/body sticky class contract | 1–5 |

## Scope fences

- Do not modify `pages/SalesInvoices.tsx`, `DocumentsTab.tsx`, Work Orders, any other consumer, or their column budgets; the shared `rowMenu` output is the sole implementation point.
- Do not change the existing `cardBelow` API, breakpoints, or mobile card rendering; it remains the established narrow-container mechanism.
- Do not add migrations, RLS policies, seed data, backend/API work, dependencies, package-lock changes, or environment-file reads/changes.
- The issue body mentions a Procurement Documents geometry check, but the signed prompt's explicit graduation scope names `/sales-invoices` at 1280/1440 only. The shared fix still applies to Documents automatically; do not add a second route-specific E2E spec in this issue.
