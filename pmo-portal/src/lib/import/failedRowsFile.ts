import { safeCellText } from './spreadsheetText';

export interface FailedRowsLabels {
  sheet: string;
  alreadyThere: string;
  rowInFile: string;
  reason: string;
}

export interface FailedRowsInput {
  headers: string[];
  rows: string[][];
  /** Rows that did not import, with why (0-based sheet row indexes). */
  failed: { index: number; reason: string }[];
  /** Rows left out because the record already exists; listed on their own sheet, never mixed with failures. */
  skipped: number[];
  labels: FailedRowsLabels;
}

/**
 * The failed-rows workbook (#2530, FR-IMT-004/005): the original headers and cell text of each row that did not
 * import, plus "Row in your file" and "Reason". Fix the rows and upload the file again: the two added columns match
 * no field, so the mapper ignores them. Cells that begin like a formula are written as text.
 */
export async function buildFailedRowsWorkbook({ headers, rows, failed, skipped, labels }: FailedRowsInput): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const cellsOf = (index: number) => headers.map((_, col) => safeCellText(rows[index]?.[col] ?? ''));
  const ws = wb.addWorksheet(labels.sheet.slice(0, 31));
  ws.addRow([...headers, labels.rowInFile, labels.reason]).font = { bold: true };
  for (const f of [...failed].sort((a, b) => a.index - b.index)) {
    // +2: the header is row 1 and sheet indexes are 0-based, so this is the row number the person sees.
    ws.addRow([...cellsOf(f.index), f.index + 2, safeCellText(f.reason)]);
  }
  if (skipped.length > 0) {
    const there = wb.addWorksheet(labels.alreadyThere.slice(0, 31));
    there.addRow([...headers, labels.rowInFile]).font = { bold: true };
    for (const i of [...skipped].sort((a, b) => a - b)) there.addRow([...cellsOf(i), i + 2]);
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
