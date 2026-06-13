/**
 * AC-IMP-001/002 — REAL xlsx round-trip: builds a genuine workbook buffer with the shipped
 * export writer (`toWorkbookBuffer`, unmocked exceljs) and parses it back. Mirrors
 * `toWorkbookBuffer.test.ts`'s unmocked posture so the lazy `import('exceljs')` path is real.
 */
import { describe, it, expect } from 'vitest';
import { toWorkbookBuffer } from '@/src/lib/export';
import { parseWorkbook } from '../parseWorkbook';
import { ImportParseError, MAX_IMPORT_ROWS } from '../types';

async function xlsxBuf(header: string[], body: (string | number)[][]): Promise<ArrayBuffer> {
  return toWorkbookBuffer({ sheetName: 'Companies', header, body });
}

describe('parseWorkbook (unmocked exceljs)', () => {
  it('AC-IMP-001: parseWorkbook returns the headers + data rows from a real xlsx buffer', async () => {
    const buf = await xlsxBuf(
      ['Company name', 'Type'],
      [
        ['Acme Corp', 'Client'],
        ['Globex', 'Vendor'],
      ],
    );
    const sheet = await parseWorkbook(buf);
    expect(sheet.headers).toEqual(['Company name', 'Type']);
    expect(sheet.rows).toEqual([
      ['Acme Corp', 'Client'],
      ['Globex', 'Vendor'],
    ]);
  });

  it('AC-IMP-002a: a non-xlsx ArrayBuffer throws ImportParseError("not_xlsx")', async () => {
    const garbage = new TextEncoder().encode('this is not a workbook').buffer;
    await expect(parseWorkbook(garbage)).rejects.toMatchObject({
      name: 'ImportParseError',
      code: 'not_xlsx',
    });
  });

  it('AC-IMP-002b: a header-only sheet throws ImportParseError("empty")', async () => {
    const buf = await xlsxBuf(['Company name', 'Type'], []);
    await expect(parseWorkbook(buf)).rejects.toMatchObject({
      name: 'ImportParseError',
      code: 'empty',
    });
  });

  it('AC-IMP-002c: 501 data rows throws ImportParseError("too_many_rows")', async () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => [`Co ${i}`, 'Client']);
    const buf = await xlsxBuf(['Company name', 'Type'], body);
    await expect(parseWorkbook(buf)).rejects.toMatchObject({
      name: 'ImportParseError',
      code: 'too_many_rows',
    });
  });

  it('AC-IMP-002c: exactly MAX_IMPORT_ROWS data rows is accepted (boundary)', async () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => [`Co ${i}`, 'Client']);
    const buf = await xlsxBuf(['Company name', 'Type'], body);
    const sheet = await parseWorkbook(buf);
    expect(sheet.rows).toHaveLength(MAX_IMPORT_ROWS);
  });

  it('exposes ImportParseError with a typed code field', () => {
    const err = new ImportParseError('empty', 'x');
    expect(err.code).toBe('empty');
    expect(err).toBeInstanceOf(Error);
  });
});
