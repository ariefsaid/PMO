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

it('rejects input over the compressed size limit before workbook parsing', async () => {
  await expect(parseWorkbook(new ArrayBuffer(5 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'fileTooLarge' });
});

it('bounds worksheet coordinates before reading a sparse worksheet', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await xlsxBuf(['Name'], [['A']]));
  const sheet = zip.file('xl/worksheets/sheet1.xml')!;
  const xml = await sheet.async('string');
  zip.file('xl/worksheets/sheet1.xml', xml.replace('r="A2"', 'r="A1048576"').replace('<row r="2"', '<row r="1048576"'));
  const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  await expect(parseWorkbook(buf)).rejects.toMatchObject({ code: 'too_many_rows' });
});

it('bounds expanded archive contents before workbook parsing', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await xlsxBuf(['Name'], [['A']]));
  zip.file('extra.xml', 'a'.repeat(25 * 1024 * 1024));
  const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  await expect(parseWorkbook(buf)).rejects.toMatchObject({ code: 'fileTooLarge' });
});

it('accepts 500 nonblank rows interspersed with blank rows', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getCell('A1').value = 'Name';
  for (let i = 0; i < 500; i += 1) ws.getCell(`A${2 + i * 2}`).value = `Row ${i}`;
  const buf = await wb.xlsx.writeBuffer();
  expect((await parseWorkbook(buf as ArrayBuffer)).rows).toHaveLength(500);
});

it('rejects a merge outside the worksheet bounds', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await xlsxBuf(['Name'], [['A']]));
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  zip.file('xl/worksheets/sheet1.xml', xml.replace('</worksheet>', '<mergeCells count="1"><mergeCell ref="A1:A1048576"/></mergeCells></worksheet>'));
  const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  await expect(parseWorkbook(buf)).rejects.toMatchObject({ code: 'too_many_rows' });
});

it('applies the expanded byte limit to streamed output even when the declared size is smaller', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await xlsxBuf(['Name'], [['A']]));
  zip.file('large.xml', 'x'.repeat(21 * 1024 * 1024));
  const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  for (let i = 0; i < bytes.length - 46; i += 1) {
    if (view.getUint32(i, true) === 0x02014b50) {
      const nameLength = view.getUint16(i + 28, true);
      if (new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + nameLength)) === 'large.xml') {
        view.setUint32(i + 24, 1, true);
        break;
      }
    }
  }
  await expect(parseWorkbook(buf)).rejects.toMatchObject({ code: 'fileTooLarge' });
});

it('bounds sparse column definitions before loading the workbook', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await xlsxBuf(['Name'], [['A']]));
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  zip.file('xl/worksheets/sheet1.xml', xml.replace('<sheetData>', '<cols><col min="1" max="16384"/></cols><sheetData>'));
  const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  await expect(parseWorkbook(buf)).rejects.toMatchObject({ code: 'too_many_columns' });
});

it('accepts an archive at the expanded byte boundary and rejects one byte over', async () => {
  const JSZip = (await import('jszip')).default;
  const source = await xlsxBuf(['Name'], [['A']]);
  const zip = await JSZip.loadAsync(source);
  let existing = 0;
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir) existing += (await entry.async('uint8array')).length;
  }
  const remaining = 20 * 1024 * 1024 - existing;
  zip.file('padding.txt', 'x'.repeat(remaining));
  const atLimit = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  expect((await parseWorkbook(atLimit)).rows).toEqual([['A']]);
  zip.file('padding.txt', 'x'.repeat(remaining + 1));
  const overLimit = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  await expect(parseWorkbook(overLimit)).rejects.toMatchObject({ code: 'fileTooLarge' });
}, 20000);

it('enforces physical row and column boundaries before materialization', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getCell('A1').value = 'Name';
  ws.getCell('CV1').value = 'Last';
  ws.getCell('A2000').value = 'last';
  const atLimit = await wb.xlsx.writeBuffer();
  expect((await parseWorkbook(atLimit as ArrayBuffer)).rows).toHaveLength(1);
  ws.getCell('A2001').value = 'over';
  await expect(parseWorkbook(await wb.xlsx.writeBuffer() as ArrayBuffer)).rejects.toMatchObject({ code: 'too_many_rows' });
  ws.getCell('A2001').value = null;
  ws.getCell('CW1').value = 'over';
  await expect(parseWorkbook(await wb.xlsx.writeBuffer() as ArrayBuffer)).rejects.toMatchObject({ code: 'too_many_columns' });
});
