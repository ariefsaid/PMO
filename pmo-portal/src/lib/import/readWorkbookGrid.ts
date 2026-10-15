import { ImportParseError } from './types';

export type WorkbookCell = { text: string; value: string | number | Date | null; formula: boolean };
export type WorkbookGrid = { rows: WorkbookCell[][]; date1904: boolean };

/** Read a worksheet as bounded, untrusted raw cells. ExcelJS is loaded only when called. */
export async function readWorkbookGrid(
  buf: ArrayBuffer,
  limits?: { maxRows: number; maxColumns: number },
): Promise<WorkbookGrid> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new ImportParseError('not_xlsx', 'That file is not a valid .xlsx workbook.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportParseError('not_xlsx', 'That file is not a valid .xlsx workbook.');
  if (limits && ws.rowCount > limits.maxRows) {
    throw new ImportParseError('too_many_rows', `Too many worksheet rows: ${ws.rowCount}.`);
  }

  const rows: WorkbookCell[][] = [];
  for (let rowNumber = 1; rowNumber <= ws.rowCount; rowNumber += 1) {
    const excelRow = ws.getRow(rowNumber);
    if (limits && excelRow.cellCount > limits.maxColumns) {
      throw new ImportParseError(
        'too_many_columns',
        `Too many worksheet columns: ${excelRow.cellCount}.`,
      );
    }
    const cells: WorkbookCell[] = [];
    for (let column = 1; column <= excelRow.cellCount; column += 1) {
      const cell = excelRow.getCell(column);
      const raw = cell.value;
      const formula =
        typeof raw === 'object' && raw !== null && ('formula' in raw || 'sharedFormula' in raw);
      const value = formula
        ? null
        : raw instanceof Date
          ? raw
          : typeof raw === 'string' || typeof raw === 'number'
            ? raw
            : null;
      cells.push({ text: String(cell.text ?? '').trim(), value, formula });
    }
    rows.push(cells);
  }
  return { rows, date1904: Boolean(wb.properties.date1904) };
}
