import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown } };
  const calls = {
    from: [] as string[],
    rpc: [] as Array<[string, unknown]>,
    select: [] as unknown[],
    eq: [] as unknown[],
    order: [] as unknown[],
    limit: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...a: unknown[]) => {
    (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a);
    return builder;
  };
  for (const k of ['select', 'eq', 'order', 'limit'] as const) builder[k] = chain(k);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(result.value); });
  return { from, rpc, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { listSubcontractPos } from './subcontractCertificates';

beforeEach(() => {
  h.from.mockClear();
  h.rpc.mockClear();
  for (const v of Object.values(h.calls)) (v as unknown[]).length = 0;
  h.result.value = { data: null, error: null };
});

describe('subcontractCertificates DAL', () => {
  it('listSubcontractPos qualifies procurements embed with purchase_orders_procurement_id_fkey', async () => {
    h.result.value = {
      data: [
        {
          id: 'po-1',
          po_number: 'PO-001',
          work_order_id: 'wo-1',
          currency: 'USD',
          procurements: { title: 'Subcontract PO', project_id: 'prj-1', vendor_id: 'v-1' },
        },
      ],
      error: null,
    };

    const res = await listSubcontractPos();
    expect(h.calls.from).toContain('purchase_orders');
    expect(h.calls.select[0]).toBe(
      'id, po_number, work_order_id, currency, procurements!purchase_orders_procurement_id_fkey!inner(title, project_id, vendor_id, is_subcontract)'
    );
    expect(res).toEqual([
      {
        po_id: 'po-1',
        po_number: 'PO-001',
        title: 'Subcontract PO',
        project_id: 'prj-1',
        vendor_id: 'v-1',
        work_order_id: 'wo-1',
        currency: 'USD',
      },
    ]);
  });
});
