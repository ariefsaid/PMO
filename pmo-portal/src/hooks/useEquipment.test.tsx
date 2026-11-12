import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { equipment, externalDomainOwnership } = vi.hoisted(() => ({
  equipment: {
    listAssets: vi.fn(), createAsset: vi.fn(), updateAsset: vi.fn(), listUsage: vi.fn(), saveUsage: vi.fn(),
    transitionUsage: vi.fn(), approveWeek: vi.fn(), archiveUsage: vi.fn(), listUsageTotals: vi.fn(), listCosting: vi.fn(),
    saveCosting: vi.fn(), endCosting: vi.fn(), previewCosting: vi.fn(), listAllocations: vi.fn(),
    listRegister: vi.fn(), listMaintenance: vi.fn(), listPickers: vi.fn(), listPendingChanges: vi.fn(),
    listAssetMatches: vi.fn(), acceptAssetMatches: vi.fn(), sendEquipmentCommand: vi.fn(),
  },
  externalDomainOwnership: { listOwn: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { equipment, externalDomainOwnership } }));
let org: string | undefined = 'org-1';
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: org } }) }));

import {
  EQUIPMENT_QUERY_ROOTS, useEquipmentAssets, useEquipmentAssetPages, useEquipmentUsage, useEquipmentUsageTotals, useEquipmentCosting,
  useEquipmentAllocations, useSaveUsage, useTransitionUsage, useApproveWeek, useArchiveUsage, useSaveCosting,
  useEndCosting, usePreviewCosting, useRegister, useAssetMaintenance, useEquipmentPickers, usePendingEquipmentChanges,
  useAssetMatches, useAcceptAssetMatches, useSendEquipmentCommand, useOdooEquipmentOwned,
} from './useEquipment';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  org = 'org-1';
  for (const fn of [...Object.values(equipment), externalDomainOwnership.listOwn] as Array<ReturnType<typeof vi.fn>>) fn.mockReset().mockResolvedValue([]);
  equipment.listUsageTotals.mockResolvedValue({ rows: [], truncated: false });
  equipment.listAssets.mockResolvedValue({ rows: [], truncated: false });
  equipment.listRegister.mockResolvedValue({ rows: [], truncated: false });
  equipment.listMaintenance.mockResolvedValue({ rows: [], truncated: false, total: 0 });
  equipment.listPendingChanges.mockResolvedValue([]);
});

describe('AC-EQU-017 equipment hooks', () => {
  it('C8 EquipmentAssets.tsx:117 requests the next asset page from the loaded row count', async () => {
    equipment.listAssets
      .mockResolvedValueOnce({ rows: [{ id: 'a1' }], truncated: true })
      .mockResolvedValueOnce({ rows: [{ id: 'a2' }], truncated: false });
    const { result } = renderHook(() => useEquipmentAssetPages(), { wrapper: wrap(fresh()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(equipment.listAssets).toHaveBeenNthCalledWith(1, 0);
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => { await result.current.fetchNextPage(); });
    expect(equipment.listAssets.mock.calls).toEqual([[0], [1]]);
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(equipment.listAssets).toHaveBeenNthCalledWith(2, 1);
    expect(result.current.data?.pages.flatMap((page) => page.rows.map((row) => row.id))).toEqual(['a1', 'a2']);
  });

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

describe('#1511 F5 register and maintenance hooks (Odoo owns the register)', () => {
  it('F5-T3 the register/maintenance/picker/pending/matches queries key on the org id under their own roots', async () => {
    const client = fresh();
    renderHook(() => {
      useRegister();
      useAssetMaintenance('equipment:42');
      useEquipmentPickers('maintenance_stage');
      usePendingEquipmentChanges(['r1']);
      useAssetMatches(true);
    }, { wrapper: wrap(client) });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    for (const key of keys) expect(key[1]).toBe('org-1');
    expect(keys.map((k) => k[0]).sort()).toEqual([
      'equipment-asset-matches', 'equipment-maintenance', 'equipment-pending', 'equipment-pickers', 'equipment-register',
    ]);
    for (const key of keys) expect(EQUIPMENT_QUERY_ROOTS).toContain(key[0]);
  });

  it('F5-T3 nothing is fetched without an org id, a register ref, a picker kind, record ids, or enabled', async () => {
    org = undefined;
    const c1 = fresh();
    renderHook(() => {
      useRegister(); useAssetMaintenance('equipment:42'); useEquipmentPickers('service_type'); useAssetMatches(true);
    }, { wrapper: wrap(c1) });
    org = 'org-1';
    const c2 = fresh();
    renderHook(() => {
      useAssetMaintenance(undefined); usePendingEquipmentChanges([]); useAssetMatches(false);
    }, { wrapper: wrap(c2) });
    await new Promise((r) => setTimeout(r, 20));
    expect(equipment.listRegister).not.toHaveBeenCalled();
    expect(equipment.listMaintenance).not.toHaveBeenCalled();
    expect(equipment.listPickers).not.toHaveBeenCalled();
    expect(equipment.listAssetMatches).not.toHaveBeenCalled();
    expect(equipment.listPendingChanges).not.toHaveBeenCalled();
  });

  it('F5-T3 useOdooEquipmentOwned is true exactly when the org employs equipment under odoo', async () => {
    externalDomainOwnership.listOwn.mockResolvedValue([
      { id: 'o1', orgId: 'org-1', externalTier: 'odoo', domain: 'companies' },
    ]);
    const c1 = fresh();
    const { result } = renderHook(() => useOdooEquipmentOwned(), { wrapper: wrap(c1) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.owned).toBe(false);

    externalDomainOwnership.listOwn.mockResolvedValue([
      { id: 'o1', orgId: 'org-1', externalTier: 'odoo', domain: 'companies' },
      { id: 'o2', orgId: 'org-1', externalTier: 'odoo', domain: 'equipment' },
    ]);
    const c2 = fresh();
    const r2 = renderHook(() => useOdooEquipmentOwned(), { wrapper: wrap(c2) });
    await waitFor(() => expect(r2.result.current.isSuccess).toBe(true));
    expect(r2.result.current.owned).toBe(true);
  });

  it('F5-T3 a sent equipment command invalidates the register, maintenance, pending and asset reads', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSendEquipmentCommand(), { wrapper: wrap(client) });
    const record = { id: 'r1', erp_doc_kind: 'maintenance-request', subject: 'Hydraulic leak' };
    await act(async () => {
      await result.current.mutateAsync({ operation: 'create', record, idempotencyKey: '15110000-0000-4000-8000-000000000001' });
    });
    expect(equipment.sendEquipmentCommand).toHaveBeenCalledWith('create', record, '15110000-0000-4000-8000-000000000001');
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const root of ['equipment-register', 'equipment-maintenance', 'equipment-pending', 'equipment-assets']) {
      expect(keys).toContain(JSON.stringify([root]));
    }
  });

  it('F5-T3 an accepted match batch invalidates the register, matches and asset reads', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAcceptAssetMatches(), { wrapper: wrap(client) });
    const pairs = [{ ref: 'equipment:42', action: 'link' as const, asset_id: 'a1' }];
    await act(async () => { await result.current.mutateAsync(pairs); });
    expect(equipment.acceptAssetMatches).toHaveBeenCalledWith(pairs);
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const root of ['equipment-register', 'equipment-asset-matches', 'equipment-assets']) {
      expect(keys).toContain(JSON.stringify([root]));
    }
  });
});
