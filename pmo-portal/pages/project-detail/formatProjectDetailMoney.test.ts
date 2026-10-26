import { describe, expect, it } from 'vitest';
import { formatProjectDetailAmount, formatProjectDetailMoney } from './formatProjectDetailMoney';

describe('formatProjectDetailMoney', () => {
  it('omits a zero fraction while preserving non-zero cents and large exact amounts', () => {
    expect(formatProjectDetailMoney('100.00', 'IDR', 'en-US')).not.toMatch(/[,.]00/);
    expect(formatProjectDetailMoney('100.25', 'IDR', 'en-US')).toContain('.25');
    expect(formatProjectDetailMoney('100.00', 'USD', 'en-US')).toBe('$100');
    expect(formatProjectDetailMoney('100.25', 'USD', 'en-US')).toBe('$100.25');
    expect(formatProjectDetailMoney('9007199254740993.99', 'USD', 'en-US'))
      .toBe('$9,007,199,254,740,993.99');
  });

  it('formats finite numeric values to the stored two-decimal scale and rejects invalid money', () => {
    expect(formatProjectDetailMoney(1_000_000.5, 'USD', 'en-US')).toBe('$1,000,000.50');
    expect(formatProjectDetailMoney(Number.NaN, 'USD', 'en-US')).toBeNull();
    expect(formatProjectDetailMoney('1.005', 'USD', 'en-US')).toBeNull();
  });

  it('formats exact values without a currency mark for currency-named groups', () => {
    expect(formatProjectDetailAmount('100.00', 'USD', 'en-US')).toBe('100');
    expect(formatProjectDetailAmount('100.25', 'USD', 'en-US')).toBe('100.25');
    expect(formatProjectDetailAmount('2226648000.00', 'IDR', 'en-US')).toBe('2,226,648,000');
    expect(formatProjectDetailAmount('2226648000.00', 'IDR', 'id-ID')).toBe('2.226.648.000');
    expect(formatProjectDetailAmount('9007199254740993.99', 'USD', 'en-US'))
      .toBe('9,007,199,254,740,993.99');
  });
});
