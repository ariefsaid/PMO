import { describe, expect, it } from 'vitest';
import { calculateStandaloneTax, parseTaxBaseFraction, parseStandaloneTaxFacts } from './taxTreatment';

describe('reduced tax base', () => {
  it('AC-DPP-001: a stated nominal rate calculates the tax facts a form persists', () => {
    expect(parseStandaloneTaxFacts('exclusive', '', '1000', '12', '11/12')).toEqual({
      taxTreatment: 'exclusive', taxAmount: 110, taxRate: 12,
      taxBaseNumerator: 11, taxBaseDenominator: 12,
    });
    expect(parseStandaloneTaxFacts('inclusive', '', '1110', '12', '11/12')?.taxAmount).toBe(110);
  });

  it('AC-DPP-001: an unknown nominal rate preserves a stated manual tax amount', () => {
    expect(parseStandaloneTaxFacts('inclusive', '123.45', '1110', '', '')).toEqual({
      taxTreatment: 'inclusive', taxAmount: 123.45, taxRate: null,
      taxBaseNumerator: 1, taxBaseDenominator: 1,
    });
    expect(parseStandaloneTaxFacts('exclusive', '0', '', '', '11/12')?.taxAmount).toBe(0);
  });

  it('AC-DPP-001: invalid rate or fraction blocks form submission rather than falling back to manual tax', () => {
    expect(parseStandaloneTaxFacts('exclusive', '110', '1000', '12.0001', '11/12')).toBeNull();
    expect(parseStandaloneTaxFacts('exclusive', '110', '1000', '12', '11/0')).toBeNull();
    expect(parseStandaloneTaxFacts('exclusive', '110', '', '12', '11/12')).toBeNull();
  });
  it('AC-DPP-001: keeps the authored fraction and defaults an omitted fraction to the full base', () => {
    expect(parseTaxBaseFraction('11/12')).toEqual({ numerator: 11, denominator: 12 });
    expect(parseTaxBaseFraction(' 11 / 12 ')).toEqual({ numerator: 11, denominator: 12 });
    expect(parseTaxBaseFraction('6/12')).toEqual({ numerator: 6, denominator: 12 });
    expect(parseTaxBaseFraction()).toEqual({ numerator: 1, denominator: 1 });
    expect(parseTaxBaseFraction('')).toEqual({ numerator: 1, denominator: 1 });
    expect(parseTaxBaseFraction('1')).toEqual({ numerator: 1, denominator: 1 });
  });

  it.each(['0/12', '11/0', '-11/12', '13/12', '0.5', '1/2/3', 'abc', '2147483648/2147483648'])(
    'AC-DPP-001: refuses invalid or unrepresentable fraction %s',
    (raw) => expect(parseTaxBaseFraction(raw)).toBeNull(),
  );

  it('AC-DPP-001: calculates nominal 12% on DPP 11/12 for an exclusive price', () => {
    expect(calculateStandaloneTax(1000, 'exclusive', 12, { numerator: 11, denominator: 12 }))
      .toEqual({ netAmount: 1000, taxAmount: 110, grossAmount: 1110 });
    expect(calculateStandaloneTax(1000, 'exclusive', 12))
      .toEqual({ netAmount: 1000, taxAmount: 120, grossAmount: 1120 });
  });

  it('AC-DPP-001: extracts reduced-base tax from an inclusive ceiling without taxing the tax', () => {
    expect(calculateStandaloneTax(1110, 'inclusive', 12, { numerator: 11, denominator: 12 }))
      .toEqual({ netAmount: 1000, taxAmount: 110, grossAmount: 1110 });
    expect(calculateStandaloneTax(1120, 'inclusive', 12))
      .toEqual({ netAmount: 1000, taxAmount: 120, grossAmount: 1120 });
  });

  it('AC-DPP-001: rounds the final tax to cents using exact decimal half-up arithmetic', () => {
    expect(calculateStandaloneTax(1.15, 'exclusive', 10))
      .toEqual({ netAmount: 1.15, taxAmount: 0.12, grossAmount: 1.27 });
    expect(calculateStandaloneTax(0.05, 'inclusive', 100))
      .toEqual({ netAmount: 0.02, taxAmount: 0.03, grossAmount: 0.05 });
    expect(calculateStandaloneTax(1, 'exclusive', 12, { numerator: 1, denominator: 3 }))
      .toEqual({ netAmount: 1, taxAmount: 0.04, grossAmount: 1.04 });
    expect(calculateStandaloneTax(100, 'exclusive', 12.125))
      .toEqual({ netAmount: 100, taxAmount: 12.13, grossAmount: 112.13 });
  });
  it('AC-DPP-001: a rational value just below half a cent never rounds up through intermediate division', () => {
    expect(calculateStandaloneTax(425917589.99, 'exclusive', 12,
      { numerator: 2147483646, denominator: 2147483647 })).toEqual({
      netAmount: 425917589.99, taxAmount: 51110110.77, grossAmount: 477027700.76,
    });
  });

  it('AC-DPP-001: preserves zero tax and exact cents for large values', () => {
    expect(calculateStandaloneTax(0, 'exclusive', 12, { numerator: 11, denominator: 12 }))
      .toEqual({ netAmount: 0, taxAmount: 0, grossAmount: 0 });
    expect(calculateStandaloneTax(1000, 'inclusive', 0))
      .toEqual({ netAmount: 1000, taxAmount: 0, grossAmount: 1000 });
    expect(calculateStandaloneTax(999999999999.99, 'inclusive', 12, { numerator: 11, denominator: 12 }))
      .toEqual({ netAmount: 900900900900.89, taxAmount: 99099099099.1, grossAmount: 999999999999.99 });
  });

  it('AC-DPP-001: refuses invalid money, rates, treatments and fractions', () => {
    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.001, 1000000000000]) {
      expect(calculateStandaloneTax(amount, 'exclusive', 12)).toBeNull();
    }
    for (const rate of [-1, Number.NaN, Number.POSITIVE_INFINITY, 100.001, 12.0001]) {
      expect(calculateStandaloneTax(100, 'exclusive', rate)).toBeNull();
    }
    expect(calculateStandaloneTax(100, 'unknown', 12)).toBeNull();
    for (const fraction of [
      { numerator: 11, denominator: 0 },
      { numerator: 0, denominator: 12 },
      { numerator: 13, denominator: 12 },
      { numerator: 0.5, denominator: 1 },
      { numerator: 1, denominator: Number.NaN },
      { numerator: Number.NaN, denominator: 12 },
      { numerator: 2147483648, denominator: 2147483648 },
    ]) {
      expect(calculateStandaloneTax(100, 'exclusive', 12, fraction)).toBeNull();
    }
  });
});
