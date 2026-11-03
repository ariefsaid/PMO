import { expect, it } from 'vitest';
import { purchaseDocstatus, purchaseStatus } from './status.ts';
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

it('AC-OPP-071 maps every Odoo state to the docstatus number the mirror stores', () => {
  const table: Array<[Parameters<typeof purchaseDocstatus>[0], string, 0 | 1 | 2]> = [
    ['order', 'draft', 0], ['order', 'sent', 0], ['order', 'to approve', 0], ['order', 'purchase', 1], ['order', 'done', 1], ['order', 'cancel', 2],
    ['receipt', 'draft', 0], ['receipt', 'assigned', 0], ['receipt', 'done', 1], ['receipt', 'cancel', 2],
    ['bill', 'draft', 0], ['bill', 'posted', 1], ['bill', 'cancel', 2],
    ['payment', 'draft', 0], ['payment', 'in_process', 1], ['payment', 'paid', 1], ['payment', 'posted', 1], ['payment', 'canceled', 2], ['payment', 'rejected', 2],
  ];
  for (const [kind, state, docstatus] of table) expect(purchaseDocstatus(kind, state), `${kind}:${state}`).toBe(docstatus);
  expect(purchaseDocstatus('order', 'something-new')).toBe(0);   // an unknown state is not issued, never guessed into a money state
});
it('AC-OPP-071 a payment in process counts as posted', () => {
  expect(purchaseStatus('payment', 'in_process')).toEqual({ status: 'Posted', cancelled: false });
  expect(purchaseStatus('payment', 'canceled')).toEqual({ status: 'Draft', cancelled: true });
});
