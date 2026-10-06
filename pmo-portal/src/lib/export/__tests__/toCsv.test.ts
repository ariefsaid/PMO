import { describe, it, expect } from 'vitest';
import { toCsv } from '../toCsv';
import { exportFilename } from '../exportFilename';

describe('toCsv (RFC 4180 + CSV-injection guard)', () => {
  it('AC-MMP-011: BOM, CRLF, numbers raw, quoting for commas, quotes and newlines', () => {
    const out = toCsv({ header: ['Project', 'Amount'], body: [['A, "B"', 1234.5], ['line\nbreak', -3]] });
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('Project,Amount\r\n"A, ""B""",1234.5\r\n"line\nbreak",-3\r\n');
  });

  it('AC-MMP-011: a text cell a spreadsheet would run as a formula is neutralised', () => {
    const out = toCsv({ header: ['x'], body: [['=SUM(A1)'], ['+1'], ['-2'], ['@x']] });
    expect(out.slice(1).split('\r\n').slice(1, 5)).toEqual(["'=SUM(A1)", "'+1", "'-2", "'@x"]);
  });

  it('AC-MMP-011: export file names take an extension; xlsx stays the default', () => {
    const d = new Date('2026-10-06T09:00:00');
    expect(exportFilename('Management-pack_2026-09', d, 'csv')).toBe('Management-pack_2026-09_2026-10-06.csv');
    expect(exportFilename('Companies', d)).toBe('Companies_2026-10-06.xlsx');
  });
});
