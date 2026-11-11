import { describe, expect, it } from 'vitest';
import { parseExactCents, formatExactCents, parseSafeCents, formatNumberCents } from './exactDecimal';
import { toCents, fromCents } from './budget/budgetAmount';
import { moneyUnits, moneyText } from './projectFinances';
import { parseDecimalCents, parsePositiveSlipMoney, formatSlipCents } from './vendorWithholdingSlip';

describe('exact money adapters', () => {
  it('preserves signed decimal grammar and exact large values', () => {
    expect(parseExactCents('0001.2')).toBe(120n);
    expect(parseExactCents('-1.23')).toBe(-123n);
    expect(parseExactCents('1.234')).toBeNull();
    expect(parseExactCents(' 1')).toBeNull();
    expect(formatExactCents(-123n)).toBe('-1.23');
    expect(moneyUnits('9007199254740993.99')).toBe(900719925474099399n);
    expect(moneyText(-1n)).toBe('-0.01');
  });
  it('keeps budget errors, range, whitespace and negative zero', () => {
    expect(Object.is(toCents(' -0.00 '), -0)).toBe(true);
    expect(toCents('001.2')).toBe(120);
    expect(() => toCents(' ')).toThrow('invalid decimal budget amount');
    expect(() => toCents('90071992547409.92')).toThrow('budget amount out of range');
    expect(parseSafeCents('not money')).toBe('invalid');
    expect(parseSafeCents('90071992547409.92')).toBe('range');
    expect(fromCents(-123)).toBe('-1.23');
    expect(formatNumberCents(0)).toBe('0.00');
  });
  it('keeps slip grammar, bounds and control characters', () => {
    expect(parseDecimalCents(' 01.00 ')).toBeNull();
    expect(parseDecimalCents(' -1.2 ')).toBe(-120n);
    expect(parsePositiveSlipMoney('1\n')).toBeNull();
    expect(parsePositiveSlipMoney('999999999999.99')).toBe('999999999999.99');
    expect(parsePositiveSlipMoney('1000000000000')).toBeNull();
    expect(formatSlipCents(-1n)).toBe('-0.01');
  });
});
