// @vitest-environment jsdom
/**
 * AC-M365DOC-071 successful case creation / submission survive every folder failure — the SHIPPED
 * `useCreateProcurement` and `useProcurementMutations().transition` start the folder step.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui/Toast';
import type { Role } from '@/src/auth/AuthContext';

const { procurement, m365RecordFolders } = vi.hoisted(() => ({
  procurement: { create: vi.fn(), transition: vi.fn() },
  m365RecordFolders: { ensure: vi.fn() },
}));
const m365Feature = vi.hoisted(() => ({ on: true }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: (key: string) => key !== 'm365_integration' || m365Feature.on }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement, m365RecordFolders } }));
vi.mock('@/src/lib/db/procurementLifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/db/procurementLifecycle')>()),
  getProcurementDetail: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Finance' }),
}));

import { useCreateProcurement } from './useProcurementCrud';
import { useProcurementMutations } from './useProcurementDetail';

let qc: QueryClient;
const wrapper = (role: Role = 'Finance') =>
  function W({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ImpersonationProvider realRole={role}><ToastProvider>{children}</ToastProvider></ImpersonationProvider>
      </QueryClientProvider>
    );
  };
const input = { title: 'Synthetic case', projectId: null, vendorId: null };

beforeEach(() => {
  vi.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  procurement.create.mockResolvedValue({ id: 'c1', code: 'IMP-1', pr_number: null });
  procurement.transition.mockResolvedValue(undefined);
  m365RecordFolders.ensure.mockImplementation(() => new Promise(() => {}));
});

describe('AC-M365DOC-071 create-case wiring', () => {
  it('an imported case that already carries a code starts exactly one ensure and returns the row unchanged', async () => {
    const { result } = renderHook(() => useCreateProcurement(), { wrapper: wrapper() });
    let row: unknown;
    await act(async () => { row = await result.current.mutateAsync(input); });
    expect(row).toEqual({ id: 'c1', code: 'IMP-1', pr_number: null });
    expect(m365RecordFolders.ensure).toHaveBeenCalledTimes(1);
    expect(m365RecordFolders.ensure).toHaveBeenCalledWith({ kind: 'procurement', id: 'c1' });
  });

  it('a number-less Draft saves with no folder call and no misleading "not linked" notice', async () => {
    procurement.create.mockResolvedValue({ id: 'c2', code: null, pr_number: null });
    const { result } = renderHook(() => useCreateProcurement(), { wrapper: wrapper() });
    await act(async () => { await result.current.mutateAsync(input); });
    expect(m365RecordFolders.ensure).not.toHaveBeenCalled();
  });

  it('the list invalidation is unchanged', async () => {
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateProcurement(), { wrapper: wrapper() });
    await act(async () => { await result.current.mutateAsync(input); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['procurements'] });
  });

  it('a requester who cannot write procDoc (Engineer) saves the case and starts no folder', async () => {
    const { result } = renderHook(() => useCreateProcurement(), { wrapper: wrapper('Engineer') });
    await act(async () => { await result.current.mutateAsync(input); });
    expect(procurement.create).toHaveBeenCalledTimes(1);
    expect(m365RecordFolders.ensure).not.toHaveBeenCalled();
  });

  it('a failed INSERT starts nothing', async () => {
    procurement.create.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useCreateProcurement(), { wrapper: wrapper() });
    await act(async () => { await result.current.mutateAsync(input).catch(() => undefined); });
    expect(m365RecordFolders.ensure).not.toHaveBeenCalled();
  });

  it('a rejecting ensure never fails the create', async () => {
    m365RecordFolders.ensure.mockRejectedValue(Object.assign(new Error('RAW'), { code: 'SCOPE_INSUFFICIENT' }));
    const { result } = renderHook(() => useCreateProcurement(), { wrapper: wrapper() });
    await act(async () => { await result.current.mutateAsync(input); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('AC-M365DOC-071 submit-to-Requested wiring (pr_number is stamped by this transition)', () => {
  it('a successful transition to Requested starts exactly one ensure for that case', async () => {
    const { result } = renderHook(() => useProcurementMutations('c1'), { wrapper: wrapper() });
    await act(async () => { await result.current.transition.mutateAsync({ to: 'Requested' }); });
    expect(procurement.transition).toHaveBeenCalledWith('c1', 'Requested', undefined);
    expect(m365RecordFolders.ensure).toHaveBeenCalledTimes(1);
    expect(m365RecordFolders.ensure).toHaveBeenCalledWith({ kind: 'procurement', id: 'c1' });
  });

  it.each(['Approved', 'Rejected', 'Cancelled', 'Draft'] as const)('a transition to %s starts none', async (to) => {
    const { result } = renderHook(() => useProcurementMutations('c1'), { wrapper: wrapper() });
    await act(async () => { await result.current.transition.mutateAsync({ to }); });
    expect(m365RecordFolders.ensure).not.toHaveBeenCalled();
  });

  it('a failed transition starts nothing', async () => {
    procurement.transition.mockRejectedValueOnce(new Error('P0001'));
    const { result } = renderHook(() => useProcurementMutations('c1'), { wrapper: wrapper() });
    await act(async () => { await result.current.transition.mutateAsync({ to: 'Requested' }).catch(() => undefined); });
    expect(m365RecordFolders.ensure).not.toHaveBeenCalled();
  });

  it('a failed ensure leaves the transition result untouched', async () => {
    m365RecordFolders.ensure.mockRejectedValue(Object.assign(new Error('RAW'), { code: 'GRAPH_ERROR' }));
    const { result } = renderHook(() => useProcurementMutations('c1'), { wrapper: wrapper() });
    await act(async () => { await result.current.transition.mutateAsync({ to: 'Requested' }); });
    await waitFor(() => expect(result.current.transition.isSuccess).toBe(true));
    expect(result.current.transition.isError).toBe(false);
  });

  it('a non-writer submitting (Engineer requester) transitions without a folder call', async () => {
    const { result } = renderHook(() => useProcurementMutations('c1'), { wrapper: wrapper('Engineer') });
    await act(async () => { await result.current.transition.mutateAsync({ to: 'Requested' }); });
    expect(m365RecordFolders.ensure).not.toHaveBeenCalled();
  });
});
