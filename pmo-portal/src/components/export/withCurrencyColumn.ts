import type { Column } from '@/src/components/ui';

/**
 * FR-L10N-052 (AC-L10N-052): an export carrying a monetary column also carries that ROW's own ISO
 * 4217 code in its own adjacent column, sourced per record and never converted. Returns a copy of
 * `columns` with an export-only `Currency` column inserted right after the column keyed
 * `afterKey`; pass the result to `<ExportButton columns>` only, never to the on-screen DataTable.
 * (FR-L10N-050: export values never pass through `t()`, so the header is a literal.)
 */
export function withCurrencyColumn<Row>(
  columns: Column<Row>[],
  afterKey: string,
  currencyOf: (row: Row) => string,
): Column<Row>[] {
  const out: Column<Row>[] = [];
  for (const col of columns) {
    out.push(col);
    if (col.key === afterKey) {
      out.push({
        key: `${afterKey}-currency`,
        // i18n-exempt: export-only column, never rendered — FR-L10N-050 forbids t() on export values.
        header: 'Currency',
        cell: (r) => currencyOf(r),
        exportValue: (r) => currencyOf(r),
      });
    }
  }
  return out;
}
