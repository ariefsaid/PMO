import { describe, expect, it } from 'vitest';
import { normalisePurchaseMirror } from './captureHistory';
import { purchaseCaptureCapability as odooCapability } from '../odoo/captureHistory';

describe('AC-ROP-021 purchase capture adapter contract', () => {
  it('normalises a mirrored order with an opaque id, project and source revision', () => {
    expect(normalisePurchaseMirror({ id: 'doc-1', erp_doctype: 'Purchase Order', erp_name: 'PO-1',
      erp_docstatus: 1, erp_status: 'To Receive', erp_modified: 'rev-1', project_ids: ['p1'],
      procurement_id: null, supplier: 'supplier-1', supplier_name: 'Supplier', doc_date: '2026-01-01', currency: 'USD', net_total: '12.00',
      is_return: false, purchase_orders: [] })).toMatchObject({
      id: 'doc-1', kind: 'order', state: 'ordered', projectIds: ['p1'], version: 'rev-1',
      purchaseId: null, reference: 'PO-1', currency: 'USD', amount: '12.00',
    });
  });
  it('names an unsupported Odoo capture instead of returning an empty census', () => {
    expect(odooCapability()).toEqual({ supported: false, missing: ['purchase capture source evidence'] });
  });
});

it('AC-ROP-021 pages every normalized mirrored document without assuming a page limit', async () => {
  const { createPurchaseCaptureAdapter } = await import('./captureHistory');
  const { collectCaptureSources } = await import('../captureHistory');
  const row = { id: 'doc-1', erp_doctype: 'Purchase Order' as const, erp_name: 'PO-1', erp_docstatus: 1,
    erp_status: 'To Receive', erp_modified: 'rev-1', project_ids: ['p1'], procurement_id: null,
    supplier: 's', supplier_name: 'S', doc_date: '2026-01-01', currency: 'USD', net_total: '12.00',
    is_return: false, purchase_orders: [] };
  const adapter = createPurchaseCaptureAdapter(async (cursor) => cursor === null
    ? { rows: [row], nextCursor: 'next', revision: 'generation' }
    : { rows: [{ ...row, id: 'doc-2', erp_name: 'PO-2' }], nextCursor: null, revision: 'generation' });
  const result = await collectCaptureSources(adapter);
  expect(result).toMatchObject({ complete: true, sources: [{ id: 'doc-1' }, { id: 'doc-2' }] });
});

it('AC-ROP-021 an unavailable feed is never an empty successful census', async () => {
  const { collectCaptureSources } = await import('../captureHistory');
  const { createPurchaseCaptureAdapter } = await import('../odoo/captureHistory');
  expect(await collectCaptureSources(createPurchaseCaptureAdapter())).toEqual({ complete: false, sources: [], missing: ['purchase capture source evidence'] });
});

it('AC-ROP-018 a census whose source generation changes between pages is incomplete', async () => {
  const { collectCaptureSources } = await import('../captureHistory');
  const adapter = { listSources: async (cursor: string | null) => cursor === null
    ? { supported: true as const, sources: [], nextCursor: 'next', revision: 'first' }
    : { supported: true as const, sources: [], nextCursor: null, revision: 'second' } };
  const result = await collectCaptureSources(adapter);
  expect(result.complete).toBe(false);
  expect(result.missing).toContain('source generation changed');
});

it('AC-ROP-021 does not claim completeness when the same source is repeated across pages', async () => {
  const { collectCaptureSources } = await import('../captureHistory');
  const row = { id: 'same', kind: 'order' as const, state: 'ordered' as const, projectIds: ['p'], version: '1', purchaseId: null };
  const adapter = { listSources: async (cursor: string | null) => cursor === null
    ? { supported: true as const, sources: [row], nextCursor: 'next', revision: 'v' }
    : { supported: true as const, sources: [row], nextCursor: null, revision: 'v' } };
  const result = await collectCaptureSources(adapter);
  expect(result.complete).toBe(false);
  expect(result.missing).toContain('duplicate source identity');
});

it('AC-ROP-018 classifies capital invoices distinctly and refuses an unknown account basis', () => {
  const base = { id: 'bill', erp_doctype: 'Purchase Invoice' as const, erp_name: 'BILL', erp_docstatus: 1,
    erp_status: 'Unpaid', erp_modified: 'rev', project_ids: ['p'], procurement_id: null,
    supplier: 's', supplier_name: 'S', doc_date: '2026-01-01', currency: 'USD', net_total: '12.00',
    is_return: false, purchase_orders: [] };
  expect(normalisePurchaseMirror({ ...base, account_class: 'capital_spending' }).kind).toBe('capital_spending');
  expect(normalisePurchaseMirror({ ...base, account_class: 'unknown' }).kind).toBe('other');
  expect(normalisePurchaseMirror({ ...base, account_class: 'expense' }).kind).toBe('supplier_invoice');
  expect(normalisePurchaseMirror({ ...base, account_class: 'mixed' })).toMatchObject({ kind: 'supplier_invoice', accountClass: 'mixed' });
});

it('AC-ROP-018 normalizes ledger money exactly and links invoice cost to its opaque source', async () => {
  const { normaliseCaptureLedger } = await import('./captureHistory');
  const result = normaliseCaptureLedger({ id: 'gl-1', project: 'ERP-A', voucher_type: 'Purchase Invoice', voucher_no: 'PINV-1',
    debit: '90071992547409.91', credit: '0.01', mapped: true }, { p1: 'ERP-A' }, [
    { id: 'doc', erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1' },
  ]);
  expect(result).toEqual({ projectId: 'p1', line: { id: 'gl-1', documentId: 'doc', amountCents: '9007199254740990', kind: 'supplier_invoice' } });
});

it('AC-ROP-018 refuses an ambiguous project map instead of assigning a ledger line by guess', async () => {
  const { normaliseCaptureLedger } = await import('./captureHistory');
  expect(normaliseCaptureLedger({ id: 'gl-2', project: 'ERP-A', voucher_type: 'Journal Entry', voucher_no: 'JV', debit: '1.00', credit: '0.00', mapped: true },
    { p1: 'ERP-A', p2: 'ERP-A' }, [])).toMatchObject({ projectId: null, reason: 'project_unmapped' });
});

it('AC-ROP-018 identifies the capital portion of a mixed invoice separately from overhead', async () => {
  const { normaliseCaptureLedger } = await import('./captureHistory');
  expect(normaliseCaptureLedger({ id: 'gl-cap', project: 'ERP-A', voucher_type: 'Purchase Invoice', voucher_no: 'PINV-M',
    debit: '15.00', credit: '0.00', mapped: false }, { p1: 'ERP-A' }, [
    { id: 'doc', erp_doctype: 'Purchase Invoice', erp_name: 'PINV-M', account_class: 'mixed' },
  ])).toMatchObject({ projectId: 'p1', line: { kind: 'capital_spending', amountCents: '1500' } });
});

it('AC-ROP-018 does not present a closed order as an open commitment', () => {
  const source = normalisePurchaseMirror({ id: 'closed-po', erp_doctype: 'Purchase Order', erp_name: 'PO-C', erp_docstatus: 1,
    erp_status: 'Closed', erp_modified: 'rev', project_ids: ['p'], procurement_id: 'purchase',
    supplier: null, supplier_name: null, doc_date: null, currency: 'USD', net_total: '12.00',
    is_return: false, purchase_orders: [] });
  expect(source.state).not.toBe('ordered');
});
