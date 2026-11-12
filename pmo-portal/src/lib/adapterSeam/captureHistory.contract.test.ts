import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { reconcileCapture } from './captureHistory.ts';

test('AC-ROP-018 signed ledger components reconcile without adding purchase face values', () => {
  const report = reconcileCapture({ projectId: 'p1', currency: 'USD', complete: true,
    ledger: [
      { id: 'a', documentId: 'inv', amountCents: '10000', kind: 'supplier_invoice' },
      { id: 'b', documentId: 'j', amountCents: '-1200', kind: 'journal' },
    ],
    documents: [
      { id: 'inv', projectId: 'p1', purchaseId: 'purchase', kind: 'supplier_invoice', state: 'invoiced' },
      { id: 'order', projectId: 'p1', purchaseId: 'purchase', kind: 'order', state: 'ordered' },
    ],
  });
  assert.equal(report.ledgerTotalCents, '8800');
  assert.equal(report.coveredTotalCents, '10000');
  assert.equal(report.remainderTotalCents, '-1200');
  assert.equal(report.remainder[0]?.reason, 'journal');
  assert.deepEqual(report.openOrders.map((d) => d.id), ['order']);
});

test('AC-ROP-018 an incomplete source census cannot claim zero or completeness', () => {
  const report = reconcileCapture({ projectId: 'p1', currency: 'USD', complete: false, ledger: [], documents: [] });
  assert.equal(report.complete, false);
  assert.equal(report.ledgerTotalCents, null);
});
