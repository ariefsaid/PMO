import { describe, it, expect } from 'vitest';
import {
  isAtRisk,
  isAtRiskByCommitted,
  AT_RISK_THRESHOLD,
  ACTIVE_PROJECT_STATUSES,
} from './dashboardConstants';

describe('dashboardConstants — at-risk classification (canonical rule)', () => {
  it('AT_RISK_THRESHOLD is 0.9', () => {
    expect(AT_RISK_THRESHOLD).toBe(0.9);
  });

  describe('isAtRisk (budget basis: status + budget>0 + spent/budget >= 0.9)', () => {
    it('true at exactly 90% (>= boundary, inclusive)', () => {
      expect(isAtRisk({ status: 'Ongoing Project', budget: 100, spent: 90 })).toBe(true);
    });

    it('false just below 90% (89.99%)', () => {
      expect(isAtRisk({ status: 'Ongoing Project', budget: 10000, spent: 8999 })).toBe(false);
    });

    it('false when budget is 0 (no divide-by-zero / Infinity)', () => {
      expect(isAtRisk({ status: 'Ongoing Project', budget: 0, spent: 50 })).toBe(false);
    });

    it('false when status is inactive (e.g. Close Out)', () => {
      expect(isAtRisk({ status: 'Close Out', budget: 100, spent: 95 })).toBe(false);
    });
  });

  describe('isAtRiskByCommitted (committed basis: status + budget>0 + committedSpend/budget >= 0.9)', () => {
    it('true at exactly 90% (>= boundary, inclusive)', () => {
      expect(
        isAtRiskByCommitted({ status: 'Ongoing Project', budget: 100, committedSpend: 90 }),
      ).toBe(true);
    });

    it('false just below 90% (89.99%)', () => {
      expect(
        isAtRiskByCommitted({ status: 'Ongoing Project', budget: 10000, committedSpend: 8999 }),
      ).toBe(false);
    });

    it('false when budget is 0 (no divide-by-zero / Infinity)', () => {
      expect(
        isAtRiskByCommitted({ status: 'Ongoing Project', budget: 0, committedSpend: 50 }),
      ).toBe(false);
    });

    it('false when status is inactive (e.g. Close Out)', () => {
      expect(
        isAtRiskByCommitted({ status: 'Close Out', budget: 100, committedSpend: 95 }),
      ).toBe(false);
    });

    it('true for every active status above threshold', () => {
      for (const status of ACTIVE_PROJECT_STATUSES) {
        expect(isAtRiskByCommitted({ status, budget: 100, committedSpend: 95 })).toBe(true);
      }
    });
  });
});
