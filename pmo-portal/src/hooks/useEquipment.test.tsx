import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { equipment } = vi.hoisted(() => ({
  equipment: {
    listAssets: vi.fn(), createAsset: vi.fn(), updateAsset: vi.fn(), listUsage: vi.fn(), saveUsage: vi.fn(),
    transitionUsage: vi.fn(), approveWeek: vi.fn(), archiveUsage: vi.fn(), listUsageTotals: vi.fn(), listCosting: vi.fn(),
    saveCosting: vi.fn(), endCosting: vi.fn(), previewCosting: vi.fn(), listAllocations: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories/equipment', () => ({
  equipmentRepository: equipment,
}));
let org: string | undefined = 'org-1';
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: org } }) }));

import {
  EQUIPMENT_QUERY_ROOTS, useEquipmentAssets, useEquipmentUsage, useEquipmentUsageTotals, useEquipmentCosting,
  useEquipmentAllocations, useSaveUsage, useTransitionUsage, useApproveWeek, useArchiveUsage, useSaveCosting,
  useEndCosting, usePreviewCosting,
} from './useEquipment';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  org = 'org-1';
  for (const fn of Object.values(equipment)) fn.mockReset().mockResolvedValue([]);
  equipment.listUsageTotals.mockResolvedValue({ rows: [], truncated: false });
  equipment.listAssets.mockResolvedValue({ rows: [], truncated: false });
});

describe('AC-EQU-017 equipment hooks', () => {
  it('AC-EQU-017 every query key carries the org id', async () => {
    const client = fresh();
    renderHook(() => {
      useEquipmentAssets();
      useEquipmentUsage({ from: '2026-09-07', to: '2026-09-13' });
      useEquipmentUsageTotals({ assetId: 'd1', from: '2026-09-01', to: '2026-09-30' });
      useEquipmentCosting(false);
      useEquipmentAllocations({ assetId: 'd1', from: '2026-09-01', to: '2026-09-30' });
    }, { wrapper: wrap(client) });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    for (const key of keys) expect(key[1]).toBe('org-1');
    expect(keys.map((k) => k[0]).sort()).toEqual([
      'equipment-allocations', 'equipment-assets', 'equipment-costing', 'equipment-usage', 'equipment-usage-totals',
    ]);
    // every root is in the exported list, so a write can invalidate all of them by prefix
    for (const key of keys) expect(EQUIPMENT_QUERY_ROOTS).toContain(key[0]);
  });

  it('AC-EQU-017 nothing is fetched without an org id, a range, or a named asset/project', async () => {
    org = undefined;
    const c1 = fresh();
    renderHook(() => {
      useEquipmentAssets(); useEquipmentUsage({ from: '2026-09-07', to: '2026-09-13' }); useEquipmentCosting(true);
    }, { wrapper: wrap(c1) });
    org = 'org-1';
    const c2 = fresh();
    renderHook(() => {
      useEquipmentUsage({ from: '', to: '' });
      useEquipmentUsageTotals({ from: '2026-09-01', to: '2026-09-30' });
      useEquipmentAllocations({ from: '2026-09-01', to: '2026-09-30' });
    }, { wrapper: wrap(c2) });
    await new Promise((r) => setTimeout(r, 20));
    expect(equipment.listAssets).not.toHaveBeenCalled();
    expect(equipment.listUsage).not.toHaveBeenCalled();
    expect(equipment.listCosting).not.toHaveBeenCalled();
    // a totals read needs a named project or asset; an allocations read too
    expect(equipment.listUsageTotals).not.toHaveBeenCalled();
    expect(equipment.listAllocations).not.toHaveBeenCalled();
  });

  it('AC-EQU-017 a transition invalidates usage, totals, allocations, the other equipment reads and project finances', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useTransitionUsage(), { wrapper: wrap(client) });
    await act(async () => { await result.current.mutateAsync({ id: 'e1', to: 'Submitted' }); });
    expect(equipment.transitionUsage).toHaveBeenCalledWith('e1', 'Submitted', undefined);
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const root of [...EQUIPMENT_QUERY_ROOTS, 'project-finances']) expect(keys).toContain(JSON.stringify([root]));
  });

  it('AC-EQU-017 every write invalidates every equipment root plus project finances', async () => {
    const roots = [...EQUIPMENT_QUERY_ROOTS, 'project-finances'].map((root) => JSON.stringify([root]));
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => ({
      save: useSaveUsage(), approve: useApproveWeek(), archive: useArchiveUsage(),
      saveCosting: useSaveCosting(), endCosting: useEndCosting(), assets: useEquipmentAssets(),
    }), { wrapper: wrap(client) });
    const runs: Array<() => Promise<unknown>> = [
      () => result.current.save.mutateAsync({ asset_id: 'd1', project_id: 'p1', work_date: '2026-09-10', quantity: 6, unit: 'hours', kind: 'work' }),
      () => result.current.approve.mutateAsync({ assetId: 'd1', weekStart: '2026-09-07' }),
      () => result.current.archive.mutateAsync('e1'),
      () => result.current.saveCosting.mutateAsync({ asset_id: 'd1', basis: 'none', effective_from: '2026-09-01' }),
      () => result.current.endCosting.mutateAsync({ settingKey: 'k1', effectiveTo: '2026-12-31', expectedVersion: 1 }),
    ];
    for (const run of runs) {
      spy.mockClear();
      await act(async () => { await run(); });
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      for (const root of roots) expect(keys).toContain(root);
    }
  });

  it('AC-EQU-017 the preview is a mutation with no cache to invalidate', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => usePreviewCosting(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.mutateAsync({ asset_id: 'd1', basis: 'hire_rate', work_rate: 100, rate_unit: 'hours', charge_category: 'Equipment', effective_from: '2026-09-01' });
    });
    expect(equipment.previewCosting).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });
});
