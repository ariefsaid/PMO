/** FR-PFE-020/031/032 — linked-document read, and link/unlink refreshing every figure a link can move (incl. the purchase's derived status). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLinkedErpDocuments, useLinkErpDocuments, useUnlinkErpDocument } from './useErpPurchaseLinks';

const mock = vi.hoisted(() => ({ listLinked: vi.fn(), link: vi.fn(), unlink: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u', org_id: 'org-a' } }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { erpPurchases: {
    listLinked: (id: string) => mock.listLinked(id),
    link: (rows: unknown, dryRun?: boolean) => mock.link(rows, dryRun),
    unlink: (id: string) => mock.unlink(id),
  } },
}));

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (client: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const MOVED = ['erp-purchases', 'procurement', 'erp-purchases-any', 'linked-erp-documents', 'procurements', 'project-committed-spend'];
const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => ((c[0] as { queryKey: unknown[] }).queryKey)[0]);

beforeEach(() => { mock.listLinked.mockReset(); mock.link.mockReset(); mock.unlink.mockReset(); });

describe('useErpPurchaseLinks', () => {
  it('reads one purchase\'s linked documents, and nothing without a purchase id', async () => {
    mock.listLinked.mockResolvedValue([{ id: 'd1' }]);
    const client = newClient();
    const { result } = renderHook(() => useLinkedErpDocuments('pur-1'), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'd1' }]));
    expect(mock.listLinked).toHaveBeenCalledWith('pur-1');
    const idle = renderHook(() => useLinkedErpDocuments(null), { wrapper: wrap(newClient()) });
    expect(idle.result.current.fetchStatus).toBe('idle');
    expect(mock.listLinked).toHaveBeenCalledTimes(1);
  });

  it('a real link refreshes orphans, purchases, committed spend and linked lists; a dry run refreshes nothing', async () => {
    const client = newClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(['procurements', 'org-a', 'by-vendor', 'v1'], 'old');
    client.setQueryData(['procurements', 'org-b', 'by-vendor', 'v1'], 'other');
    const { result } = renderHook(() => useLinkErpDocuments(), { wrapper: wrap(client) });
    mock.link.mockResolvedValueOnce({ dry_run: true, counts: { link: 1, skip: 0, refused: 0 }, results: [] });
    await act(() => result.current.mutateAsync({ rows: [{ erp_name: 'PINV-1' }], dryRun: true }));
    expect(mock.link).toHaveBeenCalledWith([{ erp_name: 'PINV-1' }], true);
    expect(spy).not.toHaveBeenCalled();
    mock.link.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 0 }, results: [] });
    await act(() => result.current.mutateAsync({ rows: [{ erp_name: 'PINV-1' }] }));
    expect(invalidatedKeys(spy).sort()).toEqual([...MOVED].sort());
    expect(client.getQueryState(['procurements', 'org-a', 'by-vendor', 'v1'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['procurements', 'org-b', 'by-vendor', 'v1'])?.isInvalidated).toBe(false);
  });

  it('unlink refreshes the same figures', async () => {
    const client = newClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    mock.unlink.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useUnlinkErpDocument(), { wrapper: wrap(client) });
    await act(() => result.current.mutateAsync('l-1'));
    expect(mock.unlink).toHaveBeenCalledWith('l-1');
    expect(invalidatedKeys(spy).sort()).toEqual([...MOVED].sort());
  });
});
