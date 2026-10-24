/** FR-EPR-004/006/007, FR-PFE-020/031/032/041 — the client read hides cancelled and PMO-pushed documents, scopes to a project,
 *  maps rows (incl. link state); link/unlink go only through the RPCs. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'contains', 'order', 'gt', 'limit']) {
    chain[m] = (...args: unknown[]) => { calls.push([m, args]); return chain; };
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return {
    calls,
    from: vi.fn((table: string) => { calls.push(['from', [table]]); return chain; }),
    set: (r: typeof result) => { result = r; },
    rpc: vi.fn(),
  };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  hasErpPurchases, linkErpPurchaseDocuments, listErpPurchases, listLinkedErpDocuments, unlinkErpPurchaseDocument,
} from './erpPurchases';

const db = (over: Record<string, unknown>) => ({
  id: 'a', erp_doctype: 'Purchase Invoice', erp_name: 'PINV-A', supplier: 'SUP-1', supplier_name: null, doc_date: '2026-01-01',
  due_date: null, bill_no: null, currency: 'IDR', grand_total: '100.00', outstanding_amount: '0.00', erp_status: 'Paid',
  is_return: false, project_ids: ['p1'], net_total: '90.00', procurement_id: null, link_id: null, ...over,
});

beforeEach(() => { h.calls.length = 0; h.set({ data: [], error: null }); h.rpc.mockReset(); });

describe('erpPurchases repository', () => {
  it('reads only submitted, ERP-native documents of the project, newest first, with numeric money', async () => {
    h.set({ data: [db({}), db({ id: 'b', erp_name: 'PINV-B', doc_date: '2026-03-01', supplier_name: 'Beta' })], error: null });
    const rows = await listErpPurchases('p1');
    expect(h.calls).toContainEqual(['from', ['erp_purchase_documents_linked']]);
    expect(h.calls).toContainEqual(['eq', ['erp_docstatus', 1]]);
    expect(h.calls).toContainEqual(['eq', ['pmo_owned', false]]);
    expect(h.calls).toContainEqual(['contains', ['project_ids', ['p1']]]);
    expect(rows.map((r) => r.name)).toEqual(['PINV-B', 'PINV-A']);
    expect(rows[0].supplier).toBe('Beta');
    expect(rows[1]).toMatchObject({ supplier: 'SUP-1', grandTotal: 100, outstanding: 0 });
  });

  it('org-wide read has no project filter; errors surface', async () => {
    await listErpPurchases();
    expect(h.calls.some(([m]) => m === 'contains')).toBe(false);
    h.set({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(listErpPurchases()).rejects.toThrow('denied');
  });

  it('AC-PFE-006: list reads the linked view and exposes procurementId, linkId and netTotal', async () => {
    h.set({ data: [db({ procurement_id: 'pur-1', link_id: 'l-1' }), db({ id: 'b', erp_name: 'PINV-B', net_total: null })], error: null });
    const rows = await listErpPurchases('p1');
    expect(rows.find((r) => r.name === 'PINV-A')).toMatchObject({ procurementId: 'pur-1', linkId: 'l-1', netTotal: 90 });
    expect(rows.find((r) => r.name === 'PINV-B')).toMatchObject({ procurementId: null, linkId: null, netTotal: null });
  });

  it('maps the two new ERP document types (receipt, payment) unchanged', async () => {
    h.set({ data: [db({ erp_doctype: 'Purchase Receipt' }), db({ id: 'b', erp_name: 'ACC-PAY-1', erp_doctype: 'Payment Entry' })], error: null });
    const rows = await listErpPurchases();
    expect(rows.map((r) => r.doctype).sort()).toEqual(['Payment Entry', 'Purchase Receipt']);
  });

  it('FR-PFE-032: listLinkedErpDocuments reads one purchase\'s documents; errors surface', async () => {
    h.set({ data: [db({ procurement_id: 'pur-1', link_id: 'l-1' })], error: null });
    const rows = await listLinkedErpDocuments('pur-1');
    expect(h.calls).toContainEqual(['from', ['erp_purchase_documents_linked']]);
    expect(h.calls).toContainEqual(['eq', ['procurement_id', 'pur-1']]);
    expect(rows[0]).toMatchObject({ name: 'PINV-A', linkId: 'l-1' });
    h.set({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(listLinkedErpDocuments('pur-1')).rejects.toThrow('denied');
  });

  it('AC-PFE-004: linkErpPurchaseDocuments calls the RPC with rows and the dry-run flag', async () => {
    h.rpc.mockResolvedValueOnce({ data: { dry_run: true, counts: { link: 1, skip: 0, refused: 0 }, results: [] }, error: null });
    const res = await linkErpPurchaseDocuments([{ erp_name: 'PINV-1', project_id: 'p1' }], true);
    expect(h.rpc).toHaveBeenCalledWith('link_erp_purchase_documents', { p_rows: [{ erp_name: 'PINV-1', project_id: 'p1' }], p_dry_run: true });
    expect(res.counts.link).toBe(1);
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not allowed', code: '42501' } });
    await expect(linkErpPurchaseDocuments([{ erp_name: 'PINV-1' }])).rejects.toThrow('not allowed');
  });

  it('FR-PFE-031: unlinkErpPurchaseDocument calls the RPC; errors surface', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await unlinkErpPurchaseDocument('l-1');
    expect(h.rpc).toHaveBeenCalledWith('unlink_erp_purchase_document', { p_link_id: 'l-1' });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Only Admin or Finance', code: '42501' } });
    await expect(unlinkErpPurchaseDocument('l-1')).rejects.toThrow('Only Admin or Finance');
  });

  it('hasErpPurchases reads the orphans view and is true only when an orphan exists', async () => {
    expect(await hasErpPurchases()).toBe(false);
    expect(h.calls).toContainEqual(['from', ['erp_purchase_orphans']]);
    h.set({ data: [{ id: 'x' }], error: null });
    expect(await hasErpPurchases()).toBe(true);
  });
});
