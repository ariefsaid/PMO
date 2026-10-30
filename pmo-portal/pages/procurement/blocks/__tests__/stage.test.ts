import { describe, expect, it } from 'vitest';
import { stageForStatus, stageDates, payStepLabel, stageLabelForStatus } from '../stage';

describe('procurement stages', () => {
  it.each([
    ['Draft', 'Request'],
    ['Requested', 'Request'],
    ['Quote Selected', 'Request'],
    ['Ordered', 'Order'],
    ['Received', 'Receive'],
    ['Vendor Invoiced', 'Pay'],
    ['Paid', 'Pay'],
  ])('maps %s to the four-stage vocabulary', (status, stage) => {
    expect(stageForStatus(status)).toBe(stage);
  });

  it('uses the first recorded date in each stage, including linked ERP documents', () => {
    expect(stageDates(
      {
        purchase_requests: [{ date: '2026-09-01' }],
        purchase_orders: [{ date: '2026-09-03' }, { date: '2026-09-02' }],
        receipts: [{ receipt_date: '2026-09-04' }],
        invoices: [{ invoice_date: '2026-09-06' }],
        payments: [{ date: '2026-09-08' }],
      },
      [{ doctype: 'Purchase Order', docDate: '2026-09-01' }, { doctype: 'Purchase Invoice', docDate: '2026-09-05' }],
    )).toEqual({ request: '2026-09-01', order: '2026-09-01', receive: '2026-09-04', pay: '2026-09-05' });
  });

  it('AC-1402: an invoiced procurement with no payment stays in Pay and labels the timeline step Invoiced', () => {
    const fixture = {
      status: 'Vendor Invoiced',
      invoices: [{ invoice_date: '2026-10-20' }],
      payments: [],
    };
    expect(stageForStatus(fixture.status)).toBe('Pay');
    expect(stageLabelForStatus(fixture.status)).toBe('Invoiced, not paid');
    expect(stageDates(fixture)).toEqual({ request: null, order: null, receive: null, pay: '2026-10-20' });
    expect(payStepLabel(fixture.payments.length > 0)).toBe('Invoiced');
    expect(payStepLabel(true)).toBe('Paid');
  });
});
