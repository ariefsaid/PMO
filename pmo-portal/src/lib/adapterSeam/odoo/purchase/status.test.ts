import { expect, it } from 'vitest';
import { purchaseStatus } from './status.ts';
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
