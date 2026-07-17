/**
 * erpnext/piStatus.ts (task 6.12): derives procurement_invoices.status from erp_outstanding_amount
 * (R9 paid-detection).
 */
import { describe, expect, it } from 'vitest';
import { derivePiStatus } from './piStatus.ts';

describe('erpnext/piStatus — derivePiStatus', () => {
  it('AC-ENA (task 6.12) erp_outstanding_amount "0.00" -> Paid', () => {
    expect(derivePiStatus('0.00')).toBe('Paid');
  });

  it('erp_outstanding_amount "0" -> Paid (any zero-valued decimal string)', () => {
    expect(derivePiStatus('0')).toBe('Paid');
  });

  it('a positive outstanding amount -> Received (not yet paid)', () => {
    expect(derivePiStatus('150000.00')).toBe('Received');
  });

  it('null (not yet returned/derived) -> Received', () => {
    expect(derivePiStatus(null)).toBe('Received');
  });

  it('undefined -> Received', () => {
    expect(derivePiStatus(undefined)).toBe('Received');
  });
});
