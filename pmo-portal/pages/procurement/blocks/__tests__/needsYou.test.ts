import { describe, expect, it } from 'vitest';
import { needsYou } from '../needsYou';

const row = {
  id: 'proc-1',
  status: 'Requested',
  requested_by_id: 'requester',
  created_at: '2026-09-01T00:00:00Z',
  project: { project_manager_id: 'pm' },
  purchase_orders: [{ date: '2026-09-02', created_at: '2026-09-02T00:00:00Z' }],
  procurement_invoices: [{ invoice_date: '2026-09-01', amount: 100, erp_outstanding_amount: null }],
  payments: [{ amount: 10, status: 'Paid' }],
};

describe('needsYou', () => {
  it('surfaces a request for an eligible approver, excluding its requester', () => {
    expect(needsYou(row, { role: 'Finance', userId: 'finance' })).toEqual({
      reason: 'approve',
      since: new Date('2026-09-01'),
    });
    expect(needsYou(row, { role: 'Finance', userId: 'requester' })).toBeNull();
    expect(needsYou(row, { role: 'Engineer', userId: 'engineer' })).toBeNull();
  });

  it('surfaces oldest unpaid invoice for Finance/Admin and receipt work for requester/PM/Admin', () => {
    expect(
      needsYou({ ...row, status: 'Vendor Invoiced' }, { role: 'Admin', userId: 'admin' }),
    ).toEqual({ reason: 'pay', since: new Date('2026-09-01') });
    expect(
      needsYou({ ...row, status: 'Ordered' }, { role: 'Engineer', userId: 'requester' }),
    ).toEqual({ reason: 'receive', since: new Date('2026-09-02') });
    expect(
      needsYou({ ...row, status: 'Ordered' }, { role: 'Project Manager', userId: 'pm' }),
    ).toEqual({ reason: 'receive', since: new Date('2026-09-02') });
    expect(
      needsYou({ ...row, status: 'Ordered' }, { role: 'Project Manager', userId: 'other' }),
    ).toBeNull();
  });
});

describe('bill payment allocation', () => {
  const viewer = { role: 'Finance', userId: 'finance' };
  const bill = (id: string, date: string, outstanding: number | null = null) => ({
    id,
    currency: 'IDR',
    amount: 100,
    invoice_date: date,
    erp_outstanding_amount: outstanding,
  });
  it('keeps the second bill actionable when only the first bill is paid', () => {
    expect(
      needsYou(
        {
          ...row,
          status: 'Vendor Invoiced',
          procurement_invoices: [bill('a', '2026-09-01'), bill('b', '2026-09-02')],
          payments: [{ invoice_id: 'a', currency: 'IDR', amount: 100, status: 'Paid' }],
        },
        viewer,
      )?.since,
    ).toEqual(new Date('2026-09-02'));
  });
  it('keeps a partially paid bill actionable', () => {
    expect(
      needsYou(
        {
          ...row,
          status: 'Vendor Invoiced',
          procurement_invoices: [bill('a', '2026-09-01')],
          payments: [{ invoice_id: 'a', currency: 'IDR', amount: 40, status: 'Paid' }],
        },
        viewer,
      )?.reason,
    ).toBe('pay');
  });
  it('uses the ERP outstanding balance ahead of local payments', () => {
    expect(
      needsYou(
        {
          ...row,
          status: 'Vendor Invoiced',
          procurement_invoices: [bill('a', '2026-09-01', 20)],
          payments: [{ invoice_id: 'a', currency: 'IDR', amount: 100, status: 'Paid' }],
        },
        viewer,
      )?.reason,
    ).toBe('pay');
    expect(
      needsYou(
        { ...row, status: 'Vendor Invoiced', procurement_invoices: [bill('a', '2026-09-01', 0)] },
        viewer,
      ),
    ).toBeNull();
  });
});

it('does not apply a different-currency payment to a bill', () => {
  expect(
    needsYou(
      {
        status: 'Vendor Invoiced',
        procurement_invoices: [
          { id: 'a', currency: 'IDR', amount: 100, invoice_date: '2026-09-01' },
        ],
        payments: [{ invoice_id: 'a', currency: 'USD', amount: 100, status: 'Paid' }],
      },
      { role: 'Finance', userId: 'finance' },
    )?.reason,
  ).toBe('pay');
});
