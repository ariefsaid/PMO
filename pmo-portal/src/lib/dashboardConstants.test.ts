import { describe, it, expect } from 'vitest';
import { AT_RISK_THRESHOLD, riskCheckableFor } from './dashboardConstants';

describe('dashboardConstants — at-risk classification (canonical rule)', () => {
  it('AT_RISK_THRESHOLD is 0.9', () => {
    expect(AT_RISK_THRESHOLD).toBe(0.9);
  });

  it('AC-RD-RISK-001 requires a non-empty population and complete risk basis', () => {
    expect(riskCheckableFor(6, 0)).toBe(true);
    expect(riskCheckableFor(1, 1)).toBe(false);
    expect(riskCheckableFor(0, 0)).toBe(false);
  });

});
