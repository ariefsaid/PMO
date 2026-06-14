/**
 * AC-W2-3-03: Exported xlsx date cells are the correct local calendar day,
 * not the UTC-shifted previous day for behind-UTC users.
 *
 * Root cause: `new Date("2026-06-14")` parses YYYY-MM-DD as UTC midnight → in
 * a behind-UTC timezone (e.g. UTC-7) `getDate()` returns the 13th, so ExcelJS
 * serialises the wrong day number into the cell.
 *
 * Fix: `parseLocalDate("2026-06-14")` splits on `-` and constructs the Date via
 * `new Date(y, m-1, d)` — always LOCAL midnight regardless of TZ.
 *
 * Strategy: mock exceljs so we capture the Date object passed to `cell.value`.
 * Assert it is a LOCAL date whose `getDate()` / `getMonth()` / `getFullYear()`
 * match the ISO string, not UTC getUTCDate() / etc.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Capture the Date values passed to each cell ──────────────────────────────

const cellValues: unknown[] = [];
const mockCell = {
  set value(v: unknown) { cellValues.push(v); },
  numFmt: '',
};

vi.mock('exceljs', () => {
  const Row = {
    getCell: vi.fn(() => mockCell),
    set font(_f: unknown) { /* no-op */ },
  };
  const Worksheet = {
    addRow: vi.fn(() => Row),
  };
  class Workbook {
    addWorksheet() { return Worksheet; }
    xlsx = { writeBuffer: async () => new ArrayBuffer(4) };
  }
  // exceljs's default export is an object { Workbook, ... }
  // toWorkbookBuffer does: const ExcelJS = (await import('exceljs')).default
  //   then: new ExcelJS.Workbook()
  // So we need default = { Workbook: <class> }
  return { default: { Workbook } };
});

// Import AFTER mock is set up
import { toWorkbookBuffer } from '../toWorkbookBuffer';

describe('AC-W2-3-03: xlsx export date cell — no UTC day-shift', () => {
  beforeEach(() => {
    cellValues.length = 0;
  });

  it('sets cell.value to a LOCAL date whose calendar day matches the ISO string', async () => {
    await toWorkbookBuffer({
      sheetName: 'Test',
      header: ['Name', 'Date'],
      body: [['Project Alpha', '2026-06-14']],
    });

    // Find the Date objects among the captured cell values.
    const dates = cellValues.filter((v): v is Date => v instanceof Date);
    expect(dates.length).toBeGreaterThan(0);

    const d = dates[0];
    // LOCAL date components must match the ISO string "2026-06-14".
    // If new Date("2026-06-14") was used (UTC), in behind-UTC zones:
    //   d.getFullYear() → 2026, d.getMonth() → 5, d.getDate() → 13  ← WRONG
    // With parseLocalDate("2026-06-14") = new Date(2026, 5, 14):
    //   always → 2026, 5, 14  ← CORRECT
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);   // 0-based → June
    expect(d.getDate()).toBe(14);
  });

  it('does not affect non-date cells', async () => {
    await toWorkbookBuffer({
      sheetName: 'Test',
      header: ['Name'],
      body: [['Just a string'], ['not-a-date']],
    });

    // No dates should be captured for non-ISO-date values.
    const dates = cellValues.filter((v): v is Date => v instanceof Date);
    expect(dates.length).toBe(0);
  });
});
