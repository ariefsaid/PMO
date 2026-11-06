import { describe, expect, it } from 'vitest';
import { staleDistributionBasis } from './distributionStaleness';

const basis = {
  projectStart: '2026-01-01',
  projectEnd: '2026-12-31',
  years: [{ name: '2026', start: '2026-01-01', end: '2026-12-31' }],
};

describe('budget-whole-project FR-022 staleDistributionBasis', () => {
  it('is null while the project dates still match the saved basis', () => {
    expect(staleDistributionBasis(basis, '2026-01-01', '2026-12-31', null)).toBeNull();
  });
  it('names the new end date and the years the budget covers when the end moves', () => {
    expect(staleDistributionBasis(basis, '2026-01-01', '2027-12-31', null)).toEqual({ projectEnd: '2027-12-31', coveredYears: ['2026'] });
  });
  it('flags an open-ended project that gained an end, and the reverse', () => {
    expect(staleDistributionBasis({ ...basis, projectEnd: null }, '2026-01-01', '2026-12-31', null)).not.toBeNull();
    expect(staleDistributionBasis(basis, '2026-01-01', null, null)).not.toBeNull();
  });
  it('flags a changed live calendar even when the dates match', () => {
    const live = [{ name: 'FY26', start: '2026-01-01', end: '2026-12-31' }];
    expect(staleDistributionBasis(basis, '2026-01-01', '2026-12-31', live)).not.toBeNull();
    expect(staleDistributionBasis(basis, '2026-01-01', '2026-12-31', basis.years)).toBeNull();
  });
  it('does not guess when the live calendar cannot cover the span', () => {
    const gap = [{ name: '2025', start: '2025-01-01', end: '2025-12-31' }];
    expect(staleDistributionBasis(basis, '2026-01-01', '2026-12-31', gap)).toBeNull();
  });
});
