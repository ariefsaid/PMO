import { describe, it, expect } from 'vitest';
import { formatCurrency, parseMoneyInput } from './format';

describe('formatCurrency', () => {
  it('formats USD with no fraction digits (AC-410)', () => {
    expect(formatCurrency(5000000)).toBe('$5,000,000');
  });
  it('rounds to whole dollars', () => {
    expect(formatCurrency(1234.56)).toBe('$1,235');
  });
});

describe('parseMoneyInput — the single parse for validation AND persistence (Wave 3 input integrity)', () => {
  it('parses plain + comma-formatted numbers', () => {
    expect(parseMoneyInput('1500')).toBe(1500);
    expect(parseMoneyInput('4,820,000')).toBe(4820000);
    expect(parseMoneyInput(' 5 ')).toBe(5);
    expect(parseMoneyInput('0')).toBe(0);
    expect(parseMoneyInput('.5')).toBe(0.5);
    expect(parseMoneyInput('5.')).toBe(5);
    expect(parseMoneyInput('-5')).toBe(-5); // sign rule is the caller's, not the parser's
  });
  it('returns null for blank (caller decides if blank is allowed)', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('   ')).toBeNull();
  });
  it('returns null for non-numeric text — does NOT silently coerce like parseFloat', () => {
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('12x')).toBeNull(); // parseFloat would yield 12
    expect(parseMoneyInput('1.2.3')).toBeNull(); // parseFloat would yield 1.2
    expect(parseMoneyInput('0x10')).toBe(16); // Number() reads hex consistently (validate==persist)
  });
  it('parses scientific notation the SAME for validate + persist (the divergence bug: strip-regex made "1e5"→15)', () => {
    expect(parseMoneyInput('1e5')).toBe(100000);
  });
});
