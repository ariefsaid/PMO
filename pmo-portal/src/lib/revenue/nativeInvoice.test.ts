import { describe, it, expect } from 'vitest';
import {
  invoiceGross,
  invoiceNumber,
  isPartlyPaid,
  nativeInvoiceSummary,
  overpaidBy,
  receiptNumber,
} from './nativeInvoice';

const unpaid = { pmo_native: true, status: 'Unpaid' as const, amount: 1_000_000, tax_amount: 110_000, tax_treatment: 'exclusive', erp_outstanding_amount: 610_000 };

describe('nativeInvoice display rules (#784)', () => {
  it('AC-NAR-003 an exclusive invoice owes its amount plus tax; an inclusive one owes its amount', () => {
    expect(invoiceGross(unpaid)).toBe(1_110_000);
    expect(invoiceGross({ amount: 1_110_000, tax_amount: 110_000, tax_treatment: 'inclusive' })).toBe(1_110_000);
    expect(invoiceGross({ amount: null, tax_amount: 0, tax_treatment: 'exclusive' })).toBeNull();
  });
  it('AC-NAR-003 a PMO invoice with part of its gross settled is Partly paid', () => {
    expect(isPartlyPaid(unpaid)).toBe(true);
  });
  it('AC-NAR-003 nothing settled, fully settled, Paid, or an ERP invoice is never Partly paid', () => {
    expect(isPartlyPaid({ ...unpaid, erp_outstanding_amount: 1_110_000 })).toBe(false);
    expect(isPartlyPaid({ ...unpaid, erp_outstanding_amount: 0 })).toBe(false);
    expect(isPartlyPaid({ ...unpaid, status: 'Paid' })).toBe(false);
    expect(isPartlyPaid({ ...unpaid, pmo_native: false })).toBe(false);
    expect(isPartlyPaid({ ...unpaid, erp_outstanding_amount: null })).toBe(false);
  });
  it('AC-NAR-003 (DD-NAR-17) a PMO invoice paid beyond its gross reads the excess; otherwise nothing', () => {
    expect(overpaidBy({ pmo_native: true, overpaid_amount: 90_000 })).toBe(90_000);
    expect(overpaidBy({ pmo_native: true, overpaid_amount: 0 })).toBeNull();
    expect(overpaidBy({ pmo_native: true, overpaid_amount: null })).toBeNull();
    expect(overpaidBy({ pmo_native: true })).toBeNull();
    expect(overpaidBy({ pmo_native: false, overpaid_amount: 90_000 })).toBeNull();
  });
  it('AC-NAR-002 the number read is the ERP number, else the PMO number', () => {
    expect(invoiceNumber({ si_number: 'ACC-SINV-1', pmo_number: null })).toBe('ACC-SINV-1');
    expect(invoiceNumber({ si_number: null, pmo_number: 'INV-2610070001' })).toBe('INV-2610070001');
    expect(invoiceNumber({ si_number: null })).toBeNull();
    expect(receiptNumber({ ip_number: null, pmo_number: 'RCV-2610070001' })).toBe('RCV-2610070001');
    expect(receiptNumber({ ip_number: 'ACC-PAY-1', pmo_number: null })).toBe('ACC-PAY-1');
  });
  it('AC-NAR-002 a PMO invoice is summarised by its first line and how many more', () => {
    const line = { item_code: 'SVC', description: 'Site survey', qty: 1, rate: 1, amount: 1 };
    expect(nativeInvoiceSummary({ native_lines: [line] })).toBe('Site survey');
    expect(nativeInvoiceSummary({ native_lines: [line, { ...line, description: null }] })).toBe('Site survey +1');
    expect(nativeInvoiceSummary({ native_lines: [{ ...line, description: null }] })).toBe('SVC');
    expect(nativeInvoiceSummary({ native_lines: null })).toBeNull();
  });
});
