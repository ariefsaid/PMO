/**
 * Lazy-loaded Excel export. ExcelJS is imported dynamically (import()) so it
 * stays out of the initial route chunk — it is only fetched when the user
 * actually clicks Export.
 *
 * Caller: useExport hook → ExportButton component.
 */

import type { Column } from '@/src/components/ui';
import { buildWorksheetData } from './buildWorksheet';

/**
 * Export the visible `rows` to an `.xlsx` file and trigger a browser download.
 *
 * @param rows     The currently-displayed (filtered) rows.
 * @param columns  The DataTable column definitions (may include `exportValue`).
 * @param filename Base filename without extension (e.g. `"companies-2026-06-13"`).
 */
export async function exportToXlsx<Row>(
  rows: Row[],
  columns: Column<Row>[],
  filename: string,
): Promise<void> {
  // Lazy import — stays out of the initial bundle.
  const ExcelJS = (await import('exceljs')).default;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Export');

  const { headers, dataRows } = buildWorksheetData(rows, columns);

  // Header row — bold + background tint matching DESIGN.md secondary token.
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' }, // slate-200 ≈ DESIGN.md secondary surface
  };

  // Auto-fit column widths based on the max observed content length (capped at 60).
  const colWidths = headers.map((h) => h.length);

  // Data rows
  dataRows.forEach((rowValues, rowIdx) => {
    sheet.addRow(rowValues);
    rowValues.forEach((val, colIdx) => {
      const strLen = String(val).length;
      if (strLen > colWidths[colIdx]) colWidths[colIdx] = strLen;
    });
    // Freeze alternate row for readability at large datasets (optional tint).
    if (rowIdx % 2 === 1) {
      const dataRow = sheet.getRow(rowIdx + 2);
      dataRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8FAFC' }, // slate-50
      };
    }
  });

  // Apply computed column widths
  colWidths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = Math.min(Math.max(w + 2, 10), 60);
  });

  // Serialize to buffer and trigger download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
