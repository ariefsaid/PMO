import { expect, it } from 'vitest';
import { billPaymentView, purchaseStatus } from './status.ts';
it('AC-OPP-071 derives statuses and cancellation tombstones from Odoo', () => {
  expect(purchaseStatus('order', 'to approve')).toEqual({ status: 'Draft', cancelled: false });
  expect(purchaseStatus('order', 'purchase')).toEqual({ status: 'Issued', cancelled: false });
  expect(purchaseStatus('order', 'cancel')).toEqual({ status: 'Closed', cancelled: true });
  expect(purchaseStatus('receipt', 'done')).toEqual({ status: 'Complete', cancelled: false });
  expect(purchaseStatus('receipt', 'assigned')).toEqual({ status: 'Partial', cancelled: false });
  expect(purchaseStatus('bill', 'posted', '0.00')).toEqual({ status: 'Paid', cancelled: false });
  expect(purchaseStatus('bill', 'posted', '1.00')).toEqual({ status: 'Received', cancelled: false });
  expect(purchaseStatus('payment', 'posted')).toEqual({ status: 'Posted', cancelled: false });
});

it('AC-OPP-055 a payment Odoo accepted while the last read still shows a residual is "payment sent, awaiting Odoo", never Paid', () => {
  expect(billPaymentView({ state: 'posted', residual: '98.00', paymentsSent: 1 })).toBe('awaiting-odoo');
  expect(billPaymentView({ state: 'posted', residual: '58.00', paymentsSent: 1 })).toBe('awaiting-odoo');   // 40 of 98 paid: the read has not caught up yet
});

it('AC-OPP-055 Paid only when Odoo\'s own residual is zero on a posted bill; no payment sent is just unpaid', () => {
  expect(billPaymentView({ state: 'posted', residual: '0.00', paymentsSent: 1 })).toBe('paid');
  expect(billPaymentView({ state: 'posted', residual: '0', paymentsSent: 0 })).toBe('paid');   // settled in Odoo by someone else: still Odoo's word
  expect(billPaymentView({ state: 'posted', residual: '98.00', paymentsSent: 0 })).toBe('unpaid');
  expect(billPaymentView({ state: 'draft', residual: '0.00', paymentsSent: 1 })).toBe('unpaid');   // a draft is never paid
  expect(billPaymentView({ state: 'posted', residual: null, paymentsSent: 1 })).toBe('awaiting-odoo');   // no read yet: not Paid
});
