import { describe, expect, it } from 'vitest';
import { purchaseHasValue } from './purchaseValue';

const EMPTY = { items: [], purchase_requests: [], purchase_orders: [], invoices: [], payments: [], quotations: [] };

describe('purchaseHasValue', () => {
  it('a purchase with nothing on it has no value', () => {
    expect(purchaseHasValue(EMPTY)).toBe(false);
    expect(purchaseHasValue({ items: [] })).toBe(false);
  });
  it('a server total gives it a value even when the items are not loaded', () => {
    expect(purchaseHasValue({ ...EMPTY, total_value: 50000 })).toBe(true);
    expect(purchaseHasValue({ ...EMPTY, total_value: 0 })).toBe(false);
  });
  it('a line item gives it a value', () => {
    expect(purchaseHasValue({ ...EMPTY, items: [{}] })).toBe(true);
  });
  it.each(['purchase_requests', 'purchase_orders', 'invoices', 'payments'] as const)('a %s record with an amount gives it a value', (key) => {
    expect(purchaseHasValue({ ...EMPTY, [key]: [{ amount: 120 }] })).toBe(true);
  });
  it('a quotation total gives it a value', () => {
    expect(purchaseHasValue({ ...EMPTY, quotations: [{ total_amount: 50 }] })).toBe(true);
  });
  it('records with a zero or missing amount do not', () => {
    expect(purchaseHasValue({ ...EMPTY, invoices: [{ amount: 0 }, { amount: null }, {}] })).toBe(false);
  });
});
