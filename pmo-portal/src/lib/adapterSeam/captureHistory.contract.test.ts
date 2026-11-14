import { expect, it } from 'vitest';
import { collectPages, proposeCapture, reconcileCapture } from './captureHistory';
import { createCaptureAdapter } from './odoo/captureHistory';
import { createCaptureAdapter as createErpnextAdapter } from './erpnext/captureHistory';

it('AC-ROP-021 Odoo names missing capabilities and cannot return an empty success', async () => {
  const result = await collectPages(createCaptureAdapter().listSources, { limit: 2 });
  expect(result.complete).toBe(false);
  expect(result.missing).toContain('purchase_source_feed');
  expect(result.missing).toContain('ledger_feed');
});
it('AC-ROP-021 ERPNext preserves page and generation evidence supplied by its reader', async () => {
  const adapter = createErpnextAdapter(async cursor => ({ supported: true as const, generation: 'g', nextCursor: cursor ? null : 'next', items: [] }), undefined, { sourceId: 'b', generation: 'g', linesAvailable: true, familiesAvailable: true, currencyAvailable: true });
  expect(await collectPages(adapter.listSources, { limit: 2 })).toMatchObject({ complete: true, generation: 'g', items: [] });
});
it('AC-ROP-021 read failure is incomplete rather than a zero census', async () => {
  expect(await collectPages(async () => { throw new Error('failed'); }, { limit: 1 })).toMatchObject({ complete: false, missing: ['read_failed'] });
});
it('AC-ROP-021 ERPNext cannot claim an empty complete feed without trusted capability evidence', async () => {
  const adapter = createErpnextAdapter(async () => ({ supported: true as const, generation: 'g', nextCursor: null, items: [] }));
  const result = await collectPages(adapter.listSources, { limit: 1 });
  expect(result.complete).toBe(false);
  expect(result.missing).toContain('source_capability_evidence');
});
it('AC-ROP-021 unsupported ERPNext capability names each absent evidence class', async () => {
  const adapter = createErpnextAdapter(async () => ({ supported: true as const, generation: 'g', nextCursor: null, items: [] }));
  const result = await collectPages(adapter.listSources, { limit: 1 });
  expect(result.missing).toEqual(expect.arrayContaining(['source_binding', 'source_generation', 'family_evidence', 'currency_evidence']));
});

it('AC-ROP-018 and AC-ROP-021 compose nonempty ERPNext sources without claiming item coverage', async () => {
  const rows = ['Purchase Order', 'Purchase Invoice'].map((kind, i) => ({ id: String(i), row: { id: String(i), erp_doctype: kind, erp_name: String(i), erp_docstatus: 1, erp_status: i ? 'Unpaid' : 'To Receive', erp_modified: 'v', supplier: 's', supplier_name: null, doc_date: null, currency: 'USD', net_total: '1', is_return: false, purchase_orders: [] }, evidence: { sourceId: 'b', projectIds: ['p'], familyId: 'f', purchaseId: null, supplierId: 's', scale: 2, scaleCurrency: 'USD' } }));
  const adapter = createErpnextAdapter(async () => ({ supported: true as const, generation: 'g', nextCursor: null, items: rows }), undefined, { sourceId: 'b', generation: 'g', linesAvailable: false, familiesAvailable: true, currencyAvailable: true });
  const result = await collectPages(adapter.listSources, { limit: 1 });
  expect(result.complete).toBe(true);
  expect(result.items.map(({ id, kind }) => ({ id, kind }))).toEqual([{ id: '0', kind: 'order' }, { id: '1', kind: 'supplier_invoice' }]);
  expect(proposeCapture(result.items, null, { sourceId: 'b', generation: 'g', accountScope: 'mapped', complete: true, classifications: { '1': 'mapped' } }).map(x => x.outcome)).toEqual(['propose', 'propose']);
  const scope = { sourceId: 'b', projectId: 'p', currency: 'USD', scale: 2, accountScope: 'mapped', generation: 'g', asOf: 'now' };
  expect(reconcileCapture({ scope, complete: true, ledgerGeneration: 'g', documents: result.items, lines: [{ id: 'l', sourceId: 'b', currency: 'USD', projectId: 'p', documentId: '1', amountMinor: '100', kind: 'supplier_invoice', classification: 'mapped' }] })).toMatchObject({ complete: true, ledgerMinor: '100', itemCoverage: { complete: false, missing: ['line_evidence'] } });
});

it('AC-ROP-021 binding adapters expose explicit capability and require a witnessed company', async () => {
  const { createCaptureAdapter: erpBinding } = await import('./erpnext/captureAdapter');
  const { createCaptureAdapter: odooBinding } = await import('./odoo/captureAdapter');
  const resolve = async () => ({ client: { fetchImpl: fetch, apiKey: 'synthetic', apiSecret: 'synthetic', baseUrl: 'https://example.test' }, config: { company: 'Example' } });
  expect(await erpBinding({}, resolve)).toMatchObject({ supported: false, missing: ['company_unknown'] });
  expect(await erpBinding({ company: 'Another' }, resolve)).toMatchObject({ supported: false, missing: ['erp_reader_unavailable'] });
  expect(await erpBinding({ company: 'Example' }, resolve)).toMatchObject({ supported: true, company: 'Example' });
  expect(await odooBinding()).toMatchObject({ supported: false, missing: expect.arrayContaining(['odoo_purchase_capture', 'purchase_source_feed', 'ledger_feed']) });
});
