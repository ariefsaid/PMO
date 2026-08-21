# Pipeline XLSX export now carries each deal's own currency (#530 item 3)

## What changed and why it matters

The pipeline table's XLSX export emitted the Value and Weighted cells as **bare
numbers with no currency**. Until recently every row silently took the org default,
so the omission was invisible — but `get_sales_pipeline()` now projects each deal's
own `currency` (migration `0201`), and an on-screen list can be genuinely mixed-
currency. Without an explicit code, `1234` in the downloaded file is ambiguous (IDR
or USD), and the file does not say which.

Per the signed decision (FR-L10N-052 / AC-L10N-052), the fix **carries the currency
per row and does not convert** — PMO holds no exchange rates. Each row's ISO code
goes in its own column, and the Value/Weighted cells stay raw numeric amounts so a
spreadsheet can still sum them. This is a **frontend-only** change: no migration,
schema, `database.types.ts`, or export-helper edit.

The output format is XLSX (not CSV). The shared export seam
(`ExportButton` → `useExport` → `buildExportRows` → `toWorkbookBuffer`) already
serializes strings and finite numbers into typed cells, so the new text column went
through the existing shared code path — no second way to emit a cell was invented.

## Files

- `pmo-portal/pages/SalesPipeline.tsx` — the production change.
- `pmo-portal/pages/__tests__/SalesPipeline.export.test.tsx` — the regression proof.
- `docs/plans/2026-08-21-pipeline-export-currency-8282fb9b.md` — the implementation plan (new).

## What the code does

`SalesPipeline` builds its on-screen `tableColumns` (unchanged — the visible table
gains no new column). It then derives an export-only array, `exportColumns`, by
iterating `tableColumns` and inserting a `Currency` column **immediately after the
`value` column** (so it lands between Value and Weighted) with:

```ts
{
  key: 'currency',
  header: 'Currency',
  cell: (r) => r.currency,
  exportValue: (r) => r.currency,
}
```

`<ExportButton>` now receives `exportColumns` instead of `tableColumns`. The Value
and Weighted `exportValue` callbacks are untouched and still return numbers
(`r.contract_value` and `weightedValue(r)`). The obsolete comment claiming the
export was a bare-number/CSV gap was deleted and replaced with one describing the
new per-row behavior. Data flows in from `get_sales_pipeline()`/`useLostDeals()`,
which already carry `PipelineProject.currency` per record.

## How to verify

The regression test, `AC-L10N-052: mixed-currency pipeline export carries each ISO
code and bare numeric amounts`, renders the page as Project Manager, clicks the live
Export button, and runs the captured rows/columns through the same `buildExportRows`
projection the real export path uses. Key assertions:

- Header order is `… Value, Currency, Weighted …` with Currency at index 4.
- It uses a **mixed-currency fixture** (USD `Deal 1` + IDR `Deal 2` in the SAME
  list), so a record's own code is distinguishable from a hardcoded default — the
  exact blind spot this issue came from.
- The Currency cell equals the row's own ISO code (`USD` / `IDR`).
- Value and Weighted are asserted to be **bare numeric cells** (`10000`/`5000`,
  `1234`/`308.5`) with `typeof === 'number'`, guarding against a later "improvement"
  that formats them for display.

Run from `pmo-portal/`:

```bash
npm test -- pages/__tests__/SalesPipeline.export.test.tsx   # targeted
npm run verify:locked                                       # full gate (rc=0)
```

## Note (not traced in the diff)

The change was written test-first (RED with the pre-fix code), then a mutation
check was performed per the brief. The mutation output and verify result live in the
builder's report, not in this diff.