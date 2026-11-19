import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listEquipmentProofs: vi.fn(), setStatusBulk: vi.fn(), addProof: vi.fn(), uploadProof: vi.fn(), getMetrics: vi.fn(), listLatestStatusDays: vi.fn(),
  listStatusDays: vi.fn(), listDowntimeFlags: vi.fn(), listRentalTerms: vi.fn(), saveRentalTerm: vi.fn(),
  setOwnership: vi.fn(), changeRentalRate: vi.fn(), setWorkingHours: vi.fn(), rentalCheck: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-a' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { equipmentAvailability: h } }));
import { useAttachProof, useEquipmentProofs, useChangeRentalRate, useEquipmentMetrics, useEquipmentOwnership, useEquipmentWorkingHours, useLatestStatusDays, useRentalTermHistory, useRentalTerms, useRentalCheck, useSetStatusBulk } from './useEquipmentAvailability';

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.clearAllMocks();
  h.setStatusBulk.mockResolvedValue(1); h.addProof.mockResolvedValue({ path: 'org-a/asset/proof/photo.jpg' }); h.uploadProof.mockResolvedValue(undefined);
  h.listEquipmentProofs.mockResolvedValue([{ asset_id: 'a', proven: true }]); h.getMetrics.mockResolvedValue([]); h.listLatestStatusDays.mockResolvedValue([]); h.listRentalTerms.mockResolvedValue([]);
  h.rentalCheck.mockResolvedValue({ deduction: '0.00' });

  h.saveRentalTerm.mockResolvedValue('term'); h.setOwnership.mockResolvedValue(undefined); h.changeRentalRate.mockResolvedValue('term'); h.setWorkingHours.mockResolvedValue(undefined);
});

describe('equipment availability hooks', () => {
  it('saves the selected status date and invalidates the org reads', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSetStatusBulk(), { wrapper });
    await act(() => result.current.mutateAsync({ date: '2026-01-02', items: [{ asset_id: 'a', status: 'broken' }] }));
    expect(h.setStatusBulk).toHaveBeenCalledWith('2026-01-02', [{ asset_id: 'a', status: 'broken' }]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['equipment-availability'] });
  });
  it('uploads proof to the server-issued path and propagates upload failure', async () => {
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    const { result } = renderHook(() => useAttachProof(), { wrapper });
    await act(() => result.current.mutateAsync({ assetId: 'a', date: '2026-01-02', file }));
    expect(h.addProof).toHaveBeenCalledWith('a', '2026-01-02', 'photo.jpg', undefined);
    expect(h.uploadProof).toHaveBeenCalledWith('org-a/asset/proof/photo.jpg', file);
    h.uploadProof.mockRejectedValueOnce(new Error('upload failed'));
    await expect(result.current.mutateAsync({ assetId: 'a', date: '2026-01-02', file })).rejects.toThrow('upload failed');
  });
  it('keeps metrics and latest statuses scoped to the caller’s org and asset selection', async () => {
    renderHook(() => { useEquipmentMetrics(['a'], '2026-01-01', '2026-01-31', 'month', true); useLatestStatusDays(['a'], '2026-01-31'); useEquipmentProofs(['a'], '2026-01-31'); useRentalTermHistory('a', true); }, { wrapper });
    await waitFor(() => expect(h.getMetrics).toHaveBeenCalledWith(['a'], '2026-01-01', '2026-01-31', 'month'));
    expect(h.listLatestStatusDays).toHaveBeenCalledWith(['a'], '2026-01-31');
    expect(h.listRentalTerms).toHaveBeenCalledWith('a');
    expect(h.listEquipmentProofs).toHaveBeenCalledWith(['a'], '2026-01-31');
    expect(client.getQueryCache().getAll().every((q) => q.queryKey[1] === 'org-a')).toBe(true);
  });
  it('refreshes terms and assets after changes to ownership, rates and working hours', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => ({ terms: useRentalTerms(), ownership: useEquipmentOwnership(), rate: useChangeRentalRate(), hours: useEquipmentWorkingHours() }), { wrapper });
    const term = { asset_id: 'a', vendor_id: 'v', rate: '100', basis: 'day' as const, currency: 'IDR', rented_from: '2026-01-01' };
    await act(() => result.current.terms.mutateAsync(term));
    await act(() => result.current.ownership.mutateAsync({ assetId: 'a', ownership: 'owned', inServiceOn: null }));
    await act(() => result.current.rate.mutateAsync({ assetId: 'a', date: '2026-02-01', rate: '120' }));
    await act(() => result.current.hours.mutateAsync('8'));
    expect(h.saveRentalTerm).toHaveBeenCalledWith(term, expect.anything());
    expect(h.setOwnership).toHaveBeenCalledWith('a', 'owned', null);
    expect(h.changeRentalRate).toHaveBeenCalledWith('a', '2026-02-01', '120');
    expect(h.setWorkingHours).toHaveBeenCalledWith('8', expect.anything());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['equipment-assets'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['equipment-availability'] });
  });
  it('runs the invoice comparison without an unproven override unless a reason was supplied', async () => {
    const { result } = renderHook(() => useRentalCheck(), { wrapper });
    await act(() => result.current.mutateAsync({ assetId: 'a', from: '2026-09-01', to: '2026-09-30', invoice: '100' }));
    expect(h.rentalCheck).toHaveBeenCalledWith('a', '2026-09-01', '2026-09-30', '100', null);
  });

});
