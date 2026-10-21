import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { m365DocumentQueryKeys, useMicrosoftDocuments, useSetDefaultLibrary } from './useMicrosoftDocuments';

const mock = vi.hoisted(() => ({
  user: { id: 'user-a', org_id: 'org-a' } as { id: string; org_id: string } | null,
  roles: { realRole: 'Admin', effectiveRole: 'Admin' } as { realRole: string | null; effectiveRole: string | null },
  status: vi.fn(),
  defaultLibrary: vi.fn(),
  setDefault: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: mock.user }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => mock.roles }));
vi.mock('@/src/lib/m365/connectClient', () => ({ getM365ConnectionStatus: () => mock.status() }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { m365DocumentSettings: {
    getDefaultLibrary: () => mock.defaultLibrary(),
    setDefaultLibrary: (v: unknown) => mock.setDefault(v),
  } },
}));

const library = { site_id: 's', site_name: 'Synthetic site', drive_id: 'd', drive_name: 'Documents' };
const wrapperFor = (client: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  mock.user = { id: 'user-a', org_id: 'org-a' };
  mock.roles = { realRole: 'Admin', effectiveRole: 'Admin' };
  mock.status.mockReset(); mock.defaultLibrary.mockReset(); mock.setDefault.mockReset();
});

describe('useMicrosoftDocuments', () => {
  it('AC-M365DOC-014 uses caller-specific connection and org-scoped default keys; a settings failure stays distinct from "no default"', async () => {
    mock.status.mockResolvedValue({ connected: true, status: 'active' });
    mock.defaultLibrary.mockRejectedValue(new Error('settings unavailable'));
    const client = newClient();
    const { result } = renderHook(() => useMicrosoftDocuments(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.connection).toMatchObject({ connected: true });
    expect(result.current.defaultLibrary).toBeNull();
    expect(result.current.defaultError).toBeInstanceOf(Error);
    expect(result.current.connectionError).toBeNull();
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(['m365-connection', 'org-a', 'user-a']);
    expect(keys).toContainEqual(['m365-document-default', 'org-a']);
    expect(m365DocumentQueryKeys.connection('org-a', 'user-a')).not.toEqual(m365DocumentQueryKeys.connection('org-a', 'user-b'));
  });

  it('AC-M365DOC-014 two callers in one org never share connection status or Graph cache', async () => {
    mock.status.mockImplementation(async () => (mock.user!.id === 'user-a'
      ? { connected: true, status: 'active' } : { connected: false, status: null }));
    mock.defaultLibrary.mockResolvedValue(library);
    const client = newClient();
    const { result, rerender } = renderHook(() => useMicrosoftDocuments(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.connection).toMatchObject({ connected: true }));
    const statusForFirstUser = result.current.connection;

    mock.user = { id: 'user-b', org_id: 'org-a' };
    rerender();
    await waitFor(() => expect(result.current.connection).toMatchObject({ connected: false }));
    expect(result.current.connection).not.toBe(statusForFirstUser);
    expect(mock.status).toHaveBeenCalledTimes(2);
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(['m365-connection', 'org-a', 'user-a']);
    expect(keys).toContainEqual(['m365-connection', 'org-a', 'user-b']);
    // The org default is org-scoped: the second caller reuses it instead of re-reading.
    expect(mock.defaultLibrary).toHaveBeenCalledTimes(1);
    expect(result.current.defaultLibrary).toEqual(library);
  });

  it('AC-M365DOC-014 a connection-status failure is not reported as "not connected" and does not hide a readable default', async () => {
    mock.status.mockRejectedValue(Object.assign(new Error('x'), { code: 'INTERNAL_ERROR' }));
    mock.defaultLibrary.mockResolvedValue(library);
    const { result } = renderHook(() => useMicrosoftDocuments(), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.connection).toBeUndefined();
    expect(result.current.connectionError).toBeInstanceOf(Error);
    expect(result.current.defaultLibrary).toEqual(library);
    expect(result.current.defaultError).toBeNull();
  });

  it('AC-M365DOC-014 without an auth identity nothing is read', () => {
    mock.user = null;
    const { result } = renderHook(() => useMicrosoftDocuments(), { wrapper: wrapperFor(newClient()) });
    expect(mock.status).not.toHaveBeenCalled();
    expect(mock.defaultLibrary).not.toHaveBeenCalled();
    expect(result.current.connection).toBeUndefined();
  });

  it('AC-M365DOC-056 refetch re-reads both sources', async () => {
    mock.status.mockResolvedValue({ connected: true, status: 'active' });
    mock.defaultLibrary.mockResolvedValue(null);
    const { result } = renderHook(() => useMicrosoftDocuments(), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    await act(async () => { await result.current.refetch(); });
    expect(mock.status).toHaveBeenCalledTimes(2);
    expect(mock.defaultLibrary).toHaveBeenCalledTimes(2);
  });
});

describe('useSetDefaultLibrary', () => {
  it('AC-M365DOC-060 writes through the repository seam and refreshes the org default', async () => {
    mock.setDefault.mockResolvedValue(undefined);
    mock.defaultLibrary.mockResolvedValue(library);
    mock.status.mockResolvedValue({ connected: true, status: 'active' });
    const client = newClient();
    const { result } = renderHook(() => ({ docs: useMicrosoftDocuments(), set: useSetDefaultLibrary() }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.docs.isPending).toBe(false));
    await act(async () => { await result.current.set!.mutateAsync(library); });
    expect(mock.setDefault).toHaveBeenCalledWith(library);
    await waitFor(() => expect(mock.defaultLibrary).toHaveBeenCalledTimes(2));
  });

  it('AC-M365DOC-060 impersonation exposes no mutation', () => {
    mock.roles = { realRole: 'Admin', effectiveRole: 'Engineer' };
    const { result } = renderHook(() => useSetDefaultLibrary(), { wrapper: wrapperFor(newClient()) });
    expect(result.current).toBeNull();
  });
});
