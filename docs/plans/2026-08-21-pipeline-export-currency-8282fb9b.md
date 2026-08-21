# Plan: preserve per-row currency in Pipeline XLSX export (#530 item 3)

**Source requirement:** `docs/specs/i18n-framework.spec.md` — FR-L10N-052 / AC-L10N-052.

## Design

`SalesPipeline` builds the visible `tableColumns` and supplies column definitions to the shared `ExportButton`. The button calls `useExport`, which calls `buildExportRows`; each `exportValue` becomes a typed XLSX cell through `toWorkbookBuffer`. `CellValue` already supports strings and finite numbers, and the workbook writer writes numbers as numeric cells while leaving ISO currency text cells as text. No export helper change is needed and XLSX remains the output format.

Keep the existing on-screen table columns unchanged. Create an export-only `Column<PipelineProject>` for the record's `currency`, then insert it between the existing Value and Weighted columns only in the array passed to `ExportButton`. Its `exportValue: (r) => r.currency` follows the existing shared text-cell path. Value and Weighted retain their existing raw numeric `exportValue`s; no display formatter, conversion, currency symbol, or grouping is introduced into the workbook data.

Data flow: `get_sales_pipeline()` / `useLostDeals()` already provide `PipelineProject.currency` per record → `SalesPipeline` export-only Currency column → `ExportButton` → `useExport` → `buildExportRows` → `toWorkbookBuffer` typed XLSX cells. Migration `0201` already projects the open-deal field, `PipelineProject` already requires it, and `useLostDeals()` already passes it through; this frontend-only change must not touch any of them.

This creates no new endpoint, cache, schema, migration, RLS policy, type generation, or ADR. It preserves the no-conversion decision: a mixed-currency export is a list of independently denominated numbers plus their explicit ISO codes, not a fabricated aggregate.

## AC traceability

| AC | Owning layer | Canonical proof |
| --- | --- | --- |
| AC-L10N-052 | Unit (Vitest) | `pmo-portal/pages/__tests__/SalesPipeline.export.test.tsx` — mixed USD/IDR export projection has a per-row Currency text cell adjacent to numeric Value/Weighted cells |

## Implementation tasks

All application commands run from `pmo-portal/`. Do not commit with any red test; fix production code rather than weakening, skipping, or deleting an assertion.

### Task 1 — Add the mixed-currency export regression first (RED)

**Files:**
- Modify `pmo-portal/pages/__tests__/SalesPipeline.export.test.tsx`

**Test-first change (FR-L10N-052 / AC-L10N-052):**
1. Extend the mocked `useSalesPipeline().data.projects` fixture so the same export list contains two distinct deals: retain the USD deal (`contract_value: 10000`, `win_probability: 0.5`, `currency: 'USD'`) and add an IDR deal (`contract_value: 1234`, `win_probability: 0.25`, `currency: 'IDR'`). Give both rows the required pipeline fields. Do not split currencies across fixtures, scopes, or tests.
2. Import `fireEvent` from Testing Library and `buildExportRows` from `@/src/lib/export`. In a new test titled `AC-L10N-052: mixed-currency pipeline export carries each ISO code and bare numeric amounts`, render as Project Manager, clear `exportXlsx`, click the live Export button, and capture the `rows`, `columns`, and entity passed to the mocked shared export seam.
3. Run those captured rows and columns through `buildExportRows`, the same projection the real `useExport` path invokes. Assert entity is `Pipeline`; assert the full headers are `['Project', 'Customer', 'Stage', 'Value', 'Currency', 'Weighted', 'Win %', 'Owner', 'Last touch']`; and assert Currency is immediately after Value and immediately before Weighted.
4. Locate each body row by its Project value. For both USD and IDR rows, assert the Currency cell exactly equals that row's ISO code. Assert Value and Weighted cells are `number` values with their unformatted numeric values (`10000`/`5000` and `1234`/`308.5`, respectively), not strings. These type-and-value assertions are the guard against symbols or grouping separators being added later.

**Verify RED:**
```bash
npm test -- pages/__tests__/SalesPipeline.export.test.tsx
```
The new test must fail before production changes because the current column list has no `Currency` header/cell. Leave its expectations intact.

### Task 2 — Add the export-only per-row Currency column

**Files:**
- Modify `pmo-portal/pages/SalesPipeline.tsx`

**Implementation (FR-L10N-052 / AC-L10N-052):**
1. Delete the obsolete Value-column comment claiming the export emits a bare number without a currency column (and its incorrect CSV wording). Retain the existing `exportValue: (r) => r.contract_value` and `exportValue: (r) => weightedValue(r)` unchanged so both workbook cells remain raw numbers.
2. Define one export-only `Column<PipelineProject>` whose `key` is `currency`, `header` is `Currency`, required `cell` returns `r.currency`, and `exportValue` returns `r.currency`. Do not use `formatCurrency`, an org default, or a literal ISO code.
3. Derive the columns passed to `ExportButton` by inserting that Currency column immediately before the existing `weighted` column; retain the original `tableColumns` for `DataTable` so this narrowly changes the download rather than adding an unrequested on-screen table column. Pass this derived export column array to `<ExportButton>`.
4. Preserve the shared export path (`ExportButton` → `useExport` → `buildExportRows` → `toWorkbookBuffer`); do not alter `src/lib/export/*`, formatters, PipelineProject typing, hooks, migration `0201`, generated database types, schema, or RLS.

**Verify GREEN:**
```bash
npm test -- pages/__tests__/SalesPipeline.export.test.tsx
```
Require exit status 0 with the new AC-L10N-052 test and all pre-existing tests in the file green.

### Task 3 — Mutation-check the real export callback, then restore it

**Files temporarily modified and restored:**
- `pmo-portal/pages/SalesPipeline.tsx`

**Mutation procedure (AC-L10N-052):**
1. Temporarily replace only the new Currency export column's `exportValue: (r) => r.currency` with a hard-coded `exportValue: () => 'USD'` at that export call site.
2. Run the targeted test command below. It must exit nonzero and the IDR-row assertion must report expected `IDR` versus received `USD`; a green result means the test cannot distinguish a row-backed code from a hard-coded default.
3. Restore the exact `r.currency` production callback, confirm the only intended diff is the Task 2 implementation plus test, and rerun the targeted test to green. Never change an expectation to make the mutation pass.

**Verify mutated RED, then restored GREEN:**
```bash
npm test -- pages/__tests__/SalesPipeline.export.test.tsx
```

Record the actual mutated command, exit status, and failure excerpt in the builder's final report, followed by the restored-green command and exit status. This mutation evidence is required by the issue; do not claim it ran without the captured output.

### Task 4 — Run the mandatory locked full gate and review scope

**Files:** Task 1–2 files, review only.

1. If dependencies are absent, install them without changing the lockfile:
```bash
test -d node_modules || npm ci
```
2. Run the required full gate:
```bash
npm run verify:locked
```
3. Require both commands to exit 0. Before the build commit, inspect `git diff --check` and the changed-file list to confirm only these frontend files changed:
   - `pmo-portal/pages/SalesPipeline.tsx`
   - `pmo-portal/pages/__tests__/SalesPipeline.export.test.tsx`
4. Confirm the test title contains `AC-L10N-052`, the exported header order is Value / Currency / Weighted, every currency code comes from `r.currency`, Value and Weighted callbacks still return numbers, and no migration, schema, `database.types.ts`, export-helper, or lockfile change was introduced.

**Verify:**
```bash
git diff --check
```
Require exit status 0.

## Expected changed files

- `pmo-portal/pages/SalesPipeline.tsx`
- `pmo-portal/pages/__tests__/SalesPipeline.export.test.tsx`

No ADR: this is a localized implementation of the signed per-record export requirement, not an architectural decision.
