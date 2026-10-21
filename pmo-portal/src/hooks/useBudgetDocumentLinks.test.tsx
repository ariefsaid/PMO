import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBudgetDocumentLinks } from './useBudgetDocumentLinks';

const mock = vi.hoisted(() => ({
  user: { id: 'user-a', org_id: 'org-a' } as { id: string; org_id: string } | null,
  list: vi.fn(), add: vi.fn(), remove: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: mock.user }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { budget: {
    listDocumentLinks: (id: string) => mock.list(id),
    addDocumentLink: (id: string, ref: unknown) => mock.add(id, ref),
    removeDocumentLink: (id: string) => mock.remove(id),
  } },
}));

const row = (id: string, versionId: string) => ({ id, budget_version_id: versionId });
const ref = { drive_id: 'd', item_id: 'i', web_url: 'https://tenant.sharepoint.com/x', name: 'x.xlsx', item_kind: 'file' as const };
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (client: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  mock.user = { id: 'user-a', org_id: 'org-a' };
  mock.list.mockReset(); mock.add.mockReset(); mock.remove.mockReset();
  mock.list.mockImplementation(async (id: string) => [row(`link-of-${id}`, id)]);
});

describe('useBudgetDocumentLinks', () => {
  it('AC-M365DOC-052 does not fetch without a version and keys the list by org + selected version', async () => {
    const client = newClient();
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useBudgetDocumentLinks(id), {
      wrapper: wrap(client), initialProps: { id: null as string | null },
    });
    expect(mock.list).not.toHaveBeenCalled();
    rerender({ id: 'v1' });
    await waitFor(() => expect(result.current.query.data).toEqual([row('link-of-v1', 'v1')]));
    rerender({ id: 'v2' });
    await waitFor(() => expect(result.current.query.data).toEqual([row('link-of-v2', 'v2')]));
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toEqual(
      expect.arrayContaining([['budget-document-links', 'org-a', 'v1'], ['budget-document-links', 'org-a', 'v2']]),
    );
  });

  it('AC-M365DOC-052 reads an Active or Archived version identically (no status argument exists to gate on)', async () => {
    const { result } = renderHook(() => useBudgetDocumentLinks('v-archived'), { wrapper: wrap(newClient()) });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(mock.list).toHaveBeenCalledWith('v-archived');
  });

  it('AC-M365DOC-062 add and remove call only the evidence repository methods and invalidate only the evidence key', async () => {
    mock.add.mockResolvedValue(row('new', 'v1')); mock.remove.mockResolvedValue(undefined);
    const client = newClient();
    client.setQueryData(['budget-versions', 'org-a', 'p1'], ['financial']);
    const { result } = renderHook(() => useBudgetDocumentLinks('v1'), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    await act(async () => { await result.current.add.mutateAsync(ref); });
    expect(mock.add).toHaveBeenCalledWith('v1', ref);
    await act(async () => { await result.current.remove.mutateAsync('link-1'); });
    expect(mock.remove).toHaveBeenCalledWith('link-1');
    expect(mock.list.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(client.getQueryState(['budget-versions', 'org-a', 'p1'])?.isInvalidated).toBe(false);
  });

  it('AC-M365DOC-052 stays disabled without an org (no cross-org read)', () => {
    mock.user = null;
    renderHook(() => useBudgetDocumentLinks('v1'), { wrapper: wrap(newClient()) });
    expect(mock.list).not.toHaveBeenCalled();
  });
});
