import { describe, expect, it } from 'vitest';
import { efakturRefusal, normalizeEfakturValues, validateEfakturValues } from './efaktur';

describe('e-Faktur value rules', () => {
  it('AC-EFK-004 normalizes surrounding whitespace and clears blank number and date to null', () => {
    expect(normalizeEfakturValues({ number: '  010.001-26.12345678  ', date: '' })).toEqual({
      number: '010.001-26.12345678', date: null,
    });
    expect(normalizeEfakturValues({ number: '   ', date: '  ' })).toEqual({ number: null, date: null });
  });

  it('AC-EFK-004 accepts a 32-character punctuation-valid number with its date, and both empty', () => {
    const number = `${'1'.repeat(28)}.-12`;
    expect(number).toHaveLength(32);
    expect(validateEfakturValues({ number, date: '2026-10-07' }, '2026-10-07')).toEqual({});
    expect(validateEfakturValues({ number: null, date: null }, '2026-10-07')).toEqual({});
  });

  it('AC-EFK-004 rejects invalid characters, overlength numbers, and future dates', () => {
    expect(validateEfakturValues({ number: '010/001', date: '2026-10-07' }, '2026-10-07').number).toBe('invalid');
    expect(validateEfakturValues({ number: '1'.repeat(33), date: '2026-10-07' }, '2026-10-07').number).toBe('invalid');
    expect(validateEfakturValues({ number: '010-01', date: '2026-10-08' }, '2026-10-07').date).toBe('future');
  });

  it('DD-EFK-2 a number without its date (or a date without its number) flags the missing half', () => {
    expect(validateEfakturValues({ number: '010-01', date: null }, '2026-10-07')).toEqual({ date: 'missing' });
    expect(validateEfakturValues({ number: null, date: '2026-10-01' }, '2026-10-07')).toEqual({ number: 'missing' });
  });

  it('AC-EFK-004 reads the setter refusal from the error DETAIL, never the message text', () => {
    expect(efakturRefusal({ code: '23514', details: 'efaktur-incomplete', message: 'x' })).toBe('incomplete');
    expect(efakturRefusal({ code: '23514', details: 'efaktur-cancelled', message: 'x' })).toBe('cancelled');
    expect(efakturRefusal({ code: '23514', details: 'efaktur-future-date', message: 'x' })).toBe('future-date');
    // the message alone (a renamed exception, a proxy that drops DETAIL) is never parsed
    expect(efakturRefusal({ code: '23514', message: 'cannot record e-Faktur facts on a cancelled sales invoice' })).toBeNull();
    expect(efakturRefusal({ code: '42501', details: 'efaktur-cancelled', message: 'x' })).toBeNull();
    expect(efakturRefusal(new Error('boom'))).toBeNull();
    expect(efakturRefusal(null)).toBeNull();
  });
});
