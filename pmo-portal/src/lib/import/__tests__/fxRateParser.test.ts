import { describe, expect, it } from 'vitest';
import { parseFxDate, parseFxRate, parseFxRows } from '../fxRateParser';
import type { WorkbookCell, WorkbookGrid } from '../readWorkbookGrid';

const cell = (value: string | number | Date | null, formula = false): WorkbookCell => ({
  text: value instanceof Date ? value.toISOString() : String(value ?? ''),
  value,
  formula,
});
const grid = (
  rows: (string | number | Date | null)[][],
  formulas: [number, number][] = [],
): WorkbookGrid => ({
  date1904: false,
  rows: rows.map((row, r) =>
    row.map((value, c) =>
      cell(
        value,
        formulas.some(([fr, fc]) => fr === r && fc === c),
      ),
    ),
  ),
});

describe('JISDOR input normalization', () => {
  it.each([
    [16234.56, 16234.56],
    ['16234', 16234],
    ['16234.56', 16234.56],
    ['16.234,56', 16234.56],
    ['16,234.56', 16234.56],
    ['16.234,00', 16234],
    ['16,234.00', 16234],
    ['16.234', 16234],
    ['16,234', 16234],
    ['1,000', 1000],
    ['100000', 100000],
  ])('parses %s as %s', (input, expected) => expect(parseFxRate(input)).toBe(expected));

  it.each([
    '16,23,4',
    '16.234.56',
    'NaN',
    'Infinity',
    '0',
    '-1',
    '16.2340000',
    '16234560',
    'Rp 16,234',
    '1e4',
    '16234.1234567',
  ])('rejects malformed or out-of-band rates %s', (input) => expect(parseFxRate(input)).toBeNull());

  it.each([
    ['2026-10-09', '2026-10-09'],
    ['09/10/2026', '2026-10-09'],
    ['09-10-2026', '2026-10-09'],
    ['9 Oktober 2026', '2026-10-09'],
    ['09 Oct 2026', '2026-10-09'],
    ['9 October 2026', '2026-10-09'],
    ['9 Okt 2026', '2026-10-09'],
    ['29 Februari 2024', '2024-02-29'],
  ])('parses calendar date %s', (input, expected) =>
    expect(parseFxDate(input, false, '2026-10-14')).toBe(expected),
  );

  it.each(['29 February 2026', '09/10', '2026-02-30', '2026-10-15'])(
    'rejects invalid or future date %s',
    (input) => expect(parseFxDate(input, false, '2026-10-14')).toBeNull(),
  );

  it('keeps organization calendar day independent of process timezone', () => {
    const previous = process.env.TZ;
    try {
      for (const timezone of ['UTC', 'Asia/Jakarta', 'America/New_York']) {
        process.env.TZ = timezone;
        expect(parseFxDate('09/10/2026', false, '2026-10-14')).toBe('2026-10-09');
      }
    } finally {
      process.env.TZ = previous;
    }
  });

  it('maps 1900 and 1904 serial epochs consistently and rejects the fictitious leap day', () => {
    expect(parseFxDate(46304, false, '2026-10-14')).toBe('2026-10-09');
    expect(parseFxDate(44842, true, '2026-10-14')).toBe('2026-10-09');
    expect(parseFxDate(60, false, '2026-10-14')).toBeNull();
    expect(parseFxDate(1.5, false, '2026-10-14')).toBeNull();
  });

  it('AC-FX-005: finds the one BI header, preserves physical rows and ignores blank lines', () => {
    const parsed = parseFxRows(
      grid([
        ['BANK INDONESIA', null],
        ['JISDOR Daily', null],
        ['Published rates', null],
        ['Tanggal', 'Kurs JISDOR'],
        ['2026-10-09', '16.234,56'],
        [null, null],
        ['2026-10-12', 16300],
        ['Footer total', '—'],
      ]),
      '2026-10-14',
    );
    expect(parsed.rows).toEqual([
      { rate_date: '2026-10-09', rate: 16234.56 },
      { rate_date: '2026-10-12', rate: 16300 },
    ]);
    expect(parsed.rejected).toEqual([{ row: 8, value: 'Footer total', reason: 'invalidDate' }]);
  });

  it('AC-FX-006: collapses identical dates and rejects every contributor to a conflict', () => {
    const equal = parseFxRows(
      grid([
        ['date', 'rate'],
        ['2026-10-09', '16,234.56'],
        ['09/10/2026', 16234.56],
      ]),
      '2026-10-14',
    );
    expect(equal.rows).toHaveLength(1);
    expect(equal.duplicates).toBe(1);
    const conflict = parseFxRows(
      grid([
        ['date', 'rate'],
        ['2026-10-09', 16234],
        ['2026-10-09', 16300],
      ]),
      '2026-10-14',
    );
    expect(conflict.rows).toEqual([]);
    expect(conflict.rejected).toEqual([
      { row: 2, value: '16234', reason: 'duplicateDate' },
      { row: 3, value: '16300', reason: 'duplicateDate' },
    ]);
  });

  it('rejects ambiguous header candidates and formulas without evaluating them', () => {
    expect(
      parseFxRows(
        grid([
          ['date', 'rate', 'tanggal'],
          ['2026-10-09', 16234, '2026-10-09'],
        ]),
        '2026-10-14',
      ).rejected[0],
    ).toEqual({ row: 1, reason: 'ambiguousHeader' });
    const result = parseFxRows(
      grid(
        [
          ['date', 'rate'],
          ['2026-10-09', 16234],
        ],
        [[1, 1]],
      ),
      '2026-10-14',
    );
    expect(result.rejected).toEqual([{ row: 2, value: '16234', reason: 'formula' }]);
  });
});
