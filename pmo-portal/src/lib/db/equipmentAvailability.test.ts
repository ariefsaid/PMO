import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ range: vi.fn(), ids: vi.fn(), rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => {
  const builder = { select: () => builder, gte: () => builder, lte: () => builder, eq: () => builder, in: (column: string, ids: string[]) => { h.ids(column, ids); return builder; }, order: () => builder, limit: () => h.range(0, 999), range: h.range };
  return { supabase: { from: () => builder, rpc: h.rpc } };
});
import { listStatusDays, listLatestStatusDays, listRentalTerms, listEquipmentProofs } from './equipmentAvailability';

describe('status reads', () => {
  it('returns all pages when the server caps a response at 1000 rows', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ asset_id: String(i), status_date: '2026-09-01', status: 'ready', note: null }));
    const last = { asset_id: 'last', status_date: '2026-09-02', status: 'broken', note: null };
    h.range.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [last], error: null });
    const result = await listStatusDays('2026-09-01', '2026-09-30');
    expect(result).toHaveLength(1001);
    expect(result[1000]).toEqual(last);
  });
  it('returns each machine’s most recent status even when it was before this month', async () => {
    h.range.mockReset();
    h.range.mockResolvedValueOnce({ data: [
      { asset_id: 'a', status_date: '2026-02-01', status: 'ready', note: null },
      { asset_id: 'a', status_date: '2026-01-31', status: 'broken', note: null },
      { asset_id: 'b', status_date: '2026-01-20', status: 'standby', note: null },
    ], error: null });
    expect(await listLatestStatusDays(['a', 'b'], '2026-02-02')).toEqual([
      expect.objectContaining({ asset_id: 'a', status: 'ready' }),
      expect.objectContaining({ asset_id: 'b', status: 'standby' }),
    ]);
  });

  it('returns rental history beyond the server page cap', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), rate: 1 }));
    const last = { id: 'last', rate: 2 };
    h.range.mockReset();
    h.range.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [last], error: null });
    const rows = await listRentalTerms('a');
    expect(rows).toHaveLength(1001);
    expect(rows[1000]).toEqual(last);
  });

  it('limits the status read to the current equipment page', async () => {
    h.range.mockReset().mockResolvedValue({ data: [], error: null });
    h.ids.mockClear();
    await listStatusDays('2026-09-01', '2026-09-30', ['a', 'b']);
    expect(h.ids).toHaveBeenCalledWith('asset_id', ['a', 'b']);
  });

  it('requests proof status for the selected page and day', async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ asset_id: 'a', proven: true }], error: null });
    expect(await listEquipmentProofs(['a'], '2026-09-10')).toEqual([{ asset_id: 'a', proven: true }]);
    expect(h.rpc).toHaveBeenCalledWith('list_equipment_proofs', { p_asset_ids: ['a'], p_on: '2026-09-10' });
  });

});
