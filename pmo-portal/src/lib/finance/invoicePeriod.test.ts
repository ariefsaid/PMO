// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  monthWindowExclusiveEnd,
  monthWindowFromParams,
  issuedWithinMonthWindow,
} from './invoicePeriod';

describe('#1461 receivables drill window', () => {
  it('validates from/to month tokens and rejects absent or malformed ones', () => {
    expect(monthWindowFromParams('2026-01', '2026-06')).toEqual({ from: '2026-01', to: '2026-06' });
    // The current month is a legitimate window edge (a ?period=month drill).
    expect(monthWindowFromParams('2026-06', '2026-06')).toEqual({ from: '2026-06', to: '2026-06' });
    expect(monthWindowFromParams(null, '2026-06')).toBeNull();
    expect(monthWindowFromParams('2026-01', null)).toBeNull();
    expect(monthWindowFromParams('bogus', '2026-06')).toBeNull();
    expect(monthWindowFromParams('2026-13', '2026-06')).toBeNull();
  });

  it('computes the exclusive end after the to-month, across year boundaries', () => {
    expect(monthWindowExclusiveEnd('2026-06')).toBe('2026-07-01');
    expect(monthWindowExclusiveEnd('2026-12')).toBe('2027-01-01');
    expect(monthWindowExclusiveEnd('2026-01')).toBe('2026-02-01');
  });

  it('keeps exactly the issued, non-cancelled invoices dated inside the window', () => {
    const window = { from: '2026-01', to: '2026-03' };
    const base = { status: 'Unpaid', invoice_date: '2026-02-15', erp_cancelled_at: null, erp_docstatus: 1 } as const;
    expect(issuedWithinMonthWindow(base, window)).toBe(true);
    // First day of the window is in; the exclusive end (first day after `to`) is out — the
    // same bounds get_win_rate and get_management_pack apply to their dates.
    expect(issuedWithinMonthWindow({ ...base, invoice_date: '2026-01-01' }, window)).toBe(true);
    expect(issuedWithinMonthWindow({ ...base, invoice_date: '2026-03-31' }, window)).toBe(true);
    expect(issuedWithinMonthWindow({ ...base, invoice_date: '2025-12-31' }, window)).toBe(false);
    expect(issuedWithinMonthWindow({ ...base, invoice_date: '2026-04-01' }, window)).toBe(false);
    // The pack never counts drafts or cancellations, and an undated invoice has no month.
    expect(issuedWithinMonthWindow({ ...base, status: 'Draft' }, window)).toBe(false);
    expect(issuedWithinMonthWindow({ ...base, status: 'Cancelled' }, window)).toBe(false);
    expect(issuedWithinMonthWindow({ ...base, erp_cancelled_at: '2026-02-16T00:00:00+00:00' }, window)).toBe(false);
    expect(issuedWithinMonthWindow({ ...base, erp_docstatus: 2 }, window)).toBe(false);
    expect(issuedWithinMonthWindow({ ...base, invoice_date: null }, window)).toBe(false);
  });
});
