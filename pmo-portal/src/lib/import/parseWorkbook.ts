import { ImportParseError, MAX_IMPORT_ROWS, type ParsedSheet } from './types';
import { readWorkbookGrid } from './readWorkbookGrid';

/**
 * Parse an `.xlsx` ArrayBuffer into the legacy headers + trimmed string rows contract.
 * The shared raw-cell reader keeps ExcelJS lazy and the compatibility projection below
 * deliberately preserves the original first-row/header, blank-row and size behavior.
 */
export async function parseWorkbook(buf: ArrayBuffer, maxRows: number = MAX_IMPORT_ROWS): Promise<ParsedSheet> {
  // The preflight cap includes the header and remains bounded independently of the descriptor.
  // Keep the default 2,000-row preflight for existing importers while allowing large catalogues.
  const preflightRows = Math.min(5001, Math.max(2000, maxRows + 1));
  const grid = await readWorkbookGrid(buf, { maxRows: preflightRows, maxColumns: 100 });
  const headers = (grid.rows[0] ?? []).map(cell => cell.text);
  const rows: string[][] = [];
  for (const row of grid.rows.slice(1)) {
    const cells = headers.map((_, index) => {
      const cell = row[index];
      return cell?.value instanceof Date && !Number.isNaN(cell.value.getTime()) ? cell.value.toISOString().slice(0, 10) : cell?.text ?? '';
    });
    if (cells.some(value => value !== '')) rows.push(cells);
  }
  if (rows.length === 0) throw new ImportParseError('empty', 'The sheet has no data rows to import.');
  if (rows.length > maxRows) {
    throw new ImportParseError('too_many_rows', `Too many rows: ${rows.length}. Import at most ${maxRows} rows at a time.`);
  }
  return { headers, rows };
}
