import { describe, expect, it } from 'vitest';
import { parseExactCents } from '../exactDecimal.ts';
import {
  allocate,
  byDays,
  fromAmounts,
  fromPercents,
  yearsInSpan,
  type FiscalYearSpan,
} from './budgetDistribution';

const cal = (rows: [string, string, string][]): FiscalYearSpan[] =>
  rows.map(([name, start, end]) => ({ name, start, end }));

const CAL = cal([
  ['2027', '2027-01-01', '2027-12-31'],
  ['2028', '2028-01-01', '2028-12-31'],
]);

describe('budget-whole-project distribution', () => {
  it('budget-whole-project AC-002 by-days over a year boundary: 300 minor units split 100/200', () => {
    const years = yearsInSpan('2027-12-31', '2028-01-02', CAL);
    expect(byDays('3.00', '2027-12-31', '2028-01-02', years).map((row) => row.amount)).toEqual([
      '1.00',
      '2.00',
    ]);
  });

  it('budget-whole-project AC-003 leap day and non-calendar FY allocate the rounding remainder to the largest fraction', () => {
    const fiscalYears = cal([
      ['FY27', '2027-03-01', '2028-02-29'],
      ['FY28', '2028-03-01', '2029-02-28'],
    ]);
    const years = yearsInSpan('2028-02-28', '2028-03-01', fiscalYears);
    expect(byDays('10.00', '2028-02-28', '2028-03-01', years).map((row) => row.amount)).toEqual([
      '6.67',
      '3.33',
    ]);
  });

  it('budget-whole-project AC-003 single-day project lands entirely in one fiscal year', () => {
    const years = yearsInSpan('2027-06-01', '2027-06-01', CAL);
    expect(byDays('5.00', '2027-06-01', '2027-06-01', years).map((row) => row.amount)).toEqual([
      '5.00',
    ]);
  });

  it('budget-whole-project AC-003 exact allocation ties go to the earlier fiscal year', () => {
    expect(allocate(101n, [1n, 1n]).map(String)).toEqual(['51', '50']);
  });

  it('budget-whole-project AC-003 an open-ended project uses only the fiscal year containing its start', () => {
    expect(yearsInSpan('2027-06-01', null, CAL).map((year) => year.name)).toEqual(['2027']);
  });

  it('budget-whole-project AC-004 percentages 0/40/60 keep the zero year', () => {
    const years = cal([
      ['A', '2026-01-01', '2026-12-31'],
      ['B', '2027-01-01', '2027-12-31'],
      ['C', '2028-01-01', '2028-12-31'],
    ]);
    const result = fromPercents('10.00', ['0', '40', '60'], years);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.rows.map((row) => row.amount)).toEqual(['0.00', '4.00', '6.00']);
  });

  it('budget-whole-project AC-004 percentages allocate exact minor units and preserve zero-total rows', () => {
    const result = fromPercents('0.00', ['33.3333', '66.6667'], CAL);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.rows.map((row) => row.amount)).toEqual(['0.00', '0.00']);
  });

  it('budget-whole-project AC-004 amounts must equal the category total; negative and invalid inputs are named', () => {
    const years = cal([
      ['A', '2026-01-01', '2026-12-31'],
      ['B', '2027-01-01', '2027-12-31'],
    ]);
    expect(fromAmounts('10.00', ['4.00', '5.00'], years)).toMatchObject({
      ok: false,
      errors: [{ code: 'sum-mismatch' }],
    });
    expect(fromAmounts('10.00', ['-1.00', '11.00'], years)).toMatchObject({
      ok: false,
      errors: [{ year: 'A', code: 'negative' }],
    });
    expect(fromAmounts('10.00', ['x', '10.00'], years)).toMatchObject({
      ok: false,
      errors: [{ year: 'A', code: 'invalid' }],
    });
  });

  it('budget-whole-project AC-004 budget-wide amounts become proportions for categories with another total', () => {
    const years = cal([
      ['A', '2026-01-01', '2026-12-31'],
      ['B', '2027-01-01', '2027-12-31'],
    ]);
    expect(fromAmounts('20.00', ['4.00', '6.00'], years, { proportional: true })).toMatchObject({
      ok: true,
    });
  });

  it('budget-whole-project AC-004 proportional amounts allocate the category total exactly and retain zero-weight years', () => {
    const years = cal([
      ['A', '2026-01-01', '2026-12-31'],
      ['B', '2027-01-01', '2027-12-31'],
      ['C', '2028-01-01', '2028-12-31'],
    ]);
    const result = fromAmounts('10.00', ['0.00', '1.00', '2.00'], years, { proportional: true });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.rows.map((row) => row.amount)).toEqual(['0.00', '3.33', '6.67']);
  });

  it('budget-whole-project AC-004 reports missing, negative, invalid, and out-of-range percent inputs by year', () => {
    const years = cal([
      ['A', '2026-01-01', '2026-12-31'],
      ['B', '2027-01-01', '2027-12-31'],
      ['C', '2028-01-01', '2028-12-31'],
    ]);
    expect(fromPercents('1.00', ['', '-1', 'x'], years)).toMatchObject({
      ok: false,
      errors: [
        { year: 'A', code: 'missing' },
        { year: 'B', code: 'negative' },
        { year: 'C', code: 'invalid' },
      ],
    });
    expect(fromPercents('1.00', ['101', '0', '0'], years)).toMatchObject({
      ok: false,
      errors: [{ year: 'A', code: 'out-of-range' }],
    });
  });

  it('budget-whole-project AC-004 rejects percentages that do not sum to 100 and input counts outside the span', () => {
    expect(fromPercents('1.00', ['40', '50'], CAL)).toMatchObject({
      ok: false,
      errors: [{ code: 'sum-mismatch' }],
    });
    expect(fromPercents('1.00', ['100'], CAL)).toMatchObject({
      ok: false,
      errors: [{ code: 'out-of-range' }],
    });
  });

  it('budget-whole-project AC-004 rejects distribution years that are not in calendar order', () => {
    expect(fromPercents('10.00', ['40', '60'], [CAL[1], CAL[0]])).toMatchObject({
      ok: false,
      errors: [{ code: 'out-of-range' }],
    });
  });

  it('budget-whole-project AC-004 rejects invalid or negative category totals before distributing', () => {
    expect(fromPercents('not-money', ['50', '50'], CAL)).toMatchObject({
      ok: false,
      errors: [{ code: 'invalid' }],
    });
    expect(fromAmounts('-1.00', ['0.00', '0.00'], CAL)).toMatchObject({
      ok: false,
      errors: [{ code: 'negative' }],
    });
  });

  it('budget-whole-project AC-004 rejects amounts with missing values, the wrong row count, or no proportional weight', () => {
    expect(fromAmounts('1.00', ['', '1.00'], CAL)).toMatchObject({
      ok: false,
      errors: [{ year: '2027', code: 'missing' }],
    });
    expect(fromAmounts('1.00', ['1.00'], CAL)).toMatchObject({
      ok: false,
      errors: [{ code: 'out-of-range' }],
    });
    expect(fromAmounts('1.00', ['0.00', '0.00'], CAL, { proportional: true })).toMatchObject({
      ok: false,
      errors: [{ code: 'sum-mismatch' }],
    });
  });

  it('budget-whole-project AC-003 span selection is calendar ordered and inclusive at fiscal-year boundaries', () => {
    const unordered = [CAL[1], CAL[0]];
    expect(yearsInSpan('2027-12-31', '2028-01-01', unordered).map((year) => year.name)).toEqual([
      '2027',
      '2028',
    ]);
  });

  it('budget-whole-project AC-003 span validation rejects invalid dates, reversed ranges, gaps, and overlaps', () => {
    expect(() => yearsInSpan('2027-02-29', '2027-03-01', CAL)).toThrow();
    expect(() => yearsInSpan('2028-01-01', '2027-12-31', CAL)).toThrow();
    expect(() =>
      yearsInSpan('2027-12-31', '2028-01-02', [CAL[0], { ...CAL[1], start: '2028-01-02' }]),
    ).toThrow();
    expect(() =>
      yearsInSpan('2027-12-31', '2028-01-02', [CAL[0], { ...CAL[1], start: '2027-12-31' }]),
    ).toThrow();
  });

  it('budget-whole-project AC-003 span validation rejects a missing start year and duplicate selected year names', () => {
    expect(() => yearsInSpan('2029-01-01', '2029-01-02', CAL)).toThrow();
    expect(() =>
      yearsInSpan('2027-12-31', '2028-01-01', [CAL[0], { ...CAL[1], name: '2027' }]),
    ).toThrow();
  });

  it('budget-whole-project AC-003 span validation rejects missing calendar coverage and blank fiscal-year names', () => {
    expect(() => yearsInSpan('2026-12-31', '2027-01-02', [CAL[0]])).toThrow();
    expect(() =>
      yearsInSpan('2027-01-01', '2027-01-02', [{ ...CAL[0], name: '  ' }]),
    ).toThrow();
  });

  it('budget-whole-project AC-002 by-days rejects an invalid total or a fiscal-year list that does not cover the span', () => {
    const years = yearsInSpan('2027-12-31', '2028-01-02', CAL);
    expect(() => byDays('-1.00', '2027-12-31', '2028-01-02', years)).toThrow();
    expect(() => byDays('1.00', '2027-12-31', '2028-01-02', [CAL[0]])).toThrow();
    expect(() => byDays('1.00', '2027-12-31', '2028-01-02', [])).toThrow();
    expect(() => byDays('invalid', '2027-12-31', '2028-01-02', years)).toThrow();
    expect(() => byDays('1.00', 'not-a-date', '2028-01-02', years)).toThrow();
  });

  it('budget-whole-project AC-003 allocation conserves minor units for varied non-negative weights and keeps zero weights at zero', () => {
    const cases: [bigint, bigint[]][] = [
      [0n, [1n, 2n, 3n]],
      [1n, [0n, 1n, 0n]],
      [101n, [1n, 1n]],
      [99999n, [7n, 0n, 11n, 13n]],
      [100000000000000000000n, [3n, 5n, 8n]],
    ];
    for (const [total, weights] of cases) {
      const result = allocate(total, weights);
      expect(result.reduce((sum, value) => sum + value, 0n)).toBe(total);
      result.forEach((value, index) => {
        expect(value).toBeGreaterThanOrEqual(0n);
        if (weights[index] === 0n) expect(value).toBe(0n);
      });
    }
  });

  it('budget-whole-project AC-003 allocation conserves every total from zero through 1000 for a range of weight shapes', () => {
    for (let total = 0n; total <= 1000n; total += 1n) {
      const weights = [0n, total % 17n, (total * 7n) % 23n, 1n];
      const result = allocate(total, weights);
      expect(result.reduce((sum, value) => sum + value, 0n)).toBe(total);
      expect(result[0]).toBe(0n);
    }
  });

  it('budget-whole-project AC-002 by-days conserves every minor unit across inclusive spans, including leap-day boundaries', () => {
    const calendar = cal([
      ['2026', '2026-01-01', '2026-12-31'],
      ['2027', '2027-01-01', '2027-12-31'],
      ['2028', '2028-01-01', '2028-12-31'],
      ['2029', '2029-01-01', '2029-12-31'],
    ]);
    const boundaries = [
      '2026-01-01',
      '2026-02-28',
      '2027-06-15',
      '2027-12-31',
      '2028-02-29',
      '2028-12-31',
      '2029-12-31',
    ];
    for (let startIndex = 0; startIndex < boundaries.length; startIndex += 1) {
      for (let endIndex = startIndex; endIndex < boundaries.length; endIndex += 1) {
        const start = boundaries[startIndex];
        const end = boundaries[endIndex];
        const years = yearsInSpan(start, end, calendar);
        const rows = byDays('123456789.01', start, end, years);
        const allocated = rows.reduce((sum, row) => sum + parseExactCents(row.amount)!, 0n);
        expect(allocated).toBe(12_345_678_901n);

        const zeroRows = byDays('0.00', start, end, years);
        expect(zeroRows.every((row) => row.amount === '0.00')).toBe(true);
      }
    }
  });

  it('budget-whole-project AC-003 allocation rejects negative totals, negative weights, and an all-zero weight span', () => {
    expect(() => allocate(-1n, [1n])).toThrow();
    expect(() => allocate(1n, [-1n, 2n])).toThrow();
    expect(() => allocate(1n, [0n, 0n])).toThrow();
    expect(() => allocate(1n, [])).toThrow();
  });
});
