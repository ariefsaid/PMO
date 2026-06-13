/**
 * Pure projection of DataTable rows + columns into a flat header/body structure
 * for the xlsx writer. Each cell uses the column's `exportValue(row)` when
 * defined (the DISPLAY value as a plain scalar) — never the React `cell` node.
 * Columns without `exportValue` serialize to `''`.
 *
 * 100% synchronous; no exceljs import. The I/O layer (`toWorkbookBuffer`)
 * handles serialization separately (lazy-loaded).
 */

import type { Column } from '@/src/components/ui';

export type CellValue = string | number | boolean;

export interface ExportTable {
  /** One label per column in order. */
  header: string[];
  /** One array per row; cells parallel `header`. */
  body: CellValue[][];
}

/**
 * Extract a string header from a column. `Column.header` is `React.ReactNode`;
 * use it only when it is a string, else fall back to the column key.
 */
function headerLabel<Row>(col: Column<Row>): string {
  return typeof col.header === 'string' ? col.header : col.key;
}

export function buildExportRows<Row>(rows: Row[], columns: Column<Row>[]): ExportTable {
  const header = columns.map(headerLabel);
  const body = rows.map((row) =>
    columns.map((c): CellValue => (c.exportValue ? c.exportValue(row) : '')),
  );
  return { header, body };
}
