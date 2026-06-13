/**
 * Serialize an export table to a real `.xlsx` (OOXML) ArrayBuffer.
 *
 * ExcelJS is imported dynamically (`import()`) so it stays out of the initial
 * route chunk (NFR-3) — it is only fetched when the user actually exports.
 *
 * Typed cells (FR-3): numbers get a numeric numFmt; ISO `YYYY-MM-DD` strings
 * become real Excel date cells with a date numFmt; everything else stays text.
 * The header row is bold. No other styling (lean — plan §scope).
 */

import { cellType } from './cellType';
import type { ExportTable } from './buildExportRows';

export interface WorkbookInput extends ExportTable {
  /** Worksheet/sheet name (Excel caps sheet names at 31 chars). */
  sheetName: string;
}

const NUMBER_FMT = '#,##0.##';
const DATE_FMT = 'yyyy-mm-dd';

export async function toWorkbookBuffer({
  sheetName,
  header,
  body,
}: WorkbookInput): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));

  ws.addRow(header).font = { bold: true };

  for (const r of body) {
    const row = ws.addRow(r);
    r.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      const t = cellType(v);
      if (t === 'number') {
        cell.numFmt = NUMBER_FMT;
      } else if (t === 'date') {
        cell.value = new Date(v as string);
        cell.numFmt = DATE_FMT;
      }
    });
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
