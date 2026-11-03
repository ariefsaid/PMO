import { describe, expect, it } from 'vitest';
import { formatTimeMaterialsAmount, formatTimeMaterialsNumber } from './dispatchRevenueFormatting.ts';

describe('time-materials invoice description formatting', () => {
  it('groups exact calculation numbers in the supplied number locale', () => {
    expect(formatTimeMaterialsNumber(1000.02, 'id-ID')).toBe('1.000,02');
    expect(formatTimeMaterialsNumber(1000.02, 'en-US')).toBe('1,000.02');
  });

  it('formats signed cents as the invoice currency in the supplied number locale', () => {
    expect(formatTimeMaterialsAmount('250.01', 'IDR', 'id-ID')).toBe('Rp\u00a0250,01');
    expect(formatTimeMaterialsAmount('250.01', 'IDR', 'en-US')).toBe('IDR\u00a0250.01');
  });

  it('falls back to a grouped number when the invoice currency is unavailable', () => {
    expect(formatTimeMaterialsAmount('1234.5', undefined, 'en-US')).toBe('1,234.5');
  });
});
