import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ managementPack: vi.fn(), recordProgress: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { reports: h } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { useManagementPack, useRecordProjectProgress } from './useManagementPack';

const facts = {
  from: '2026-01-01', to: '2026-01-01', timezone: 'UTC', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [{ id: 'p1', name: 'Alpha', pmo_project_number: null, code: null, status: 'Ongoing Project', currency: 'IDR',
    contract_net: 10, start_date: null, end_date: null, project_manager_id: null, client_name: null }],
  invoiced: [], invoiced_before: [], progress: [],
};

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.managementPack.mockReset().mockResolvedValue(facts);
  h.recordProgress.mockReset().mockResolvedValue(undefined);
});

describe('useManagementPack', () => {
  it('AC-MMP-013 support: returns the BUILT pack for the requested window', async () => {
    const { result } = renderHook(() => useManagementPack({ from: '2026-01-01', to: '2026-01-01' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.managementPack).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-01' });
    expect(result.current.data?.rows[0].contractNet).toBe(1000);
  });

  it('AC-MMP-014 support: recording progress refreshes every cached pack', async () => {
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRecordProjectProgress(), { wrapper });
    await act(() => result.current.mutateAsync({ projectId: 'p1', month: '2026-01-01', pctComplete: 10, note: null }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['managementPack'] });
  });
});
