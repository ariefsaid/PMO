import { describe, expect, it } from 'vitest';
import { figureForListRow, matchesSearch } from './model';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1', title: 'Pump replacement', code: 'PR-25', status: 'Ordered', currency: 'USD', total_value: 500,
  vendor: { name: 'Northstar Industrial' }, requested_by: { full_name: 'Alex Morgan' },
  purchase_requests: [], purchase_orders: [], procurement_invoices: [], payments: [],
  pr_refs: [], po_refs: [{ external_ref: 'ERP-PO-91' }], vi_refs: [],
  ...overrides,
}) as unknown as ProcurementWithRefs & { erpDocuments?: { doctype: string; grand_total: number; outstanding_amount: number | null }[] };

describe('procurement list model', () => {
  it('QI-4 includes linked ERP purchase orders in the same value figure as the table', () => {
    const procurement = row({
      purchase_orders: [{ amount: 500 }],
      erpDocuments: [{ doctype: 'Purchase Order', grand_total: 1_250, outstanding_amount: 1_250 }],
    });
    expect(figureForListRow(procurement, 'Finance')).toMatchObject({ amount: 1_750, kind: 'ordered', unknown: false });
  });

  it('QI-7 matches title, code, supplier, requester, status, and linked references consistently', () => {
    const procurement = row();
    for (const needle of ['pump', 'PR-25', 'northstar', 'alex morgan', 'ordered', 'ERP-PO-91']) {
      expect(matchesSearch(procurement, needle), needle).toBe(true);
    }
    expect(matchesSearch(procurement, 'unmatched')).toBe(false);
    expect(matchesSearch(procurement, '  ')).toBe(true);
  });
});
