import { describe, expect, it } from 'vitest';
import { formatNumber } from '@/src/lib/format';
import { formatCurrencyWithCode } from './format';

describe('formatCurrencyWithCode', () => {
  it('uses one ISO code and rounds to a whole unit', () => {
    expect(formatCurrencyWithCode(219_450.6, 'USD')).toBe(`USD ${formatNumber(219_451)}`);
    expect(formatCurrencyWithCode(219_450.6, 'USD')).not.toContain('$');
  });
});
