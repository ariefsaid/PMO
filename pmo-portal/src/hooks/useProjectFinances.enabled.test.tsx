import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  orgId: 'org-A' as string | null,
  role: 'Finance',
  getProjectFinances: vi.fn(),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: h.orgId ? { id: 'user', org_id: h.orgId } : null }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => ['Admin', 'Finance', 'Executive', 'Project Manager'].includes(h.role),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { revenue: { getProjectFinances: h.getProjectFinances } },
}));

import { useProjectFinances } from './useProjectFinances';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const reading = (projectId: string, marker = 'fresh') => ({ project_id: projectId, marker });

describe('useProjectFinances enabled observers', () => {
  beforeEach(() => {
    h.orgId = 'org-A';
    h.role = 'Finance';
    h.getProjectFinances.mockReset().mockImplementation(async (projectId: string) => reading(projectId));
  });

  it('AC-PMP-005 keeps a cold disabled observer idle and enables the default observer', async () => {
    const client = makeClient();
    const wrapper = makeWrapper(client);
    const key = ['project-finances', 'org-A', 'project-A'];

    const disabled = renderHook(
      () => useProjectFinances('project-A', { enabled: false }),
      { wrapper },
    );
    expect(disabled.result.current.fetchStatus).toBe('idle');
    expect(h.getProjectFinances).not.toHaveBeenCalled();
    disabled.unmount();

    const enabled = renderHook(() => useProjectFinances('project-A'), { wrapper });
    await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true));
    expect(h.getProjectFinances).toHaveBeenCalledExactlyOnceWith('project-A');
    expect(client.getQueryData(key)).toEqual(reading('project-A'));
  });

  it.each([
    { role: 'Engineer', orgId: 'org-A', projectId: 'project-A' },
    { role: 'Finance', orgId: null, projectId: 'project-A' },
    { role: 'Finance', orgId: 'org-A', projectId: '' },
  ])('AC-PMP-005 option enablement does not bypass existing permission/context gates %o', ({ role, orgId, projectId }) => {
    h.role = role;
    h.orgId = orgId;
    const { result } = renderHook(
      () => useProjectFinances(projectId, { enabled: true }),
      { wrapper: makeWrapper(makeClient()) },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(h.getProjectFinances).not.toHaveBeenCalled();
  });

  it('AC-PMP-005 starts the existing observer when disabled changes to enabled', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useProjectFinances('project-A', { enabled }),
      { initialProps: { enabled: false }, wrapper: makeWrapper(makeClient()) },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.getProjectFinances).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.getProjectFinances).toHaveBeenCalledExactlyOnceWith('project-A');
  });

  it('AC-PMP-005 keeps organization and project identity in the existing query key', async () => {
    const client = makeClient();
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useProjectFinances(projectId),
      { initialProps: { projectId: 'project-A' }, wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['project-finances', 'org-A', 'project-A'])).toEqual(reading('project-A'));

    h.orgId = 'org-B';
    rerender({ projectId: 'project-A' });
    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['project-finances', 'org-B', 'project-A'])).toEqual(reading('project-A'));

    rerender({ projectId: 'project-B' });
    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['project-finances', 'org-B', 'project-B'])).toEqual(reading('project-B'));
  });

  it('AC-PMP-005 exposes warm cached data to a disabled observer without initiating a read', () => {
    const client = makeClient();
    const key = ['project-finances', 'org-A', 'project-A'];
    client.setQueryData(key, reading('project-A', 'cached'));

    const { result } = renderHook(
      () => useProjectFinances('project-A', { enabled: false }),
      { wrapper: makeWrapper(client) },
    );

    expect(result.current.data).toEqual(reading('project-A', 'cached'));
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.getProjectFinances).not.toHaveBeenCalled();
  });

  it('AC-PMP-005 shares an in-flight read and refetches through the enabled observer alone', async () => {
    const client = makeClient();
    const wrapper = makeWrapper(client);
    const key = ['project-finances', 'org-A', 'project-A'];
    const initial = deferred<{ project_id: string; marker: string }>();
    const refreshed = deferred<{ project_id: string; marker: string }>();
    h.getProjectFinances.mockReset()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refreshed.promise);

    const hidden = renderHook(
      () => useProjectFinances('project-A', { enabled: false }),
      { wrapper },
    );
    const visible = renderHook(() => useProjectFinances('project-A'), { wrapper });

    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledTimes(1));
    expect(h.getProjectFinances).toHaveBeenCalledExactlyOnceWith('project-A');
    await act(async () => {
      initial.resolve(reading('project-A', 'initial'));
      await initial.promise;
    });
    await waitFor(() => expect(visible.result.current.data).toEqual(reading('project-A', 'initial')));
    expect(hidden.result.current.data).toEqual(reading('project-A', 'initial'));

    act(() => {
      void client.invalidateQueries({ queryKey: key });
    });
    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalledTimes(2));
    await act(async () => {
      refreshed.resolve(reading('project-A', 'refreshed'));
      await refreshed.promise;
    });
    await waitFor(() => expect(visible.result.current.data).toEqual(reading('project-A', 'refreshed')));
    expect(hidden.result.current.data).toEqual(reading('project-A', 'refreshed'));

    visible.unmount();
    await act(async () => {
      await client.invalidateQueries({ queryKey: key });
    });
    expect(h.getProjectFinances).toHaveBeenCalledTimes(2);
  });
});
