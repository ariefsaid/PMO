import { describe, expect, it } from 'vitest';
import { buildFxPreview } from '../fxRatePreview';
import type { FxParsed } from '../fxRateParser';

describe('JISDOR preview classification', () => {
  it('AC-FX-007 classifies new, changed and unchanged dates without mutation', () => {
    const parsed: FxParsed = {
      rows: [
        { rate_date: '2026-10-09', rate: 16234.56 },
        { rate_date: '2026-10-12', rate: 16400 },
        { rate_date: '2026-10-13', rate: 16500 },
      ],
      rejected: [{ row: 7, reason: 'invalidRate' }],
      duplicates: 1,
    };
    const existing = [
      { rate_date: '2026-10-09', rate: 16234.56 },
      { rate_date: '2026-10-12', rate: 16300 },
    ];
    const parsedBefore = structuredClone(parsed);
    const existingBefore = structuredClone(existing);
    expect(buildFxPreview(parsed, existing)).toEqual({
      ...parsed,
      new: 1,
      changed: 1,
      unchanged: 1,
      coverage: {
        firstDate: '2026-10-09',
        lastDate: '2026-10-13',
        missingDates: ['2026-10-10', '2026-10-11'],
      },
    });
    expect(parsed).toEqual(parsedBefore);
    expect(existing).toEqual(existingBefore);
  });
});

describe('S-38 preview coverage window (RF-054: Finance sees what the file actually covers)', () => {
  it('reports min→max over accepted rows only, ignoring rejected rows', () => {
    const parsed: FxParsed = {
      rows: [
        { rate_date: '2026-10-13', rate: 16500 },
        { rate_date: '2026-10-09', rate: 16234.56 },
      ],
      rejected: [{ row: 8, reason: 'invalidRate' }],
      duplicates: 0,
    };
    expect(buildFxPreview(parsed, []).coverage).toEqual({
      firstDate: '2026-10-09',
      lastDate: '2026-10-13',
      missingDates: ['2026-10-10', '2026-10-11', '2026-10-12'],
    });
  });

  it('continuous and single-date files have no gap note', () => {
    const continuous: FxParsed = {
      rows: [
        { rate_date: '2026-10-05', rate: 16000 },
        { rate_date: '2026-10-06', rate: 16010 },
        { rate_date: '2026-10-07', rate: 16020 },
      ],
      rejected: [],
      duplicates: 0,
    };
    expect(buildFxPreview(continuous, []).coverage.missingDates).toEqual([]);
    expect(buildFxPreview({ ...continuous, rows: [continuous.rows[0]] }, []).coverage.missingDates).toEqual([]);
  });

  it('a single publication yields first = last; no accepted rows yield nulls, never a guessed range', () => {
    const single: FxParsed = {
      rows: [{ rate_date: '2026-10-12', rate: 16400 }],
      rejected: [],
      duplicates: 0,
    };
    expect(buildFxPreview(single, []).coverage).toEqual({
      firstDate: '2026-10-12',
      lastDate: '2026-10-12',
      missingDates: [],
    });
    const allRejected: FxParsed = {
      rows: [],
      rejected: [{ row: 2, reason: 'invalidRate' }],
      duplicates: 0,
    };
    expect(buildFxPreview(allRejected, []).coverage).toEqual({
      firstDate: null,
      lastDate: null,
      missingDates: [],
    });
  });

  it('reports every absent calendar day without filling unpublished days or inventing a prior-day rate', () => {
    // Fri 2026-10-09 is real; Sat/Sun 10–11 are unpublished by JISDOR; Mon 10-12 is real.
    const parsed: FxParsed = {
      rows: [
        { rate_date: '2026-10-09', rate: 16234.56 },
        { rate_date: '2026-10-12', rate: 16400 },
      ],
      rejected: [],
      duplicates: 0,
    };
    const preview = buildFxPreview(parsed, []);
    expect(preview.rows.map((row) => row.rate_date)).toEqual(['2026-10-09', '2026-10-12']);
    expect(preview.coverage).toEqual({
      firstDate: '2026-10-09',
      lastDate: '2026-10-12',
      missingDates: ['2026-10-10', '2026-10-11'],
    });
    expect(preview.new).toBe(2);
  });
});
