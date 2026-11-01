import { SaxesParser } from 'saxes';
import { ImportParseError } from './types';

export type WorkbookCell = { text: string; value: string | number | Date | null; formula: boolean };
export type WorkbookGrid = { rows: WorkbookCell[][]; date1904: boolean };

const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
const DEFAULT_LIMITS = { maxRows: 2000, maxColumns: 100 };

function invalidWorkbook(): never {
  throw new ImportParseError('not_xlsx', 'That file is not a valid .xlsx workbook.');
}

type Limits = { maxRows: number; maxColumns: number };
type Budget = { used: number };

function checkSheet(xml: string, limits: Limits, budget: Budget): number {
  const rowBound = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 1) invalidWorkbook();
    if (n > limits.maxRows) throw new ImportParseError('too_many_rows', 'Too many worksheet rows.');
  };
  const colBound = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 1) invalidWorkbook();
    if (n > limits.maxColumns) throw new ImportParseError('too_many_columns', 'Too many worksheet columns.');
  };
  const address = (s: string) => {
    const match = /^\$?([A-Z]+)\$?([1-9]\d*)$/.exec(s);
    if (!match) return invalidWorkbook();
    let col = 0;
    for (const letter of match[1]) col = col * 26 + letter.charCodeAt(0) - 64;
    const row = Number(match[2]);
    rowBound(row); colBound(col);
    return { row, col };
  };
  const range = (value: string) => {
    const parts = value.split(':');
    if (parts.length > 2) invalidWorkbook();
    const a = address(parts[0]); const b = address(parts[1] ?? parts[0]);
    budget.used += (Math.abs(b.row - a.row) + 1) * (Math.abs(b.col - a.col) + 1);
    if (budget.used > DEFAULT_LIMITS.maxRows * DEFAULT_LIMITS.maxColumns) invalidWorkbook();
  };
  let mergedCells = 0;
  let mergeCount = 0;
  let rowCount = 0;
  let cellCount = 0;
  const parser = new SaxesParser();
  parser.on('doctype', () => invalidWorkbook());
  parser.on('opentag', node => {
    const attrs = node.attributes;
    if (node.name === 'row') {
      rowBound(Number(attrs.r));
      if (++rowCount > limits.maxRows) invalidWorkbook();
    }
    if (node.name === 'c') {
      address(String(attrs.r ?? ''));
      if (++cellCount > limits.maxRows * limits.maxColumns) invalidWorkbook();
    }
    if (node.name === 'col') {
      colBound(Number(attrs.min)); colBound(Number(attrs.max));
    }
    if (node.name === 'dataValidation') {
      for (const ref of String(attrs.sqref ?? '').split(/\s+/)) range(ref);
    }
    if (node.name === 'mergeCell') {
      const parts = String(attrs.ref ?? '').split(':');
      if (parts.length > 2) invalidWorkbook();
      const a = address(parts[0]); const b = address(parts[1] ?? parts[0]);
      mergedCells += (Math.abs(b.row - a.row) + 1) * (Math.abs(b.col - a.col) + 1);
      mergeCount += 1;
      if (mergeCount > 1000 || mergedCells > limits.maxRows * limits.maxColumns) invalidWorkbook();
    }
  });
  parser.write(xml).close();
  budget.used += cellCount + mergedCells;
  if (budget.used > DEFAULT_LIMITS.maxRows * DEFAULT_LIMITS.maxColumns) invalidWorkbook();
  return cellCount + mergedCells;
}

// ExcelJS's defined-name transform accepts comma-separated references, then its
// model setter materializes each qualifying range into a cell matrix.
function checkDefinedNames(xml: string, limits: Limits, budget: Budget): void {
  let content: string | undefined;
  const parser = new SaxesParser();
  parser.on('doctype', () => invalidWorkbook());
  parser.on('opentag', node => { if (node.name === 'definedName') content = ''; });
  parser.on('text', text => { if (content !== undefined) content += text; });
  parser.on('cdata', text => { if (content !== undefined) content += text; });
  parser.on('closetag', node => {
    if (node.name !== 'definedName' || content === undefined) return;
    // Commas inside quoted sheet names are part of the name, not separators.
    const refs = content.match(/(?:'[^']*(?:''[^']*)*'|[^,])+/g) ?? [];
    for (const ref of refs) {
      const tail = ref.split('!').pop() ?? '';
      if (!/[$](\w+)[$](\d+)(:[$](\w+)[$](\d+))?/.test(tail)) continue;
      const match = /^(?:(?:'(?:[^']|'')*'|[^'^ !]*)!)?\$([A-Z]+)\$([1-9]\d*)(?::\$([A-Z]+)\$([1-9]\d*))?$/.exec(ref);
      if (!match) invalidWorkbook();
      const col = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
      const a = { col: col(match[1]), row: Number(match[2]) };
      const b = { col: col(match[3] ?? match[1]), row: Number(match[4] ?? match[2]) };
      for (const point of [a, b]) {
        if (!Number.isSafeInteger(point.row) || !Number.isSafeInteger(point.col)) invalidWorkbook();
        if (point.row > limits.maxRows) throw new ImportParseError('too_many_rows', 'Too many worksheet rows.');
        if (point.col > limits.maxColumns) throw new ImportParseError('too_many_columns', 'Too many worksheet columns.');
      }
      budget.used += (Math.abs(b.row - a.row) + 1) * (Math.abs(b.col - a.col) + 1);
      if (budget.used > DEFAULT_LIMITS.maxRows * DEFAULT_LIMITS.maxColumns) invalidWorkbook();
    }
    content = undefined;
  });
  parser.write(xml).close();
}

/** Verify actual inflated bytes and sheet coordinates before passing the archive to ExcelJS. */
async function preflightWorkbook(buf: ArrayBuffer, limits: { maxRows: number; maxColumns: number }): Promise<void> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => view.getUint16(p, true);
  const u32 = (p: number) => view.getUint32(p, true);
  try {
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50) end -= 1;
    if (end < 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0 || end + 22 + u16(end + 20) !== bytes.length) invalidWorkbook();
    const count = u16(end + 10);
    if (count !== u16(end + 8) || count > 1024) invalidWorkbook();
    const centralSize = u32(end + 12); let pos = u32(end + 16);
    if (pos + centralSize !== end) invalidWorkbook();
    const names = new Set<string>();
    let total = 0;
    let sheetCount = 0;
    let sheetCells = 0;
    const budget: Budget = { used: 0 };
    for (let i = 0; i < count; i += 1) {
      if (u32(pos) !== 0x02014b50) invalidWorkbook();
      const flags = u16(pos + 8); const method = u16(pos + 10);
      const compressed = u32(pos + 20); const expected = u32(pos + 24);
      const nameLength = u16(pos + 28); const extra = u16(pos + 30); const comment = u16(pos + 32);
      const local = u32(pos + 42);
      if ((flags & 1) || (method !== 0 && method !== 8) || pos + 46 + nameLength + extra + comment > end) invalidWorkbook();
      const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
      if (names.has(name) || name.includes('..') || name.includes('\\')) invalidWorkbook();
      names.add(name);
      if (local + 30 > u32(end + 16) || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) invalidWorkbook();
      const localNameLength = u16(local + 26); const localExtra = u16(local + 28);
      const localName = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(local + 30, local + 30 + localNameLength));
      const start = local + 30 + localNameLength + localExtra;
      if (name !== localName || start + compressed > u32(end + 16)) invalidWorkbook();
      const isSheet = /^\/?xl\/worksheets\/sheet\d+\.xml$/.test(name);
      if (!isSheet && /xl\/worksheets\/sheet\d+\.xml/.test(name)) invalidWorkbook();
      if (isSheet && ++sheetCount > 10) invalidWorkbook();
      const isBook = name === 'xl/workbook.xml' || name === '/xl/workbook.xml';
      const chunks: Uint8Array[] = [];
      let actual = 0;
      const add = (chunk: Uint8Array) => {
        actual += chunk.length; total += chunk.length;
        if (total > MAX_EXPANDED_BYTES) throw new ImportParseError('fileTooLarge', 'Expanded workbook exceeds 20 MiB.');
        if (isSheet || isBook) chunks.push(chunk);
      };
      if (method === 0) add(bytes.subarray(start, start + compressed));
      else {
        let cursor = start;
        const input = new ReadableStream<Uint8Array>({ pull(controller) {
          if (cursor === start + compressed) { controller.close(); return; }
          const next = Math.min(cursor + 1024, start + compressed);
          controller.enqueue(bytes.subarray(cursor, next)); cursor = next;
        } });
        const reader = input.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            add(value);
          }
        } finally { await reader.cancel().catch(() => {}); }
      }
      if (actual !== expected) invalidWorkbook();
      if (isSheet || isBook) {
        const data = new Uint8Array(actual); let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        const xml = new TextDecoder('utf-8', { fatal: true }).decode(data);
        if (isSheet) {
          sheetCells += checkSheet(xml, limits, budget);
          if (sheetCells > DEFAULT_LIMITS.maxRows * DEFAULT_LIMITS.maxColumns) invalidWorkbook();
        } else checkDefinedNames(xml, limits, budget);
      }
      pos += 46 + nameLength + extra + comment;
    }
    if (pos !== end) invalidWorkbook();
  } catch (error) {
    if (error instanceof ImportParseError) throw error;
    invalidWorkbook();
  }
}

/** Read a worksheet as bounded, untrusted raw cells. ExcelJS is loaded only when called. */
export async function readWorkbookGrid(
  buf: ArrayBuffer,
  limits?: { maxRows: number; maxColumns: number },
): Promise<WorkbookGrid> {
  if (buf.byteLength > 5 * 1024 * 1024) throw new ImportParseError('fileTooLarge', 'File exceeds 5 MiB.');
  await preflightWorkbook(buf, limits ?? DEFAULT_LIMITS);
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
