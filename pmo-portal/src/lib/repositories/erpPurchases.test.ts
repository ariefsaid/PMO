/** FR-EPR-004/006/007 — the client read hides cancelled and PMO-pushed documents, scopes to a project, and maps rows. */
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
  };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { hasErpPurchases, listErpPurchases } from './erpPurchases';

const db = (over: Record<string, unknown>) => ({
  id: 'a', erp_doctype: 'Purchase Invoice', erp_name: 'PINV-A', supplier: 'SUP-1', supplier_name: null, doc_date: '2026-01-01',
  due_date: null, bill_no: null, currency: 'IDR', grand_total: '100.00', outstanding_amount: '0.00', erp_status: 'Paid',
  is_return: false, project_ids: ['p1'], ...over,
});

beforeEach(() => { h.calls.length = 0; h.set({ data: [], error: null }); });

describe('erpPurchases repository', () => {
  it('reads only submitted, ERP-native documents of the project, newest first, with numeric money', async () => {
    h.set({ data: [db({}), db({ id: 'b', erp_name: 'PINV-B', doc_date: '2026-03-01', supplier_name: 'Beta' })], error: null });
    const rows = await listErpPurchases('p1');
    expect(h.calls).toContainEqual(['from', ['erp_purchase_documents']]);
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

  it('hasErpPurchases is true only when a listable row exists', async () => {
    expect(await hasErpPurchases()).toBe(false);
    h.set({ data: [{ id: 'x' }], error: null });
    expect(await hasErpPurchases()).toBe(true);
  });
});
