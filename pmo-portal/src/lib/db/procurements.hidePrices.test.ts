/** AC-003 (#2699) — while the organisation hides prices the procurement reads go through the masked views; off, the table (unchanged). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setHidePricesActive } from '@/src/lib/priceReadPath';

const m = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: m.from, rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } }));
import { listProcurementsByVendor } from './procurements';

function chain() {
  const c: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'order', 'limit', 'gt']) c[k] = (...a: unknown[]) => { if (k === 'select') m.select(...a); return c; };
  c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return c;
}
afterEach(() => { setHidePricesActive(false); vi.clearAllMocks(); });

describe('AC-003 procurement read path', () => {
  it('reads the table when the setting is off', async () => {
    m.from.mockReturnValue(chain());
    await listProcurementsByVendor('v1');
    expect(m.from).toHaveBeenCalledWith('procurements');
  });
  it('reads the masked view when the setting is on', async () => {
    setHidePricesActive(true);
    m.from.mockReturnValue(chain());
    await listProcurementsByVendor('v1');
    expect(m.from).toHaveBeenCalledWith('procurements_masked');
  });
});
