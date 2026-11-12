import { expect, it } from 'vitest';
import { normaliseDocument, normaliseLedger, toMinorUnits } from './captureHistory';

it('AC-ROP-023 partial: translates mirror states without inventing line facts', () => {
  const row = { id: 'd', erp_doctype: 'Purchase Invoice', erp_name: 'INV', erp_docstatus: 1, erp_status: 'Partly Paid', erp_modified: 'v', supplier: 's', supplier_name: null, doc_date: null, currency: 'USD', net_total: '1.23', is_return: false, purchase_orders: [] };
  expect(normaliseDocument(row, { sourceId: 'binding', projectIds: ['p'], familyId: null, purchaseId: null, scale: 2, scaleCurrency: 'USD' })).toMatchObject({ kind: 'supplier_invoice', state: 'part_paid', version: 'v', faceMinor: '123', missing: ['line_evidence', 'family_evidence'] });
  expect(normaliseDocument({ ...row, erp_doctype: 'future type' }, { sourceId: 'binding', projectIds: [], familyId: null, purchaseId: null, scale: null }).kind).toBe('other');
});
it('AC-ROP-018 applies explicit scale exactly and rejects excess precision', () => {
  expect(toMinorUnits('90071992547409.123', 3)).toBe('90071992547409123');
  expect(toMinorUnits('-12', 0)).toBe('-12');
  expect(() => toMinorUnits('1.01', 0)).toThrow();
});
it('AC-ROP-018 leaves ambiguous project mappings and missing classification unresolved', () => {
  const row = { id: 'l', project: 'P', voucher_type: 'Journal Entry', debit: '2', credit: '1' };
  expect(normaliseLedger(row, { p: 'P', q: 'P' }, { sourceId: 'b', currency: 'USD', scale: 0, documentId: null, classification: 'unknown' })).toMatchObject({ projectId: null, reason: 'project_unmapped', line: { amountMinor: '1', classification: 'unknown' } });
});
it('AC-ROP-021 ledger reader supplies explicit scoped evidence on every page', async () => {
  const { createCaptureAdapter } = await import('./captureHistory');
  const { collectPages } = await import('../captureHistory');
  const adapter = createCaptureAdapter(async () => ({ supported: true as const, generation: 'g', items: [], nextCursor: null }), async cursor => ({ supported: true as const, generation: 'g', items: [{ id: cursor ?? 'a', row: { id: cursor ?? 'a', project: 'P', voucher_type: 'Journal Entry', debit: '5', credit: '1' }, projectMap: { p: 'P' }, evidence: { sourceId: 'b', currency: 'USD', scale: 0, documentId: null, classification: 'mapped' as const } }], nextCursor: cursor ? null : 'next' }));
  const result = await collectPages(adapter.listLedger, { limit: 2, expectedGeneration: 'g' });
  expect(result).toMatchObject({ complete: true, items: [{ id: 'a', projectId: 'p', line: { amountMinor: '4' } }, { id: 'next' }] });
});
it('AC-ROP-017 raw supplier identity is not a mapped supplier', () => {
  const row = { id: 'd', erp_doctype: 'Purchase Order', erp_name: 'PO', erp_docstatus: 1, erp_status: 'Open', erp_modified: 'v', supplier: 'ERP-ID', supplier_name: null, doc_date: null, currency: 'USD', net_total: '1', is_return: false, purchase_orders: [] };
  expect(normaliseDocument(row, { sourceId: 'binding', projectIds: ['p'], familyId: 'f', purchaseId: null, scale: 2, supplierId: null }).supplierId).toBeNull();
});
it('AC-ROP-023 unknown invoice status remains unknown', () => {
  const row = { id: 'd', erp_doctype: 'Purchase Invoice', erp_name: 'INV', erp_docstatus: 1, erp_status: 'Unexpected', erp_modified: 'v', supplier: 's', supplier_name: null, doc_date: null, currency: 'USD', net_total: '1', is_return: false, purchase_orders: [] };
  expect(normaliseDocument(row, { sourceId: 'binding', projectIds: ['p'], familyId: 'f', purchaseId: null, scale: 2, scaleCurrency: 'USD' }).state).toBe('unknown');
});
it('AC-ROP-018 face scale must be tied to the matching currency', () => {
  const row = { id: 'd', erp_doctype: 'Purchase Invoice', erp_name: 'INV', erp_docstatus: 1, erp_status: 'Unpaid', erp_modified: 'v', supplier: 's', supplier_name: null, doc_date: null, currency: 'USD', net_total: '1.23', is_return: false, purchase_orders: [] };
  expect(normaliseDocument(row, { sourceId: 'binding', projectIds: ['p'], familyId: 'f', purchaseId: null, scale: 2, scaleCurrency: 'JPY' }).faceMinor).toBeNull();
});
it('AC-ROP-023 face money retains its explicit scale', () => {
  const row = { id: 'd', erp_doctype: 'Purchase Order', erp_name: 'PO', erp_docstatus: 1, erp_status: 'To Receive', erp_modified: 'v', supplier: 's', supplier_name: null, doc_date: null, currency: 'KWD', net_total: '1.123', is_return: false, purchase_orders: [] };
  expect(normaliseDocument(row, { sourceId: 'b', projectIds: ['p'], familyId: 'f', purchaseId: null, scale: 3, scaleCurrency: 'KWD' })).toMatchObject({ faceMinor: '1123', faceScale: 3 });
});
it('AC-ROP-017 preserves trusted existing purchase origin for strong matches', () => {
  const row = { id: 'd', erp_doctype: 'Purchase Order', erp_name: 'PO', erp_docstatus: 1, erp_status: 'To Receive', erp_modified: 'v', supplier: 's', supplier_name: null, doc_date: null, currency: 'USD', net_total: '1', is_return: false, purchase_orders: [] };
  expect(normaliseDocument(row, { sourceId: 'b', projectIds: ['p'], familyId: 'f', purchaseId: 'p1', purchaseOrigin: 'erp_link', scale: 2, scaleCurrency: 'USD' }).purchaseOrigin).toBe('erp_link');
});
it('AC-ROP-023 unknown order status is not presented as an open order', () => {
  const row = { id: 'd', erp_doctype: 'Purchase Order', erp_name: 'PO', erp_docstatus: 1, erp_status: null, erp_modified: 'v', supplier: 's', supplier_name: null, doc_date: null, currency: 'USD', net_total: '1', is_return: false, purchase_orders: [] };
  expect(normaliseDocument(row, { sourceId: 'b', projectIds: ['p'], familyId: 'f', purchaseId: null, scale: 2, scaleCurrency: 'USD' }).state).toBe('unknown');
});
