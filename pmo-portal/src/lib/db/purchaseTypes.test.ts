import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { extendRentalProcurement } from './purchaseTypes';

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
});
