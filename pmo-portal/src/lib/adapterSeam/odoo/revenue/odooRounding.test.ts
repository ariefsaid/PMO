import { describe, expect, it } from 'vitest';
import {
  odooCurrencyAmountsEqual,
  odooFloatRound,
  odooLineSubtotal,
} from './odooRounding.ts';

describe('Odoo rounding', () => {
  it('rounds by decimal digits or a currency increment', () => {
    expect(odooFloatRound(2.5, { precisionDigits: 0 })).toBe(3);
    expect(odooFloatRound(0.075, { precisionRounding: 0.05 })).toBe(0.1);
    expect(odooFloatRound(1.6, { precisionRounding: 1 })).toBe(2);
    expect(odooFloatRound(0, { precisionRounding: 0.01 })).toBe(0);
  });

  it('rounds exact half-up ties away from zero', () => {
    expect(odooFloatRound(0.025, { precisionDigits: 2 })).toBe(0.03);
    expect(odooFloatRound(-0.025, { precisionDigits: 2 })).toBe(-0.03);
  });

  it('uses Odoo epsilon to round a binary value just below the decimal tie', () => {
    expect(odooFloatRound(1.005, { precisionDigits: 2 })).toBe(1.01);
  });

  it('rounds quantity before multiplying by the unrounded unit price', () => {
    expect(odooLineSubtotal(0.333, 1_000.01, 0.01, 0.01)).toBe(330);
    expect(odooLineSubtotal(12.345, 1_000_000, 0.01, 0.01)).toBe(12_350_000);
    expect(odooLineSubtotal(1.001, 11_000_000_164.99, 0.001, 0.01)).toBe(11_011_000_165.16);
  });

  it('signals reshape when Odoo would post a different signed amount and keep when it matches', () => {
    const signedAmount = odooFloatRound(0.333 * 1_000.01, { precisionDigits: 2 });
    const postedAtOriginalQuantity = odooLineSubtotal(0.333, 1_000.01, 0.01, 0.01);

    expect(signedAmount).toBe(333);
    expect(postedAtOriginalQuantity).toBe(330);
    expect(odooCurrencyAmountsEqual(postedAtOriginalQuantity, signedAmount, 0.01)).toBe(false);

    const postedAfterReshape = odooLineSubtotal(1, signedAmount, 0.01, 0.01);
    expect(postedAfterReshape).toBe(333);
    expect(odooCurrencyAmountsEqual(postedAfterReshape, signedAmount, 0.01)).toBe(true);
  });

  it('refuses invalid precision and values that cannot be rounded finitely', () => {
    expect(() => odooFloatRound(1, { precisionRounding: 0 })).toThrow(RangeError);
    expect(() => odooFloatRound(1, { precisionRounding: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => odooFloatRound(1, { precisionDigits: -1 })).toThrow(RangeError);
    expect(() => odooFloatRound(1, { precisionDigits: 1.5 })).toThrow(RangeError);
    expect(() => odooFloatRound(1, {})).toThrow(TypeError);
    expect(() => odooFloatRound(1, { precisionDigits: 2, precisionRounding: 0.01 })).toThrow(TypeError);
    expect(() => odooFloatRound(Number.POSITIVE_INFINITY, { precisionDigits: 2 })).toThrow(RangeError);
    expect(() => odooFloatRound(Number.MAX_VALUE, { precisionDigits: 2 })).toThrow(RangeError);
  });
});
