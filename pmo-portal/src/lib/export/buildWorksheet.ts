/**
 * Pure utility: maps DataTable rows + columns into a flat header/data structure
 * suitable for writing to an Excel worksheet.
 *
 * Strategy:
 *   1. If `column.exportValue` is present → call it (string | number | boolean).
 *   2. Else if the cell return value is a primitive (string | number | boolean) → use it.
 *   3. Otherwise (React node) → fall back to '' (never "[object Object]").
 *
 * This stays 100% synchronous and has no exceljs import — the I/O layer
 * (`exportToXlsx`) handles that separately (lazy-loaded).
 */

import type { Column } from '@/src/components/ui';

export type CellValue = string | number | boolean;

export interface WorksheetData {
  /** One label per column in order. */
  headers: string[];
  /** One array per row; cells parallel `headers`. */
  dataRows: CellValue[][];
}

/**
 * Convert a React-renderable cell value to an Excel-safe primitive.
 * Primitives pass through; anything else (React element, object) → ''.
 */
function toCellValue(v: unknown): CellValue {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return '';
}

/**
 * Extract a string header from a column — React nodes fall back to the key.
 * Column headers are almost always a plain string; this handles the edge case
 * where a header is a React element (e.g. an icon) by using the key as a
 * safe fallback.
 */
function headerLabel<Row>(col: Column<Row>): string {
  if (typeof col.header === 'string') return col.header;
  return col.key;
}

/**
 * Build the flat header + data structure from live DataTable columns + rows.
 *
 * @param rows    The currently-visible (filtered) rows from the table.
 * @param columns The DataTable column definitions (including optional `exportValue`).
 */
export function buildWorksheetData<Row>(
  rows: Row[],
  columns: Column<Row>[],
): WorksheetData {
  const headers = columns.map(headerLabel);

  const dataRows = rows.map((row) =>
    columns.map((col): CellValue => {
      if (col.exportValue) {
        return toCellValue(col.exportValue(row));
      }
      // Fall through: try cell() — only safe if it returns a primitive.
      const cellResult = col.cell(row);
      return toCellValue(cellResult);
    }),
  );

  return { headers, dataRows };
}
