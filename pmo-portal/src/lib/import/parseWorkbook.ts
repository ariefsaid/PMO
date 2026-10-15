import { ImportParseError, MAX_IMPORT_ROWS, type ParsedSheet } from './types';
import { readWorkbookGrid } from './readWorkbookGrid';

/**
 * Parse an `.xlsx` ArrayBuffer into the legacy headers + trimmed string rows contract.
 * The shared raw-cell reader keeps ExcelJS lazy and the compatibility projection below
 * deliberately preserves the original first-row/header, blank-row and size behavior.
 */
export async function parseWorkbook(buf: ArrayBuffer): Promise<ParsedSheet> {
  const grid = await readWorkbookGrid(buf);
  const headers = (grid.rows[0] ?? []).map(cell => cell.text);
  const rows: string[][] = [];
  for (const row of grid.rows.slice(1)) {
    const cells = headers.map((_, index) => row[index]?.text ?? '');
    if (cells.some(value => value !== '')) rows.push(cells);
  }
  if (rows.length === 0) throw new ImportParseError('empty', 'The sheet has no data rows to import.');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportParseError('too_many_rows', `Too many rows: ${rows.length}. Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
  }
  return { headers, rows };
}
