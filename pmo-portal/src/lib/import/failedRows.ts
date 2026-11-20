import type { ExportTable } from '@/src/lib/export/buildExportRows';

/**
 * The rows an import did not write, as a table the person can fix and upload again (#2520): the sheet's own
 * headers and cells, untouched, plus one reason column at the end. A re-upload ignores the extra column.
 */
export function buildFailedRowsTable(
  headers: string[],
  rows: string[][],
  failed: { index: number; reason: string }[],
  reasonHeader: string,
): ExportTable {
  const ordered = [...failed].sort((a, b) => a.index - b.index);
  return {
    header: [...headers, reasonHeader],
    body: ordered.map((f) => [...headers.map((_, col) => rows[f.index]?.[col] ?? ''), f.reason]),
  };
}
