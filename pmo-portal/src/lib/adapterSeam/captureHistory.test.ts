import { describe, expect, it } from 'vitest';
import { reconcileCapture } from './captureHistory';

describe('AC-ROP-018 capture census', () => {
  it('reconciles signed ledger lines, with uncovered lines named and orders separate', () => {
    const result = reconcileCapture({
      projectId: 'p1', currency: 'USD', complete: true,
      ledger: [
        { id: 'line-1', documentId: 'invoice-1', amountCents: '125', kind: 'supplier_invoice' },
        { id: 'line-2', documentId: 'journal-1', amountCents: '-25', kind: 'journal' },
      ],
      documents: [
        { id: 'invoice-1', projectId: 'p1', purchaseId: 'purchase-1', kind: 'supplier_invoice', state: 'invoiced' },
        { id: 'order-1', projectId: 'p1', purchaseId: 'purchase-2', kind: 'order', state: 'ordered' },
      ],
    });
    expect(result).toMatchObject({ ledgerTotalCents: '100', coveredTotalCents: '125', remainderTotalCents: '-25', complete: true });
    expect(result.remainder).toEqual([{ id: 'line-2', documentId: 'journal-1', amountCents: '-25', kind: 'journal', reason: 'journal' }]);
    expect(result.openOrders.map((order) => order.id)).toEqual(['order-1']);
  });

  it('never labels a partial census complete and does not invent a zero ledger total', () => {
    const result = reconcileCapture({ projectId: 'p1', currency: 'USD', complete: false, ledger: [], documents: [] });
    expect(result.complete).toBe(false);
    expect(result.ledgerTotalCents).toBeNull();
  });

  it('never counts a different project purchase as covering this project line', () => {
    const result = reconcileCapture({ projectId: 'p1', currency: 'USD', complete: true,
      ledger: [{ id: 'l1', documentId: 'i1', amountCents: '50', kind: 'supplier_invoice' }],
      documents: [{ id: 'i1', projectId: 'p2', purchaseId: 'purchase-2', kind: 'supplier_invoice', state: 'invoiced' }],
    });
    expect(result.coveredTotalCents).toBe('0');
    expect(result.remainderTotalCents).toBe('50');
  });

  it('rejects duplicate source lines and non-integer amounts', () => {
    const line = { id: 'l1', documentId: 'i1', amountCents: '1', kind: 'journal' as const };
    expect(() => reconcileCapture({ projectId: 'p1', currency: 'USD', complete: true, ledger: [line, line], documents: [] })).toThrow();
    expect(() => reconcileCapture({ projectId: 'p1', currency: 'USD', complete: true, ledger: [{ ...line, amountCents: '1.5' }], documents: [] })).toThrow();
  });

  it('names capital spending separately from overhead', () => {
    const report = reconcileCapture({ projectId: 'p1', currency: 'USD', complete: true,
      ledger: [{ id: 'cap', documentId: 'bill', amountCents: '700', kind: 'capital_spending' }], documents: [],
    });
    expect(report.remainder[0]?.reason).toBe('capital_spending');
    expect(report.ledgerTotalCents).toBe('0');
    expect(report.remainderTotalCents).toBe('0');
  });
});

describe('AC-ROP-017 capture proposals', () => {
  it('proposes only eligible single-project sources, retains revisions and reuses matches', async () => {
    const { proposeCapture } = await import('./captureHistory');
    const result = proposeCapture([
      { id: 'a', kind: 'order', state: 'ordered', projectIds: ['p'], version: 'v1', purchaseId: null },
      { id: 'b', kind: 'supplier_invoice', state: 'invoiced', projectIds: ['p'], version: 'v2', purchaseId: 'existing' },
      { id: 'c', kind: 'supplier_invoice', state: 'invoiced', projectIds: [], version: 'v3', purchaseId: null },
      { id: 'd', kind: 'supplier_invoice', state: 'invoiced', projectIds: ['p', 'q'], version: 'v4', purchaseId: null },
    ], 'p');
    expect(result).toEqual([
      { id: 'a', outcome: 'propose', version: 'v1', projectId: 'p' },
      { id: 'b', outcome: 'matched', version: 'v2', projectId: 'p', purchaseId: 'existing' },
      { id: 'c', outcome: 'remainder', version: 'v3', reason: 'no_project' },
      { id: 'd', outcome: 'remainder', version: 'v4', reason: 'spans_projects' },
    ]);
  });

  it('never treats unsupported, cancelled or capital sources as capturable', async () => {
    const { proposeCapture } = await import('./captureHistory');
    const result = proposeCapture([
      { id: 'a', kind: 'journal', state: 'invoiced', projectIds: ['p'], version: '1', purchaseId: null },
      { id: 'b', kind: 'supplier_invoice', state: 'cancelled', projectIds: ['p'], version: '2', purchaseId: null },
      { id: 'c', kind: 'capital_spending', state: 'invoiced', projectIds: ['p'], version: '3', purchaseId: null },
    ], 'p');
    expect(result.map((r) => r.reason)).toEqual(['journal', 'cancelled', 'capital_spending']);
  });
});
