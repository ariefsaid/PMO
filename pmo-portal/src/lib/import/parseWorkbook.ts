import { ImportParseError, MAX_IMPORT_ROWS, type ParsedSheet } from './types';

/**
 * Parse an `.xlsx` ArrayBuffer into headers + data-row strings (the ONLY exceljs touch on
 * the import side; mirrors `toWorkbookBuffer`). ExcelJS is imported dynamically (`import()`)
 * so it stays out of the Companies route's initial chunk (NFR-IMP-002) — fetched only when
 * a user actually imports. Read-only over an in-memory buffer: no eval, no DOM injection.
 *
 * Row 1 = headers (trimmed). Rows 2..N = data; each cell `String(cell.text ?? '').trim()`.
 * Throws `ImportParseError`:
 *   - `'not_xlsx'`    when the buffer is not a loadable workbook (or has no worksheet),
 *   - `'empty'`       when there are zero data rows,
 *   - `'too_many_rows'` when data rows exceed MAX_IMPORT_ROWS (no oversized set ever commits).
 */
export async function parseWorkbook(buf: ArrayBuffer): Promise<ParsedSheet> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();

  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new ImportParseError('not_xlsx', 'That file is not a valid .xlsx workbook.');
  }

  const ws = wb.worksheets[0];
  if (!ws) {
    throw new ImportParseError('not_xlsx', 'That file is not a valid .xlsx workbook.');
  }

  const cellText = (cell: { text?: unknown }): string => String(cell.text ?? '').trim();

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  // headerRow.cellCount counts populated cells; iterate 1..cellCount for trimmed labels.
  for (let c = 1; c <= headerRow.cellCount; c += 1) {
    headers.push(cellText(headerRow.getCell(c)));
  }

  const rows: string[][] = [];
  // ws.rowCount is the last populated row number; row 1 is the header.
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= headers.length; c += 1) {
      cells.push(cellText(row.getCell(c)));
    }
    // Skip a fully-blank trailing row (exceljs can over-count rowCount).
    if (cells.some((v) => v !== '')) rows.push(cells);
  }

  if (rows.length === 0) {
    throw new ImportParseError('empty', 'The sheet has no data rows to import.');
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportParseError(
      'too_many_rows',
      `Too many rows: ${rows.length}. Import at most ${MAX_IMPORT_ROWS} rows at a time.`,
    );
  }

  return { headers, rows };
}
