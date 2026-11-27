import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setHidePricesActive } from '@/src/lib/priceReadPath';

const h = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: true, error: null })),
  row: { data: null as unknown, error: null as unknown },
  calls: { from: [] as string[], select: [] as string[] },
  chain: {} as Record<string, unknown>,
  from: vi.fn((table: string) => { h.calls.from.push(table); return h.chain; }),
}));
for (const method of ['select', 'limit', 'eq'] as const) {
  h.chain[method] = vi.fn((...args: unknown[]) => { if (method === 'select') h.calls.select.push(String(args[0])); return h.chain; });
}
h.chain.maybeSingle = vi.fn(async () => h.row);
// The organisation setting read is awaited directly (the shared two-row read), so the chain resolves like a query.
h.chain.then = (resolve: (v: unknown) => unknown) => resolve(h.row);
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import { getPoNeededByRequired, getProcurementNeededBy, setPoNeededByRequired, setProcurementNeededBy } from './procurementNeededBy';

const ID = '26970000-0000-4000-8000-000000000011';
const ITEM = '26970000-0000-4000-8000-000000000021';
beforeEach(() => { h.rpc.mockClear(); h.from.mockClear(); h.calls.from.length = 0; h.calls.select.length = 0; h.row = { data: null, error: null }; });
afterEach(() => setHidePricesActive(false));

describe('procurementNeededBy DAL (1124d)', () => {
  it('AC-NBY-008 the rule reads off when no moment is stored and on when one is', async () => {
    expect(await getPoNeededByRequired()).toBe(false);
    h.row = { data: [{ po_needed_by_required_from: '2026-11-24T00:00:00Z' }], error: null };
    expect(await getPoNeededByRequired()).toBe(true);
  });
  it('AC-NBY-008 the setting is written through the Admin RPC', async () => {
    await setPoNeededByRequired(true);
    expect(h.rpc).toHaveBeenCalledWith('set_po_needed_by_required', { p_on: true });
  });
  it('AC-NBY-008 the header date is read from the order', async () => {
    h.row = { data: { needed_by: '2026-12-31' }, error: null };
    expect(await getProcurementNeededBy(ID)).toBe('2026-12-31');
  });
  it('AC-NBY-008 reads a requester-visible needed-by date through the masked procurement view', async () => {
    setHidePricesActive(true);
    h.row = { data: { needed_by: '2026-12-31' }, error: null };

    expect(await getProcurementNeededBy(ID)).toBe('2026-12-31');

    expect(h.calls.from).toEqual(['procurements_masked']);
    expect(h.calls.select).toEqual(['needed_by']);
  });
  it('AC-NBY-008 the date and own line dates go to the one write RPC; with no line overrides none are sent', async () => {
    await setProcurementNeededBy(ID, '2026-12-31', [{ itemId: ITEM, neededBy: '2026-12-15' }]);
    expect(h.rpc).toHaveBeenCalledWith('set_procurement_needed_by', { p_id: ID, p_needed_by: '2026-12-31', p_lines: [{ item_id: ITEM, needed_by: '2026-12-15' }] });
    await setProcurementNeededBy(ID, '2026-12-31');
    expect(h.rpc).toHaveBeenLastCalledWith('set_procurement_needed_by', { p_id: ID, p_needed_by: '2026-12-31', p_lines: null });
  });
  it('AC-NBY-008 a malformed id or date never reaches the database', async () => {
    await expect(setProcurementNeededBy('nope', '2026-12-31')).rejects.toThrow();
    await expect(setProcurementNeededBy(ID, '31/12/2026')).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('AC-NBY-008 a refusal keeps its code', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'the needed-by date is not permitted', code: '42501' } } as never);
    await expect(setProcurementNeededBy(ID, '2026-12-31')).rejects.toMatchObject({ code: '42501' });
  });
});
