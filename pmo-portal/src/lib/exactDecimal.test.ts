import { describe, expect, it } from 'vitest';
import { formatDecimal, formatExactCents, formatNumberCents, mulRound, parseDecimal, parseExactCents, parseSafeCents, sumDecimal } from './exactDecimal';
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

/** #2748: the one decimal module — one interface test per function, at the boundaries (0, half, negative, 15 digits). */
describe('parseDecimal', () => {
  it('parses whole, fractional, signed and zero at the scale', () => {
    expect(parseDecimal('0', 2)).toBe(0n);
    expect(parseDecimal('0.00', 2)).toBe(0n);
    expect(parseDecimal('12.5', 2)).toBe(1250n);
    expect(parseDecimal('-0.05', 2)).toBe(-5n);
    expect(parseDecimal('5', 0)).toBe(5n);
    expect(parseDecimal('-5', 0)).toBe(-5n);
  });
  it('accepts trailing zeros beyond the scale but refuses real finer digits', () => {
    expect(parseDecimal('1.000', 2)).toBe(100n);
    expect(parseDecimal('1.200', 1)).toBe(12n);
    expect(parseDecimal('1.001', 2)).toBeNull();
    expect(parseDecimal('1.234', 2)).toBeNull();
  });
  it('refuses malformed text without trimming', () => {
    expect(parseDecimal('', 2)).toBeNull();
    expect(parseDecimal(' 1', 2)).toBeNull();
    expect(parseDecimal('x', 3)).toBeNull();
  });
  it('keeps 15 integer digits exact, past what a float can hold', () => {
    expect(parseDecimal('9007199254740993.99', 2)).toBe(900719925474099399n);
  });
});

describe('formatDecimal', () => {
  it('formats zero, signed and large values at the scale', () => {
    expect(formatDecimal(0n, 2)).toBe('0.00');
    expect(formatDecimal(-123n, 2)).toBe('-1.23');
    expect(formatDecimal(900719925474099399n, 2)).toBe('9007199254740993.99');
    expect(formatDecimal(2000n, 0)).toBe('2000');
  });
  it('trim drops trailing fraction zeros only, never integer zeros', () => {
    expect(formatDecimal(1500n, 3, { trim: true })).toBe('1.5');
    expect(formatDecimal(0n, 3, { trim: true })).toBe('0');
    expect(formatDecimal(-1n, 3, { trim: true })).toBe('-0.001');
    expect(formatDecimal(2000n, 3, { trim: true })).toBe('2');
  });
});

describe('mulRound', () => {
  // the shipped certificate rule (#2584 AC-SPC-003): line amount = round(quantity x rate, 2), half away from zero, once
  it.each([
    ['3.333', '9.99', 2, 3330n], // 33.29667 -> 33.30; a float product is 33.2966…7 wrong at the 7th digit
    ['0.1', '0.2', 2, 2n], // 0.02 where 0.1 * 0.2 as floats is 0.020000000000000004
    ['1.005', '1', 2, 101n], // half away from zero, not banker's rounding
    ['2.5', '0.01', 2, 3n],
    ['5', '12', 2, 6000n], // whole-number inputs pad to the scale
  ])('%s × %s at scale %s pins the certificate rule', (a, b, scale, expected) => {
    expect(mulRound(a, b, scale)).toBe(expected);
  });
  it.each([
    ['0', '0.005', 0n],
    ['0.005', '1', 1n],
    ['-0.005', '1', -1n], // half AWAY from zero: half-up would give 0, Postgres round(numeric) gives -0.01
    ['0.005', '-1', -1n],
    ['-0.005', '-1', 1n],
    ['-1.005', '1', -101n],
  ])('rounds the exact half boundary away from zero: mulRound(%s, %s, 2) -> %n', (a, b, expected) => {
    expect(mulRound(a, b, 2)).toBe(expected);
  });
  it('rounds once, at 15 digits where float arithmetic loses the cent', () => {
    expect(mulRound('90071992547409.93', '0.01', 2)).toBe(90071992547410n);
  });
  it('is null on malformed input, never a figure', () => {
    expect(mulRound('x', '1', 2)).toBeNull();
    expect(mulRound('1', '', 2)).toBeNull();
  });
});

describe('sumDecimal', () => {
  it('sums exactly where floats drift and skips null and malformed entries', () => {
    expect(sumDecimal(['0.10', '0.20', null], 2)).toBe('0.30');
    expect(sumDecimal(['invalid', '1.00'], 2)).toBe('1.00');
    expect(sumDecimal([null], 2)).toBe('0.00');
    expect(sumDecimal(['-1.23', '0.23'], 2)).toBe('-1.00');
  });
  it('rounds the exact total once, including finer inputs', () => {
    expect(sumDecimal(['1.005'], 2)).toBe('1.01');
    expect(sumDecimal(['1.005', '1.00'], 2)).toBe('2.01');
    expect(sumDecimal(['0.005', '0.005'], 2)).toBe('0.01');
    expect(sumDecimal(['-1.005'], 2)).toBe('-1.01');
  });
  it('keeps large sums exact, past the float integer limit', () => {
    expect(sumDecimal(['9007199254740993.99', '0.01'], 2)).toBe('9007199254740994.00');
  });
});
