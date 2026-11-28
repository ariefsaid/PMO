import { describe, it, expect } from 'vitest';
import { AppError } from '@/src/lib/appError';
import {
  wireValidator, lenient, isRec,
  str, text, strOrNull, nonEmptyStrOrNull, money, moneyOrNull,
  decimal, decimalOrNull, bool, num, numOrNull, int, arr, rec, oneOf,
} from './wireDoc';

describe('wireDoc strict validators (#2983)', () => {
  it('throws a field-named AppError with the configured context and code', () => {
    const v = wireValidator('Work in hand', 'work-in-hand-malformed');
    let caught: unknown;
    try { v.money('bad', 'contracts[0].billed_to_date'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({
      code: 'work-in-hand-malformed',
      message: 'Work in hand: contracts[0].billed_to_date is missing or malformed',
    });
  });

  it('str accepts non-empty strings and rejects empty, null, undefined, and non-strings', () => {
    expect(str('ok', 'name')).toBe('ok');
    for (const bad of ['', null, undefined, 0, 123, false, {}]) {
      expect(() => str(bad, 'name')).toThrow(/name/);
    }
  });

  it('text accepts any string including empty and rejects non-strings', () => {
    expect(text('', 'description')).toBe('');
    expect(text('Concrete', 'description')).toBe('Concrete');
    for (const bad of [null, undefined, 123, false]) {
      expect(() => text(bad, 'description')).toThrow(/description/);
    }
  });

  it('strOrNull and nonEmptyStrOrNull distinguish empty strings', () => {
    expect(strOrNull(null, 'code')).toBeNull();
    expect(strOrNull(undefined, 'code')).toBeNull();
    expect(strOrNull('', 'code')).toBe('');
    expect(strOrNull('WO-1', 'code')).toBe('WO-1');
    expect(() => strOrNull(42, 'code')).toThrow(/code/);

    expect(nonEmptyStrOrNull(null, 'code')).toBeNull();
    expect(nonEmptyStrOrNull('WO-1', 'code')).toBe('WO-1');
    expect(() => nonEmptyStrOrNull('', 'code')).toThrow(/code/);
    expect(() => nonEmptyStrOrNull(42, 'code')).toThrow(/code/);
  });

  it('money and moneyOrNull accept scale-two text only and reject floats, scientific notation, and 3+ decimals', () => {
    expect(money('0', 'amount')).toBe('0');
    expect(money('1200000.00', 'amount')).toBe('1200000.00');
    expect(money('-50.5', 'amount')).toBe('-50.5');
    expect(moneyOrNull(null, 'amount')).toBeNull();
    expect(moneyOrNull(undefined, 'amount')).toBeNull();
    expect(moneyOrNull('10.25', 'amount')).toBe('10.25');
    for (const bad of [100, 0, '1e3', '12.345', 'abc', '', ' 10.00', null, undefined]) {
      expect(() => money(bad, 'amount')).toThrow(/amount/);
    }
    expect(() => moneyOrNull('1e3', 'amount')).toThrow(/amount/);
  });

  it('decimal and decimalOrNull accept exact decimal strings of any scale and reject non-decimal strings or numbers', () => {
    expect(decimal('0.050000', 'qty_per_unit')).toBe('0.050000');
    expect(decimal('8.800', 'generated_qty')).toBe('8.800');
    expect(decimal('-12', 'delta')).toBe('-12');
    expect(decimalOrNull(null, 'adjusted_qty')).toBeNull();
    expect(decimalOrNull('12.000', 'adjusted_qty')).toBe('12.000');
    for (const bad of [8.8, '1e3', 'NaN', '', 'abc', null, undefined]) {
      expect(() => decimal(bad, 'qty')).toThrow(/qty/);
    }
  });

  it('bool accepts booleans only', () => {
    expect(bool(true, 'out_of_date')).toBe(true);
    expect(bool(false, 'out_of_date')).toBe(false);
    for (const bad of ['true', 1, 0, null, undefined]) {
      expect(() => bool(bad, 'out_of_date')).toThrow(/out_of_date/);
    }
  });

  it('num and numOrNull accept finite numbers or numeric strings and reject NaN, Infinity, blanks, and booleans', () => {
    expect(num(0, 'remaining')).toBe(0);
    expect(num('330000.00', 'invoiced')).toBe(330000);
    expect(num(-12.5, 'gap_pp')).toBe(-12.5);
    expect(numOrNull(null, 'issued_pct')).toBeNull();
    expect(numOrNull(undefined, 'issued_pct')).toBeNull();
    expect(numOrNull('12.50', 'issued_pct')).toBe(12.5);
    for (const bad of [null, undefined, '', '   ', 'NaN', 'Infinity', Number.NaN, Number.POSITIVE_INFINITY, 'abc', true, []]) {
      expect(() => num(bad, 'issued_pct')).toThrow(/issued_pct/);
    }
    for (const bad of ['', '   ', 'NaN', 'Infinity', Number.NaN, 'abc', true]) {
      expect(() => numOrNull(bad, 'issued_pct')).toThrow(/issued_pct/);
    }
  });

  it('int accepts JS integers and enforces optional min bound', () => {
    expect(int(0, 'count', { min: 0 })).toBe(0);
    expect(int(42, 'count', { min: 0 })).toBe(42);
    expect(int(-3, 'offset')).toBe(-3);
    expect(() => int(-1, 'count', { min: 0 })).toThrow(/count/);
    for (const bad of [1.5, '1', Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(() => int(bad, 'count')).toThrow(/count/);
    }
  });

  it('arr and rec enforce arrays and plain objects', () => {
    expect(arr([1, 2], 'lines')).toEqual([1, 2]);
    expect(() => arr('x', 'lines')).toThrow(/lines/);
    expect(() => arr(null, 'lines')).toThrow(/lines/);

    expect(rec({ a: 1 }, 'response')).toEqual({ a: 1 });
    expect(isRec({ a: 1 })).toBe(true);
    expect(isRec([])).toBe(false);
    expect(isRec(null)).toBe(false);
    for (const bad of [null, undefined, [], 'str', 5]) {
      expect(() => rec(bad, 'response')).toThrow(/response/);
    }
  });

  it('oneOf validates membership and names the field', () => {
    const allowed = ['Draft', 'Issued', 'Closed', 'Cancelled'] as const;
    expect(oneOf('Issued', allowed, 'status')).toBe('Issued');
    expect(() => oneOf('Unknown', allowed, 'status')).toThrow(/status.*Unknown/);
    expect(() => oneOf(null, allowed, 'status')).toThrow(/status/);
  });
});

describe('wireDoc explicit lenient variant (#2983)', () => {
  it('coerces degraded values without leaking NaN or Infinity', () => {
    expect(lenient.str(null)).toBe('');
    expect(lenient.str(undefined)).toBe('');
    expect(lenient.str(42)).toBe('42');
    expect(lenient.strOrNull('a')).toBe('a');
    expect(lenient.strOrNull('')).toBe('');
    expect(lenient.strOrNull(42)).toBeNull();
    expect(lenient.nonEmptyStrOrNull('')).toBeNull();
    expect(lenient.nonEmptyStrOrNull('a')).toBe('a');
    expect(lenient.numOrNull(12.5)).toBe(12.5);
    expect(lenient.numOrNull('12.5')).toBe(12.5);
    expect(lenient.numOrNull('bad')).toBeNull();
    expect(lenient.numOrNull(Number.NaN)).toBeNull();
    expect(lenient.numOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(lenient.numOrNull('')).toBeNull();
    expect(lenient.bool(true)).toBe(true);
    expect(lenient.bool('true')).toBe(false);
    expect(lenient.arr([1])).toEqual([1]);
    expect(lenient.arr('x')).toEqual([]);
    expect(lenient.rec({ a: 1 })).toEqual({ a: 1 });
    expect(lenient.rec([])).toBeNull();
  });
});
