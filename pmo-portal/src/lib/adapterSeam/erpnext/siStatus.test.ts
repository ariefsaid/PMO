/**
 * erpnext/siStatus.ts — SI status derivation (FR-SAR-103, AC-SAR-030 companion).
 * Matrix: docstatus × erp_outstanding_amount → status.
 */
import { describe, expect, it } from 'vitest';
import { deriveSiStatus, type SalesInvoiceStatus } from './siStatus.ts';

describe('erpnext/siStatus — AC-SAR-030 SI status derivation', () => {
  const matrix: Array<{
    desc: string;
    docstatus: number | null;
    outstanding: string | null | undefined;
    expected: SalesInvoiceStatus;
  }> = [
    { desc: 'docstatus 0, outstanding null → Draft', docstatus: 0, outstanding: null, expected: 'Draft' },
    { desc: 'docstatus null, outstanding "0" → Draft', docstatus: null, outstanding: '0', expected: 'Draft' },
    { desc: 'docstatus 1, outstanding "0" → Paid (server flip)', docstatus: 1, outstanding: '0', expected: 'Paid' },
    { desc: 'docstatus 1, outstanding "0.00" → Paid', docstatus: 1, outstanding: '0.00', expected: 'Paid' },
    { desc: 'docstatus 1, outstanding "150000.00" → Unpaid', docstatus: 1, outstanding: '150000.00', expected: 'Unpaid' },
    { desc: 'docstatus 1, outstanding "100.50" → Unpaid', docstatus: 1, outstanding: '100.50', expected: 'Unpaid' },
    { desc: 'docstatus 2, outstanding "0" → Cancelled (precedence)', docstatus: 2, outstanding: '0', expected: 'Cancelled' },
    { desc: 'docstatus 2, outstanding "150000.00" → Cancelled (precedence)', docstatus: 2, outstanding: '150000.00', expected: 'Cancelled' },
    { desc: 'docstatus 2, outstanding null → Cancelled (precedence)', docstatus: 2, outstanding: null, expected: 'Cancelled' },
    { desc: 'docstatus 1, outstanding undefined → Unpaid (missing = not zero)', docstatus: 1, outstanding: undefined, expected: 'Unpaid' },
    { desc: 'docstatus 1, outstanding "" → Unpaid (empty = not zero)', docstatus: 1, outstanding: '', expected: 'Unpaid' },
  ];

  for (const { desc, docstatus, outstanding, expected } of matrix) {
    it(desc, () => {
      expect(deriveSiStatus(outstanding, docstatus)).toBe(expected);
    });
  }

  it('type guard: result is always one of the five status values', () => {
    const status = deriveSiStatus('100.00', 1);
    const valid: SalesInvoiceStatus[] = ['Draft', 'Submitted', 'Unpaid', 'Paid', 'Cancelled'];
    expect(valid.includes(status)).toBe(true);
  });
});