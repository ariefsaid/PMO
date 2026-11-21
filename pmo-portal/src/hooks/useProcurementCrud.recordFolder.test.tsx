// @vitest-environment jsdom
/**
 * AC-M365DOC-071 a successful submission survives every folder failure — the shipped
 * `useProcurementMutations().transition` starts the folder step.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui/Toast';
import type { Role } from '@/src/auth/AuthContext';

const { procurement, m365RecordFolders } = vi.hoisted(() => ({
  procurement: { transition: vi.fn() },
  m365RecordFolders: { ensure: vi.fn() },
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => true }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement, m365RecordFolders } }));
vi.mock('@/src/lib/db/procurementLifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/db/procurementLifecycle')>()),
  getProcurementDetail: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Finance' }),
}));

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
beforeEach(() => {
  vi.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  procurement.transition.mockResolvedValue(undefined);
  m365RecordFolders.ensure.mockImplementation(() => new Promise(() => {}));
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

  it('RF-9 a case raised by someone else, moved to Requested by an approver, starts exactly one ensure for the approver', async () => {
    // The case was raised by another user (an Engineer); the transition runs for THIS signed-in approver.
    const { result } = renderHook(() => useProcurementMutations('c-raised-by-other'), { wrapper: wrapper('Project Manager') });
    await act(async () => { await result.current.transition.mutateAsync({ to: 'Requested' }); });
    expect(m365RecordFolders.ensure).toHaveBeenCalledTimes(1);
    expect(m365RecordFolders.ensure).toHaveBeenCalledWith({ kind: 'procurement', id: 'c-raised-by-other' });
  });

  it('RF-9 a view-only impersonating approver starts nothing', async () => {
    const { result } = renderHook(() => useProcurementMutations('c1'), { wrapper: wrapper('Engineer') });
    await act(async () => { await result.current.transition.mutateAsync({ to: 'Requested' }); });
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
