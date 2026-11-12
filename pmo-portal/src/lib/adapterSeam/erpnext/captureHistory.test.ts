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
