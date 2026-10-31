import { describe, it, expect } from 'vitest';
import { formatQuantity, formatStockValue, isWholeQuantity } from './stockFormat';

describe('stockFormat', () => {
  it.each(['en', 'id'])('NFR-STK-007 a 14,3 decimal string keeps every digit in %s', (loc) => {
    const out = formatQuantity('1234567890.123', loc).replace(/\D/g, '');
    expect(out).toBe('1234567890123');
  });
  it('NFR-STK-007 a value past the float range is not rounded', () => {
    expect(formatQuantity('99999999999.999', 'en').replace(/\D/g, '')).toBe('99999999999999');
  });
  it('drops trailing zero fractions only', () => {
    expect(formatQuantity('70', 'en')).toBe('70');
    expect(formatQuantity('2.5', 'en')).toBe('2.5');
  });
  it('formats money exactly through the shared formatter and never fabricates a figure', () => {
    expect(formatStockValue('1500.00', 'IDR', 'en')).toContain('1,500');
    expect(formatStockValue(undefined, 'IDR', 'en')).toBe('');
  });
  it('isWholeQuantity is a string test', () => {
    expect(isWholeQuantity('3')).toBe(true);
    expect(isWholeQuantity('3.000')).toBe(true);
    expect(isWholeQuantity('3.5')).toBe(false);
    expect(isWholeQuantity('')).toBe(false);
  });
});
