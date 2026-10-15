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
    });
    expect(parsed).toEqual(parsedBefore);
    expect(existing).toEqual(existingBefore);
  });
});
