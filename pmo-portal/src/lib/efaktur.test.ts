import { describe, expect, it } from 'vitest';
import { normalizeEfakturValues, validateEfakturValues } from './efaktur';

describe('e-Faktur value rules', () => {
  it('AC-EFK-004 normalizes surrounding whitespace and clears blank number and date to null', () => {
    expect(normalizeEfakturValues({ number: '  010.001-26.12345678  ', date: '' })).toEqual({
      number: '010.001-26.12345678', date: null,
    });
    expect(normalizeEfakturValues({ number: '   ', date: '  ' })).toEqual({ number: null, date: null });
  });

  it('AC-EFK-004 accepts a 32-character punctuation-valid number and optional empty fields', () => {
    const number = `${'1'.repeat(28)}.-12`;
    expect(number).toHaveLength(32);
    expect(validateEfakturValues({ number, date: null }, '2026-10-07')).toEqual({});
    expect(validateEfakturValues({ number: null, date: null }, '2026-10-07')).toEqual({});
  });

  it('AC-EFK-004 rejects invalid characters, overlength numbers, and future dates', () => {
    expect(validateEfakturValues({ number: '010/001', date: null }, '2026-10-07').number).toBeTruthy();
    expect(validateEfakturValues({ number: '1'.repeat(33), date: null }, '2026-10-07').number).toBeTruthy();
    expect(validateEfakturValues({ number: null, date: '2026-10-08' }, '2026-10-07').date).toBeTruthy();
  });
});
