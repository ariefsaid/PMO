import type { CellValue, ExportTable } from './buildExportRows';

// UTF-8 byte-order mark: Excel then reads non-ASCII project and client names correctly.
const BOM = String.fromCharCode(0xfeff);
// OWASP CSV injection: a text cell starting with one of these is read as a formula by Excel/Sheets.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function csvCell(v: CellValue): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const text = FORMULA_PREFIX.test(v) ? `'${v}` : v;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV: BOM, CRLF line ends, numbers unformatted (dot decimal) so any spreadsheet reads them. */
export function toCsv({ header, body }: ExportTable): string {
  const lines = [header, ...body].map((row) => row.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
