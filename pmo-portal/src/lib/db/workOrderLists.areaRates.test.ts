import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/** Areas and area rates (docs/specs/areas-and-area-rates.spec.md, migration 2132): description on an area, a rate per area on a contract line. */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown } };
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'order', 'limit', 'gt', 'insert', 'update'] as const) builder[k] = (...a: unknown[]) => { calls.push([k, a]); return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.push(['from', [t]]); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.push(['rpc', [n, a]]); return Promise.resolve(result.value); });
  return { from, rpc, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import * as dal from './workOrderLists';

beforeEach(() => { h.calls.length = 0; h.result.value = { data: [], error: null }; });

describe('area description', () => {
  it('AC-ARA-001 an area is read and written with its optional description; a group has none', async () => {
    await dal.listWorkOrderListEntries('area');
    expect(h.calls).toContainEqual(['select', ['id, code, name, description, archived_at']]);
    h.calls.length = 0;
    await dal.listWorkOrderListEntries('group');
    expect(h.calls).toContainEqual(['select', ['id, code, name, archived_at']]);
    h.calls.length = 0;
    await dal.createWorkOrderListEntry('area', { code: 'N', name: 'North', description: ' Northern block ' });
    expect(h.calls).toContainEqual(['insert', [{ code: 'N', name: 'North', description: 'Northern block' }]]);
    h.calls.length = 0;
    h.result.value = { data: [{ id: 'g1' }], error: null };
    await dal.createWorkOrderListEntry('group', { code: 'G', name: 'Ops', description: 'ignored' });
    expect(h.calls).toContainEqual(['insert', [{ code: 'G', name: 'Ops' }]]);
  });
});

describe('area rates', () => {
  it('AC-ARA-002 reads the rates of a line and sets one through the RPC with the rate as an exact string', async () => {
    h.result.value = { data: [{ area_id: 'a1', rate: 8.5 }], error: null };
    await expect(dal.listBoqItemAreaRates('b1')).resolves.toEqual([{ areaId: 'a1', rate: '8.5' }]);
    expect(h.calls).toContainEqual(['from', ['boq_item_area_rates']]);
    h.calls.length = 0;
    h.result.value = { data: null, error: null };
    await dal.setBoqItemAreaRate('b1', 'a1', '8.50000001');
    await dal.setBoqItemAreaRate('b1', 'a1', null);
    expect(h.calls.filter(([k]) => k === 'rpc').map(([, a]) => a)).toEqual([
      ['set_boq_item_area_rate', { p_boq_item: 'b1', p_area: 'a1', p_rate: '8.50000001' }],
      ['set_boq_item_area_rate', { p_boq_item: 'b1', p_area: 'a1', p_rate: null }],
    ]);
  });

  it('AC-ARA-002 a refusal keeps its Postgres code', async () => {
    h.result.value = { data: null, error: { message: 'not authorized', code: '42501' } };
    const err = await dal.setBoqItemAreaRate('b1', 'a1', '5').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('42501');
  });
});
