import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { equipment } = vi.hoisted(() => ({
  equipment: {
    createAsset: vi.fn(), updateAsset: vi.fn(), deleteAsset: vi.fn(), saveUsage: vi.fn(), transitionUsage: vi.fn(), approveWeek: vi.fn(),
    archiveUsage: vi.fn(), saveCosting: vi.fn(), endCosting: vi.fn(), previewCosting: vi.fn(), listAllocations: vi.fn(),
    listCosting: vi.fn(), sendEquipmentCommand: vi.fn(), acceptAssetMatches: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { equipment, externalDomainOwnership: { listOwn: vi.fn() } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import {
  useCreateAsset, useUpdateAsset, useDeleteAsset, useSaveUsage, useTransitionUsage, useApproveWeek, useSaveCosting, useEndCosting,
  usePreviewCosting, useEquipmentAllocations, useEquipmentCosting, useSendEquipmentCommand, useAcceptAssetMatches,
} from './useEquipment';

const mk = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

beforeEach(() => { for (const fn of Object.values(equipment)) fn.mockReset().mockResolvedValue([]); });

describe('#2544 equipment costing and usage writes hand the repository exactly what the user chose', () => {
  const setup = (client = mk()) => renderHook(() => ({
    create: useCreateAsset(), update: useUpdateAsset(), del: useDeleteAsset(), usage: useSaveUsage(), transition: useTransitionUsage(),
    approve: useApproveWeek(), save: useSaveCosting(), end: useEndCosting(), preview: usePreviewCosting(),
    command: useSendEquipmentCommand(), accept: useAcceptAssetMatches(),
  }), { wrapper: wrap(client) });

  it('#2544 a costing draft is saved and previewed as the same object; ending a setting passes key, end date and expected version in order', async () => {
    const draft = { asset_id: 'a1', basis: 'hire_rate' as const, work_rate: 120, standby_rate: 40, rate_unit: 'hours' as const, effective_from: '2026-11-01', effective_to: null };
    const { result } = setup();
    await act(async () => { await result.current.preview.mutateAsync(draft); });
    await act(async () => { await result.current.save.mutateAsync(draft); });
    await act(async () => { await result.current.end.mutateAsync({ settingKey: 'k1', effectiveTo: '2026-12-31', expectedVersion: 3 }); });
    expect(equipment.previewCosting).toHaveBeenCalledWith(draft);
    expect(equipment.saveCosting).toHaveBeenCalledWith(draft);
    expect(equipment.endCosting).toHaveBeenCalledWith('k1', '2026-12-31', 3);
  });

  it('#2544 asset and usage writes: create, patch by id, delete by id, usage entry, transition with note, week approval', async () => {
    const { result } = setup();
    const usage = { asset_id: 'a1', project_id: 'p1', work_date: '2026-11-03', quantity: 6.5, unit: 'hours' as const, kind: 'work' as const };
    await act(async () => { await result.current.create.mutateAsync({ code: 'EX-1', name: 'Excavator', default_unit: 'days' }); });
    await act(async () => { await result.current.update.mutateAsync({ id: 'a1', patch: { name: 'Excavator 2' } }); });
    await act(async () => { await result.current.del.mutateAsync('a1'); });
    await act(async () => { await result.current.usage.mutateAsync(usage); });
    await act(async () => { await result.current.transition.mutateAsync({ id: 'u1', to: 'Rejected', notes: 'Wrong project' }); });
    await act(async () => { await result.current.approve.mutateAsync({ assetId: 'a1', weekStart: '2026-11-02' }); });
    expect(equipment.createAsset).toHaveBeenCalledWith({ code: 'EX-1', name: 'Excavator', default_unit: 'days' });
    expect(equipment.updateAsset).toHaveBeenCalledWith('a1', { name: 'Excavator 2' });
    expect(equipment.deleteAsset).toHaveBeenCalledWith('a1');
    expect(equipment.saveUsage).toHaveBeenCalledWith(usage);
    expect(equipment.transitionUsage).toHaveBeenCalledWith('u1', 'Rejected', 'Wrong project');
    expect(equipment.approveWeek).toHaveBeenCalledWith('a1', '2026-11-02');
  });

  it('#2544 register writes: the command carries operation, record and idempotency key; adopted matches go through as handed', async () => {
    const { result } = setup();
    const pairs = [{ asset_id: 'a1', external_record_id: 'e1' }] as never;
    await act(async () => { await result.current.command.mutateAsync({ operation: 'update', record: { id: 'a1', name: 'N' }, idempotencyKey: 'key-1' }); });
    await act(async () => { await result.current.accept.mutateAsync(pairs); });
    expect(equipment.sendEquipmentCommand).toHaveBeenCalledWith('update', { id: 'a1', name: 'N' }, 'key-1');
    expect(equipment.acceptAssetMatches).toHaveBeenCalledWith(pairs);
  });

  it('#2544 a failed costing save rejects to the caller and does not refresh the lists', async () => {
    equipment.saveCosting.mockRejectedValue(new Error('version conflict'));
    const client = mk();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = setup(client);
    await act(async () => {
      await expect(result.current.save.mutateAsync({ asset_id: 'a1', basis: 'none', effective_from: '2026-11-01' })).rejects.toThrow('version conflict');
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('#2544 equipment reads pass the user\'s selection to the repository', () => {
  it('#2544 allocations are read for the chosen asset, project and month range; costing asks for history only when chosen', async () => {
    const q = { assetId: 'a1', projectId: 'p1', from: '2026-11-01', to: '2026-11-30' };
    const client = mk();
    const { result, rerender } = renderHook(({ hist }) => ({ alloc: useEquipmentAllocations(q), cost: useEquipmentCosting(hist) }),
      { wrapper: wrap(client), initialProps: { hist: false } });
    await waitFor(() => expect(result.current.alloc.isSuccess).toBe(true));
    expect(equipment.listAllocations).toHaveBeenCalledWith(q);
    expect(equipment.listCosting).toHaveBeenLastCalledWith(false);
    rerender({ hist: true });
    await waitFor(() => expect(equipment.listCosting).toHaveBeenLastCalledWith(true));
  });
});
