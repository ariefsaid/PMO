import { describe, expect, it } from 'vitest';
import { OPEN_CLIENT_INVOICE_STATUSES, isOpenClientInvoiceStatus } from './clientInvoiceStatus';

describe('open client-invoice statuses (#1459: one declaration)', () => {
  it('is the Submitted + Unpaid pair, in the order the list reads', () => {
    expect([...OPEN_CLIENT_INVOICE_STATUSES]).toEqual(['Submitted', 'Unpaid']);
  });

  it('reads a status without the caller re-listing the pair', () => {
    expect(isOpenClientInvoiceStatus('Submitted')).toBe(true);
    expect(isOpenClientInvoiceStatus('Unpaid')).toBe(true);
    expect(isOpenClientInvoiceStatus('Paid')).toBe(false);
    expect(isOpenClientInvoiceStatus('Draft')).toBe(false);
    expect(isOpenClientInvoiceStatus('Cancelled')).toBe(false);
  });
});
