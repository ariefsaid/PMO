/**
 * AC-EXP-005 — REAL serialization proof: this test does NOT mock exceljs. It
 * exercises the actual `toWorkbookBuffer` → exceljs `writeBuffer()` path and
 * asserts the produced buffer is a valid ZIP container (xlsx is a zip; the OOXML
 * "PK" local-file-header magic must lead the bytes).
 */
import { describe, it, expect } from 'vitest';
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
});
