import { describe, it, expect } from 'vitest';
import { AT_RISK_THRESHOLD } from './dashboardConstants';

describe('dashboardConstants — at-risk classification (canonical rule)', () => {
  it('AT_RISK_THRESHOLD is 0.9', () => {
    expect(AT_RISK_THRESHOLD).toBe(0.9);
  });

});
