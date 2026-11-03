import { describe, expect, it } from 'vitest';
import { buildPaymentBody, type PaymentCtx, type PaymentInput } from './paymentBody.ts';

const KEY = 'pay:dddddddd-dddd-4ddd-8ddd-000000001505';
const INPUT: PaymentInput = { billRef: 'account.move:77', amount: '98.00', date: '2026-12-10', vendorPartnerId: 9 };
const CTX: PaymentCtx = {
  companyCurrencyId: 12, journal: { id: 7, methodLineId: 31 },
  bill: { id: 77, state: 'posted', moveType: 'in_invoice', residual: '98.00', currencyId: 12, partnerId: 9 },
};
const reason = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as Error).message; } return 'no refusal'; };

describe('AC-OPP-050 the payment body', () => {
  it('pays the posted bill: outbound supplier payment, the bill\'s vendor, the chosen journal and method, the memo anchor', () => {
    expect(buildPaymentBody(INPUT, CTX, KEY)).toEqual({
      payment_type: 'outbound', partner_type: 'supplier', partner_id: 9, amount: 98, currency_id: 12,
      journal_id: 7, payment_method_line_id: 31, date: '2026-12-10', memo: `pmo:${KEY}`,
    });
  });

  it('a payment of the full residual and a part of it are both accepted; the date is optional', () => {
    expect(buildPaymentBody({ ...INPUT, amount: 40, date: null }, CTX, KEY)).toMatchObject({ amount: 40 });
    expect(buildPaymentBody({ ...INPUT, amount: 40, date: null }, CTX, KEY)).not.toHaveProperty('date');
    expect(buildPaymentBody({ ...INPUT, amount: '0.01' }, CTX, KEY)).toMatchObject({ amount: 0.01 });
  });
});

describe('AC-OPP-051 refusals, all before any write', () => {
  it('no bill reference, or one that is not an account.move reference', () => {
    expect(reason(() => buildPaymentBody({ ...INPUT, billRef: null }, CTX, KEY))).toBe('payment-bill-required');
    expect(reason(() => buildPaymentBody({ ...INPUT, billRef: '77' }, CTX, KEY))).toBe('payment-bill-required');
    expect(reason(() => buildPaymentBody({ ...INPUT, billRef: 'purchase.order:77' }, CTX, KEY))).toBe('payment-bill-required');
  });

  it('a bill that is not posted, not a vendor bill, or not the referenced bill', () => {
    expect(reason(() => buildPaymentBody(INPUT, { ...CTX, bill: { ...CTX.bill!, state: 'draft' } }, KEY))).toBe('bill-not-posted');
    expect(reason(() => buildPaymentBody(INPUT, { ...CTX, bill: { ...CTX.bill!, state: 'cancel' } }, KEY))).toBe('bill-not-posted');
    expect(reason(() => buildPaymentBody(INPUT, { ...CTX, bill: { ...CTX.bill!, moveType: 'out_invoice' } }, KEY))).toBe('bill-not-a-vendor-bill');
    expect(reason(() => buildPaymentBody(INPUT, { ...CTX, bill: null }, KEY))).toBe('bill-missing');
    expect(reason(() => buildPaymentBody(INPUT, { ...CTX, bill: { ...CTX.bill!, id: 78 } }, KEY))).toBe('bill-missing');
  });

  it('a currency other than the company currency', () => {
    expect(reason(() => buildPaymentBody(INPUT, { ...CTX, bill: { ...CTX.bill!, currencyId: 13 } }, KEY))).toBe('currency-mismatch');
    expect(reason(() => buildPaymentBody(INPUT, { ...CTX, bill: { ...CTX.bill!, currencyId: null } }, KEY))).toBe('currency-mismatch');
  });

  it('an amount that is not above zero, not a number, or above the outstanding net payable (Odoo would accept an overpayment)', () => {
    for (const amount of [0, -5, '0', '0.004', 'abc', Number.NaN, Infinity, '']) expect(reason(() => buildPaymentBody({ ...INPUT, amount }, CTX, KEY))).toBe('amount-invalid');
    expect(reason(() => buildPaymentBody({ ...INPUT, amount: '98.01' }, CTX, KEY))).toBe('over-payment');
    expect(reason(() => buildPaymentBody({ ...INPUT, amount: 99 }, CTX, KEY))).toBe('over-payment');
    expect(reason(() => buildPaymentBody({ ...INPUT, amount: 58 }, { ...CTX, bill: { ...CTX.bill!, residual: '40.00' } }, KEY))).toBe('over-payment');
    expect(reason(() => buildPaymentBody(INPUT, { ...CTX, bill: { ...CTX.bill!, residual: '0.00' } }, KEY))).toBe('over-payment');
  });

  it('a vendor other than the bill\'s, and a date that is not a day', () => {
    expect(reason(() => buildPaymentBody({ ...INPUT, vendorPartnerId: 10 }, CTX, KEY))).toBe('vendor-mismatch');
    expect(reason(() => buildPaymentBody({ ...INPUT, date: '10/12/2026' }, CTX, KEY))).toBe('date-invalid');
  });

  it('no journal, or a journal with no outbound payment method', () => {
    expect(reason(() => buildPaymentBody(INPUT, { ...CTX, journal: null }, KEY))).toBe('journal-missing');
    expect(reason(() => buildPaymentBody(INPUT, { ...CTX, journal: { id: 7, methodLineId: null } }, KEY))).toBe('journal-no-outbound-method');
  });

  it('a key that is not a PMO payment key writes nothing', () => {
    expect(() => buildPaymentBody(INPUT, CTX, 'bill:dddddddd-dddd-4ddd-8ddd-000000001505')).toThrow();
    expect(() => buildPaymentBody(INPUT, CTX, 'not a key')).toThrow();
  });
});
