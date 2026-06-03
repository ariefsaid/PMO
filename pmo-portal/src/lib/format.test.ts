import { describe, it, expect } from 'vitest';
import { formatCurrency } from './format';

describe('formatCurrency', () => {
  it('formats USD with no fraction digits (AC-410)', () => {
    expect(formatCurrency(5000000)).toBe('$5,000,000');
  });
  it('rounds to whole dollars', () => {
    expect(formatCurrency(1234.56)).toBe('$1,235');
  });
});
