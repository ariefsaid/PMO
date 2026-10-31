import { describe, it, expect } from 'vitest';
import { formatQuantity, formatStockValue, isWholeQuantity, subtractDecimal } from './stockFormat';

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
    expect(formatStockValue(null, 'IDR', 'en')).toBe(''); // zero-stock rows carry avg_cost null: no made-up IDR 0
  });
  it('isWholeQuantity is a string test', () => {
    expect(isWholeQuantity('3')).toBe(true);
    expect(isWholeQuantity('3.000')).toBe(true);
    expect(isWholeQuantity('3.5')).toBe(false);
    expect(isWholeQuantity('')).toBe(false);
  });
  it('FR-STK-025 subtractDecimal is exact string arithmetic at 3 decimals (no float)', () => {
    expect(subtractDecimal('92', '100.000')).toBe('-8');
    expect(subtractDecimal('110', '100')).toBe('10');
    expect(subtractDecimal('0.1', '0.3')).toBe('-0.2');
    expect(subtractDecimal('99999999999.999', '0.001')).toBe('99999999999.998');
    expect(subtractDecimal('7.5', '7.500')).toBe('0');
    expect(subtractDecimal('0', '2.25')).toBe('-2.25');
  });
});
