import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { breadcrumbForPath, recordLabelForPath } from '@/src/components/shell/routeMatch';

const { getDetail, actor } = vi.hoisted(() => ({
  getDetail: vi.fn(),
  actor: { org_id: 'org-1', id: 'user-1', role: 'Finance' },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: actor }) }));
vi.mock('@/src/lib/db/procurementLifecycle', async (original) => ({
  ...await original<typeof import('@/src/lib/db/procurementLifecycle')>(),
  getProcurementDetail: getDetail,
}));

import { useCachedRecordLists } from './useCachedRecordLists';
import { useProcurementDetail } from './useProcurementDetail';

const path = '/procurement/pr1/items';
const record = { id: 'pr1', title: 'Crane hire' };
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

describe('AC-OVERFETCH-001 caller-scoped procurement breadcrumb', () => {
  beforeEach(() => { vi.resetAllMocks(); Object.assign(actor, { org_id: 'org-1', id: 'user-1', role: 'Finance' }); });

  it('reads the real page query after it settles without adding a query observer or fetch', async () => {
    let resolve!: (value: typeof record) => void;
    getDetail.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { qc, wrapper } = setup();
    const shell = renderHook(() => useCachedRecordLists(path), { wrapper });
    expect(shell.result.current.resolved).toBe(false);
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    const page = renderHook(() => useProcurementDetail('pr1'), { wrapper });
    expect(getDetail).toHaveBeenCalledTimes(1);
    const query = qc.getQueryCache().getAll()[0];
    expect(query.getObserversCount()).toBe(1);
    await act(async () => { resolve(record); });
    await waitFor(() => expect(page.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(shell.result.current.resolved).toBe(true));
    expect(recordLabelForPath(path, shell.result.current.lists)).toBe('Crane hire');
    expect(query.getObserversCount()).toBe(1);
    expect(qc.getQueryCache().getAll()).toHaveLength(1);
    expect(getDetail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['other org', ['procurement', 'org-2', 'pr1', 'user-1', 'Finance']],
    ['other actor', ['procurement', 'org-1', 'pr1', 'user-2', 'Finance']],
    ['other role', ['procurement', 'org-1', 'pr1', 'user-1', 'Admin']],
    ['unscoped', ['procurement', 'org-1', 'pr1']],
  ])('does not use %s cache data', (_name, key) => {
    const { qc, wrapper } = setup();
    qc.setQueryData(key, record);
    const { result } = renderHook(() => useCachedRecordLists(path), { wrapper });
    expect(result.current.resolved).toBe(false);
    expect(recordLabelForPath(path, result.current.lists)).toBeUndefined();
    expect(getDetail).not.toHaveBeenCalled();
  });

  it.each(['absent', 'error'])('settles to Not found on %s', async (outcome) => {
    if (outcome === 'absent') getDetail.mockResolvedValue(null);
    else getDetail.mockRejectedValue(new Error('failed'));
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ shell: useCachedRecordLists(path), page: useProcurementDetail('pr1') }), { wrapper });
    await waitFor(() => expect(result.current.shell.resolved).toBe(true));
    const label = recordLabelForPath(path, result.current.shell.lists);
    expect(breadcrumbForPath(path, label, undefined, result.current.shell.resolved)[1].label).toBe('Not found');
    expect(getDetail).toHaveBeenCalledTimes(1);
  });

  it('retains same-caller stale data when a refetch fails', async () => {
    getDetail.mockRejectedValue(new Error('failed'));
    const { qc, wrapper } = setup();
    qc.setQueryData(['procurement', 'org-1', 'pr1', 'user-1', 'Finance'], record);
    const { result } = renderHook(() => ({ shell: useCachedRecordLists(path), page: useProcurementDetail('pr1') }), { wrapper });
    await waitFor(() => expect(result.current.page.isError).toBe(true));
    expect(result.current.shell.resolved).toBe(true);
    expect(recordLabelForPath(path, result.current.shell.lists)).toBe('Crane hire');
  });
});
