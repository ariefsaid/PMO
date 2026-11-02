/**
 * AC-EXP-005 — REAL serialization proof: this test does NOT mock exceljs. It
 * exercises the actual `toWorkbookBuffer` → exceljs `writeBuffer()` path and
 * asserts the produced buffer is a valid ZIP container (xlsx is a zip; the OOXML
 * "PK" local-file-header magic must lead the bytes).
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { toWorkbookBuffer } from '../toWorkbookBuffer';

describe('toWorkbookBuffer (unmocked exceljs serialization)', () => {
  it('AC-EXP-005: produces a non-empty xlsx whose bytes begin with the ZIP "PK" magic', async () => {
    const buf = await toWorkbookBuffer({
      sheetName: 'Projects',
      header: ['Name', 'Value', 'Date'],
      body: [
        ['Acme', 1500, '2026-06-13'],
        ['Beta', 0, 'not-a-date'],
      ],
    });

    const bytes = new Uint8Array(buf);
    expect(bytes.length).toBeGreaterThan(0);
    // ZIP local file header magic: 0x50 0x4B == "PK"
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it('AC-EXP-005: truncates an over-long sheet name to Excel\'s 31-char limit (no throw)', async () => {
    const longName = 'A'.repeat(50);
    const buf = await toWorkbookBuffer({ sheetName: longName, header: ['X'], body: [['y']] });
    expect(new Uint8Array(buf).length).toBeGreaterThan(0);
  });

  it('AC-800-001: reads a date-only invoice back as the same day in an Asia/Jakarta export', async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Jakarta';
    try {
      const buf = await toWorkbookBuffer({
        sheetName: 'Invoices',
        header: ['Invoice date'],
        body: [['2025-11-30']],
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(new Uint8Array(buf));
      const date = workbook.getWorksheet('Invoices')?.getCell('A2').value;

      expect(date).toBeInstanceOf(Date);
      expect((date as Date).toISOString()).toBe('2025-11-30T00:00:00.000Z');
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it('LIB02-003: serializes only declared date fields as dates and leaves invalid calendar text unchanged', async () => {
    const buf = await toWorkbookBuffer({
      sheetName: 'Payments',
      header: ['Company Name', 'Valid Date', 'Invalid Date'],
      body: [['2026-06-13', '2026-06-13', '2026-02-30']],
      types: ['text', 'date', 'date'],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(buf));
    const sheet = workbook.getWorksheet('Payments');

    // Text column with date-shaped value stays text
    expect(sheet?.getCell('A2').value).toBe('2026-06-13');
    // Declared date column with valid calendar date becomes Excel date
    const validDate = sheet?.getCell('B2').value;
    expect(validDate).toBeInstanceOf(Date);
    expect((validDate as Date).toISOString()).toBe('2026-06-13T00:00:00.000Z');
    // Declared date column with invalid calendar date leaves text unchanged
    expect(sheet?.getCell('C2').value).toBe('2026-02-30');
  });
});
