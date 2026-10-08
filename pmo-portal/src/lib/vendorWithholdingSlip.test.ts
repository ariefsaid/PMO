import { describe, expect, it } from 'vitest';
import { bupotRefusal, formatSlipCents, parseDecimalCents, parsePositiveSlipMoney, sumSlipMoney } from './vendorWithholdingSlip';

describe('AC-BUPOT-013 exact slip money', () => {
  it('accepts finite positive money through the numeric(14,2) maximum and rejects invalid drafts', () => {
    expect(parsePositiveSlipMoney('999999999999.99')).toBe('999999999999.99');
    expect(parsePositiveSlipMoney('0')).toBeNull();
    expect(parsePositiveSlipMoney('-0.01')).toBeNull();
    expect(parsePositiveSlipMoney('1.001')).toBeNull();
    expect(parsePositiveSlipMoney('1e3')).toBeNull();
    expect(parsePositiveSlipMoney('Infinity')).toBeNull();
    expect(parsePositiveSlipMoney('1000000000000')).toBeNull();
    expect(parsePositiveSlipMoney('1\n')).toBeNull();
  });
  it('sums integer cents without drift or overflowing the individual numeric boundary', () => {
    expect(sumSlipMoney(['20000.00', '30000.00'])).toBe(5_000_000n);
    expect(formatSlipCents(sumSlipMoney(['999999999999.99', '0.01'])!)).toBe('1000000000000.00');
    expect(parseDecimalCents('49,999.99')).toBeNull();
  });
  it('maps stable refusal detail without displaying machine values', () => {
    expect(bupotRefusal({ code: '40001', details: 'bupot-stale' })).toEqual({ key: 'stale', remedy: 'reload' });
    expect(bupotRefusal({ code: '23514', details: 'bupot-ineligible-bill' })).toEqual({ key: 'ineligibleBill', remedy: 'edit' });
    expect(bupotRefusal({ code: '23514', details: 'bupot-bill-limit' })).toEqual({ key: 'billLimit', remedy: 'edit' });
    expect(bupotRefusal({ code: '42501', details: 'bupot-not-permitted' })).toEqual({ key: 'notPermitted', remedy: 'inspect' });
    expect(bupotRefusal({ code: '08006' })).toEqual({ key: 'retrySameIntent', remedy: 'retry' });
  });
});
