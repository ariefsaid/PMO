import { describe, it, expect } from 'vitest';
import { certificateLineAmount, certificateNet, subtractMoney, sumMoney } from './certificateMath';

/** #2584 AC-SPC-001/002/003: the figures are exact decimals, never floats; the rule is the shipped bill-line rule. */
describe('certificate figures', () => {
  it('AC-SPC-003 3.333 x 9.99 is exactly 33.30 (33.29667 rounds half away from zero)', () => {
    expect(certificateLineAmount('3.333', '9.99')).toBe('33.30');
  });
  it('AC-SPC-003 a float would be wrong where the decimal rule is right (0.1 + 0.2 style)', () => {
    expect(3.333 * 9.99).not.toBe(33.30);
    expect(certificateLineAmount('0.1', '0.2')).toBe('0.02');
    expect(certificateLineAmount('1.005', '1')).toBe('1.01');   // half away from zero, not banker's rounding
    expect(certificateLineAmount('2.5', '0.01')).toBe('0.03');
  });
  it('AC-SPC-001 the hand-calculation month: A 400.00, B 105.00, C 33.30, gross 538.30', () => {
    const amounts = [certificateLineAmount('40.000', '10.00'), certificateLineAmount('12.500', '8.40'), certificateLineAmount('3.333', '9.99')];
    expect(amounts).toEqual(['400.00', '105.00', '33.30']);
    expect(sumMoney(amounts)).toBe('538.30');
  });
  it('AC-SPC-002 gross 538.30 less a 38.30 backcharge is exactly 500.00', () => {
    expect(certificateNet('538.30', ['38.30'])).toEqual({ net: '500.00', negative: false });
  });
  it('AC-SPC-015 backcharges above gross make the net negative', () => {
    expect(certificateNet('10.00', ['600.00'])).toEqual({ net: '-590.00', negative: true });
  });
  it('whole-number and short-scale inputs are padded to 2 decimals; bad input throws', () => {
    expect(certificateLineAmount('5', '12')).toBe('60.00');
    expect(subtractMoney('10', '0.5')).toBe('9.50');
    expect(() => certificateLineAmount('x', '1')).toThrow();
    expect(() => sumMoney(['1.234'])).toThrow();
  });
});
