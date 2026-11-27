import { afterEach, describe, expect, it, vi } from 'vitest';
import { setHidePricesActive } from '@/src/lib/priceReadPath';

const h = vi.hoisted(() => {
  const calls = { from: [] as string[], select: [] as string[] };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit'] as const) {
    chain[method] = vi.fn((...args: unknown[]) => {
      if (method === 'select') calls.select.push(String(args[0]));
      return chain;
    });
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
  return { rpc: vi.fn(), from: vi.fn((table: string) => { calls.from.push(table); return chain; }), calls };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { extendRentalProcurement, getRentalLinks } from './purchaseTypes';

afterEach(() => setHidePricesActive(false));

describe('#2788 rental extension call', () => {
  it('sends a line without a rate as the original line it continues', async () => {
    h.rpc.mockResolvedValue({ data: { id: 'p2' }, error: null });
    await extendRentalProcurement({ id: 'p2', originalId: 'p1', from: '2026-02-01', to: '2026-02-28',
      lines: [{ id: 'n1', name: 'Crane', quantity: 1, originalLineId: 'l1' }, { id: 'n2', name: 'Operator', quantity: 2, rate: 150 }] });
    expect(h.rpc.mock.calls[0][1].p_items).toEqual([
      { id: 'n1', name: 'Crane', quantity: 1, original_line_id: 'l1', description: null },
      { id: 'n2', name: 'Operator', quantity: 2, rate: 150, description: null },
    ]);
  });

  it('AC-PTR-013 reads rental links through the masked procurement view when price hiding is active', async () => {
    setHidePricesActive(true);

    await getRentalLinks('current', 'original');

    expect(h.calls.from).toEqual(['procurements_masked', 'procurements_masked']);
    expect(h.calls.select).toEqual(['id, title, rental_from, rental_to, status', 'id, title, rental_from, rental_to, status']);
  });
});
