import { describe, it, expect } from 'vitest';
import en from '@/public/locales/en/stock.json';
import id from '@/public/locales/id/stock.json';
import { STOCK_ERROR_CODES, parseStockError } from './stockErrors';

describe('parseStockError', () => {
  it('FR-STK-080 parses the stable code and the numbers from a P0001 message', () => {
    const e = { code: 'P0001', message: 'STK_INSUFFICIENT: item CEM at SITE-A: available 5, requested 6', details: '{"available":"5","requested":"6"}' };
    expect(parseStockError(e)).toEqual({ code: 'STK_INSUFFICIENT', message: 'item CEM at SITE-A: available 5, requested 6', numbers: { available: '5', requested: '6' } });
  });

  it('FR-STK-080 a stock error without parseable details has no numbers', () => {
    expect(parseStockError({ code: 'P0001', message: 'STK_NOT_FOUND: the unit is not in your organisation', details: 'not json' }))
      .toEqual({ code: 'STK_NOT_FOUND', message: 'the unit is not in your organisation', numbers: {} });
    expect(parseStockError({ code: 'P0001', message: 'STK_INVALID: x', details: '{"a":{"b":1}}' })?.numbers).toEqual({});
  });

  it('returns null for a non-stock error so classifyMutationError handles it', () => {
    expect(parseStockError({ code: '42501', message: 'x' })).toBeNull();
    expect(parseStockError({ code: 'P0001', message: 'STK_UNKNOWN_CODE: x' })).toBeNull();
    expect(parseStockError(null)).toBeNull();
    expect(parseStockError('STK_INVALID: x')).toBeNull();
  });
});

describe('stock error copy', () => {
  it.each(STOCK_ERROR_CODES.map((c) => [c]))('FR-STK-080 %s has en and id copy', (code) => {
    const e = (en as { errors: Record<string, string> }).errors[code];
    const i = (id as { errors: Record<string, string> }).errors[code];
    expect(e && e.trim().length).toBeGreaterThan(0);
    expect(i && i.trim().length).toBeGreaterThan(0);
    expect(i).not.toBe(e);
  });
});
