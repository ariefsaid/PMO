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
