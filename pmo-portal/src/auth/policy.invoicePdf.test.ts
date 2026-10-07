import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

describe('#912 download_pdf policy (mirrors external-invoice-pdf)', () => {
  it('AC-PDF-003 only Admin and Finance may download a submitted ERP invoice', () => {
    const record = { status: 'Unpaid', erp_docstatus: 1 };
    expect(ROLES.filter((r) => can('download_pdf', 'salesInvoice', { realRole: r, record }))).toEqual(['Admin', 'Finance']);
  });

  it('AC-PDF-003 only a submitted, ERP-owned invoice is downloadable', () => {
    const cases: Array<[Record<string, unknown> | undefined, boolean]> = [
      [{ status: 'Unpaid', erp_docstatus: 1 }, true],
      [{ status: 'Paid', erp_docstatus: 1 }, true],
      [{ status: 'Submitted', erp_docstatus: 1 }, true],
      [{ status: 'Draft', erp_docstatus: 0 }, false],
      [{ status: 'Cancelled', erp_docstatus: 2 }, false],
      [{ status: 'Unpaid', erp_docstatus: null }, false],
      [{ status: 'Draft', erp_docstatus: 1 }, false],
      [undefined, false],
    ];
    for (const [record, expected] of cases) {
      expect(can('download_pdf', 'salesInvoice', { realRole: 'Finance', record }), JSON.stringify(record)).toBe(expected);
    }
  });
});
