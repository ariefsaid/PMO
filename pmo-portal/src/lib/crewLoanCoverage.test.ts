import { describe, expect, it } from 'vitest';
import { uncoveredLoanDays } from './crewLoanCoverage';

describe('AC-SD-002 uncoveredLoanDays', () => {
  it('lists the days the host crew is on no work order', () => {
    expect(uncoveredLoanDays('2026-01-01', '2026-01-04', [{ valid_from: '2026-01-02', valid_to: '2026-01-03' }]))
      .toEqual(['2026-01-01', '2026-01-04']);
  });
  it('an open-ended schedule covers every later day; no schedule covers none', () => {
    expect(uncoveredLoanDays('2026-01-05', '2026-01-06', [{ valid_from: '2026-01-01', valid_to: null }])).toEqual([]);
    expect(uncoveredLoanDays('2026-01-05', '2026-01-06', [])).toEqual(['2026-01-05', '2026-01-06']);
  });
});
