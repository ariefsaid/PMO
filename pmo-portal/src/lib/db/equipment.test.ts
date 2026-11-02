import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AC-EQU-017 (data half) — the equipment DAL (#1519 S5, plan S5.1).
 *
 * Usage moves only through the RPCs (0447): no org_id, status, author or approver ever leaves the client, and a list is
 * bounded at LIST_LIMIT + 1 so a silently trimmed read can never be mistaken for the whole set (money-path bucket 5).
 */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as string[], rpc: [] as Array<[string, unknown]>, insert: [] as unknown[], update: [] as unknown[],
    select: [] as unknown[], eq: [] as unknown[], gte: [] as unknown[], lte: [] as unknown[], is: [] as unknown[],
    order: [] as unknown[], limit: [] as unknown[], single: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...a: unknown[]) => { (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a); return builder; };
  for (const k of ['select', 'eq', 'gte', 'lte', 'is', 'order', 'limit', 'insert', 'update'] as const) builder[k] = chain(k);
  builder.single = () => { calls.single++; return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(result.value); });
  return { from, rpc, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import * as dal from './equipment';
const { LIST_LIMIT } = dal;

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const [k, v] of Object.entries(h.calls)) {
    if (typeof v === 'number') (h.calls as unknown as Record<string, number>)[k] = 0;
    else (v as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

const usageInput: dal.UsageInput = {
  asset_id: '15190000-0000-0000-0000-0000000000d1',
  project_id: '15190000-0000-0000-0000-0000000000b1',
  work_date: '2026-09-10',
  quantity: 6,
  unit: 'hours',
  kind: 'work',
  fuel_litres: null,
  trips: null,
  note: null,
};

describe('AC-EQU-017 save_equipment_usage', () => {
  it('AC-EQU-017 saveUsage sends no org_id, status or author — the RPC stamps them', async () => {
    h.result.value = { data: { id: 'e1', status: 'Draft', day_total_hours: 6, over_24h: false }, error: null };
    await expect(dal.saveUsage(usageInput)).resolves.toEqual({ id: 'e1', status: 'Draft', day_total_hours: 6, over_24h: false });
    expect(h.calls.rpc).toEqual([['save_equipment_usage', { p_entry: usageInput }]]);
    const entry = (h.calls.rpc[0][1] as { p_entry: Record<string, unknown> }).p_entry;
    for (const forbidden of ['org_id', 'status', 'author_id', 'approver_id', 'approved_at', 'created_at']) {
      expect(Object.keys(entry)).not.toContain(forbidden);
    }
  });

  it('AC-EQU-017 a duplicate day keeps its 23505 code so the screen can name the row', async () => {
    h.result.value = { data: null, error: { message: 'duplicate key value violates unique constraint "equipment_usage_one_per_day"', code: '23505' } };
    await expect(dal.saveUsage(usageInput)).rejects.toMatchObject({ code: '23505', name: 'AppError' });
  });

  it('AC-EQU-017 a rejected edit surfaces the server message and code unchanged', async () => {
    h.result.value = { data: null, error: { message: 'only the author edits an entry', code: '42501' } };
    await expect(dal.saveUsage({ ...usageInput, id: 'e1' })).rejects.toMatchObject({ message: 'only the author edits an entry', code: '42501' });
    expect((h.calls.rpc[0][1] as { p_entry: Record<string, unknown> }).p_entry.id).toBe('e1');
  });
});

describe('AC-EQU-017 usage transitions, week approve and archive', () => {
  it('AC-EQU-017 transitionUsage sends the target status and an optional note; no note is null', async () => {
    h.result.value = { data: 'Submitted', error: null };
    await dal.transitionUsage('e1', 'Submitted');
    await dal.transitionUsage('e1', 'Rejected', 'wrong asset');
    expect(h.calls.rpc).toEqual([
      ['transition_equipment_usage', { p_id: 'e1', p_to: 'Submitted', p_notes: undefined }],
      ['transition_equipment_usage', { p_id: 'e1', p_to: 'Rejected', p_notes: 'wrong asset' }],
    ]);
  });

  it('AC-EQU-017 approveWeek names the asset and the Monday, and returns the three counts', async () => {
    const counts = { approved: 1, skipped_own: 1, skipped_not_permitted: 0 };
    h.result.value = { data: counts, error: null };
    await expect(dal.approveWeek('d1', '2026-09-07')).resolves.toEqual(counts);
    expect(h.calls.rpc).toEqual([['approve_equipment_usage_week', { p_asset_id: 'd1', p_week_start: '2026-09-07' }]]);
  });

  it('AC-EQU-017 archiveUsage calls the archive RPC by id', async () => {
    await dal.archiveUsage('e1');
    expect(h.calls.rpc).toEqual([['archive_equipment_usage', { p_id: 'e1' }]]);
  });
});

describe('AC-EQU-017 asset reference reads and writes', () => {
  it('AC-EQU-017 listAssets reads live assets only, ordered by code, bounded at 200 + 1', async () => {
    h.result.value = { data: Array.from({ length: 201 }, (_, i) => ({ id: String(i) })), error: null };
    const out = await dal.listAssets();
    expect(out.rows).toHaveLength(LIST_LIMIT);
    expect(out.truncated).toBe(true);
    expect(h.calls.from).toEqual(['equipment_assets']);
    expect(h.calls.is).toEqual([['archived_at', null]]);
    expect(h.calls.order).toEqual(['code']);
    expect(h.calls.limit).toEqual([LIST_LIMIT + 1]);
  });

  it('AC-EQU-017 createAsset sends only the three granted columns', async () => {
    h.result.value = { data: { id: 'a1', code: 'EQP-1', name: 'Loader 1', default_unit: 'hours' }, error: null };
    await expect(dal.createAsset({ code: 'EQP-1', name: 'Loader 1', default_unit: 'hours' })).resolves.toMatchObject({ id: 'a1' });
    expect(h.calls.from).toEqual(['equipment_assets']);
    expect(h.calls.insert).toEqual([{ code: 'EQP-1', name: 'Loader 1', default_unit: 'hours' }]);
    expect(h.calls.single).toBe(1);
  });

  it('AC-EQU-017 updateAsset writes only the handed columns and a no-row result is a 42501', async () => {
    h.result.value = { data: [{ id: 'a1' }], error: null };
    await dal.updateAsset('a1', { archived_at: '2026-11-02T00:00:00Z' });
    expect(h.calls.update).toEqual([{ archived_at: '2026-11-02T00:00:00Z' }]);
    expect(h.calls.eq).toEqual([['id', 'a1']]);
    h.result.value = { data: [], error: null };
    await expect(dal.updateAsset('a1', { name: 'Loader 2' })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-EQU-017 usage reads', () => {
  it('AC-EQU-017 listUsage filters the range, the optional asset/project/status, and marks truncated at 200 + 1', async () => {
    h.result.value = { data: Array.from({ length: LIST_LIMIT + 1 }, (_, i) => ({ id: String(i) })), error: null };
    const out = await dal.listUsage({ from: '2026-09-07', to: '2026-09-13', assetId: 'd1', projectId: 'p1', status: 'Submitted' });
    expect(out.rows).toHaveLength(LIST_LIMIT);
    expect(out.truncated).toBe(true);
    expect(h.calls.from).toEqual(['equipment_usage_entries']);
    expect(h.calls.gte).toEqual([['work_date', '2026-09-07']]);
    expect(h.calls.lte).toEqual([['work_date', '2026-09-13']]);
    expect(h.calls.eq).toEqual([['asset_id', 'd1'], ['project_id', 'p1'], ['status', 'Submitted']]);
    expect(h.calls.is).toEqual([['archived_at', null]]);
    expect(h.calls.limit).toEqual([LIST_LIMIT + 1]);
  });

  it('AC-EQU-017 listUsage without filters sends no equality filter and a short list is not truncated', async () => {
    h.result.value = { data: [{ id: 'e1' }], error: null };
    const out = await dal.listUsage({ from: '2026-09-07', to: '2026-09-13' });
    expect(out).toEqual({ rows: [{ id: 'e1' }], truncated: false });
    expect(h.calls.eq).toEqual([]);
  });

  it('AC-EQU-017 a null usage read is an empty list, and a failed read throws rather than showing nothing', async () => {
    expect(await dal.listUsageTotals({ assetId: 'd1', from: '2026-09-01', to: '2026-09-30' })).toEqual({ rows: [], truncated: false });
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(dal.listUsage({ from: '2026-09-07', to: '2026-09-13' })).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-EQU-017 listUsageTotals passes the named range and bounds the rows it gets back', async () => {
    h.result.value = { data: Array.from({ length: LIST_LIMIT + 1 }, (_, i) => ({ asset_id: String(i) })), error: null };
    const out = await dal.listUsageTotals({ projectId: 'p1', assetId: 'd1', from: '2026-09-01', to: '2026-09-30' });
    expect(out.rows).toHaveLength(LIST_LIMIT);
    expect(out.truncated).toBe(true);
    expect(h.calls.rpc).toEqual([['list_equipment_usage_totals',
      { p_project_id: 'p1', p_asset_id: 'd1', p_from: '2026-09-01', p_to: '2026-09-30' }]]);
  });
});

describe('AC-EQU-017 costing settings and preview', () => {
  it('AC-EQU-017 listCosting reads the current versions unless history is asked for', async () => {
    h.result.value = { data: [{ id: 's1' }], error: null };
    await dal.listCosting();
    await dal.listCosting(true);
    expect(h.calls.rpc).toEqual([
      ['list_equipment_costing', { p_include_history: false }],
      ['list_equipment_costing', { p_include_history: true }],
    ]);
  });

  it('AC-EQU-017 saveCosting returns the key, version and whether anything changed', async () => {
    h.result.value = { data: { setting_key: 'k1', version: 2, changed: true }, error: null };
    await expect(dal.saveCosting(costingDraft())).resolves.toEqual({ setting_key: 'k1', version: 2, changed: true });
    expect(h.calls.rpc).toEqual([['save_equipment_costing', { p_setting: costingDraft() }]]);
  });

  it('AC-EQU-017 endCosting sends the key, the end date and the version it expects', async () => {
    await dal.endCosting('k1', '2026-12-31', 2);
    expect(h.calls.rpc).toEqual([['end_equipment_costing', { p_setting_key: 'k1', p_effective_to: '2026-12-31', p_expected_version: 2 }]]);
  });

  it('AC-EQU-017 previewCosting sends the draft unchanged — the DB normalises and decides', async () => {
    const draft = costingDraft();
    h.result.value = { data: [{ project_id: 'p1', month: '2026-09-01', category: 'Equipment', basis: 'hire_rate', amount: 580, driver_total: null, entry_count: 2 }], error: null };
    await expect(dal.previewCosting(draft)).resolves.toEqual([{ project_id: 'p1', month: '2026-09-01', category: 'Equipment', basis: 'hire_rate', amount: 580, driver_total: null, entry_count: 2 }]);
    expect(h.calls.rpc).toEqual([['preview_equipment_costing', { p_setting: draft }]]);
  });

  it('AC-EQU-017 a refused preview keeps its 42501 and reads nothing', async () => {
    h.result.value = { data: null, error: { message: 'not authorized', code: '42501' } };
    await expect(dal.previewCosting(costingDraft())).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-EQU-017 listAllocations passes p_project_id only when given, and bounds the rows', async () => {
    h.result.value = { data: [{ asset_id: 'd1' }], error: null };
    await dal.listAllocations({ assetId: 'd1', from: '2026-09-01', to: '2026-09-30' });
    await dal.listAllocations({ assetId: 'd1', projectId: 'p1', from: '2026-09-01', to: '2026-09-30' });
    expect(h.calls.rpc).toEqual([
      ['list_equipment_allocations', { p_asset_id: 'd1', p_from: '2026-09-01', p_to: '2026-09-30' }],
      ['list_equipment_allocations', { p_asset_id: 'd1', p_from: '2026-09-01', p_to: '2026-09-30', p_project_id: 'p1' }],
    ]);
    h.result.value = { data: Array.from({ length: LIST_LIMIT + 1 }, (_, i) => ({ asset_id: String(i) })), error: null };
    expect((await dal.listAllocations({ projectId: 'p1', from: '2026-09-01', to: '2026-09-30' })).truncated).toBe(true);
  });
});

function costingDraft(): dal.CostingDraft {
  return {
    setting_key: null, expected_version: null, asset_id: 'd1', basis: 'hire_rate', work_rate: 100, standby_rate: null,
    rate_unit: 'hours', driver: null, count_standby: false, charge_category: 'Equipment', account: '6100',
    account_group: 'Expenses', cost_center: null, party_type: null, party: null, effective_from: '2026-09-01', effective_to: null,
  };
}
