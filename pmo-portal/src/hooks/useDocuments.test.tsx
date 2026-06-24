import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// The hooks consume the repository seam (ADR-0017), not the DAL directly.
const { document } = vi.hoisted(() => ({
  document: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    transition: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { document } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'author-1', org_id: 'org-1' }, role: 'Admin' }),
}));

import { useDocuments, useDocumentMutations } from './useDocuments';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const seed = [
  { id: 'd1', project_id: 'p1', code: 'DOC-001', category: 'Drawing', title: 'Site Plan', revision: 'A', status: 'Draft', author_id: 'author-1', doc_date: '2026-06-01', org_id: 'org-1', file_path: null, created_at: '2026-06-01T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  document.list.mockResolvedValue(seed);
  document.create.mockResolvedValue({ ...seed[0], id: 'd2' });
  document.update.mockResolvedValue(undefined);
  document.transition.mockResolvedValue(undefined);
  document.delete.mockResolvedValue(undefined);
});

describe('useDocuments', () => {
  it("AC-DOC-001: keys by ['project-documents', orgId, projectId] (org-scoped) and returns document rows", async () => {
    const client = freshClient();
    const { result } = renderHook(() => useDocuments('p1'), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].title).toBe('Site Plan');
    expect(document.list).toHaveBeenCalledWith('p1');
    // Verify the cache key is org-scoped so impersonation/account-switch cannot bleed cache.
    const cacheHits = client.getQueryCache().findAll({ queryKey: ['project-documents', 'org-1', 'p1'] });
    expect(cacheHits.length).toBe(1);
  });

  it('AC-DOC-001: is disabled when there is no projectId', () => {
    const { result } = renderHook(() => useDocuments(''), { wrapper: wrap(freshClient()) });
    // disabled query never fetches
    expect(document.list).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useDocumentMutations', () => {
  it('AC-DOC-003: create stamps the CURRENT USER id as author_id and invalidates the org-scoped register', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDocumentMutations('p1'), { wrapper: wrap(client) });
    const input = { code: 'DOC-9', category: 'Drawing', title: 'New', revision: 'A', doc_date: '2026-06-08' };
    await act(async () => {
      await result.current.create.mutateAsync(input);
    });
    // author_id is the current user id (never sent by the form) — for the approver-≠-author SoD.
    expect(document.create).toHaveBeenCalledWith('p1', input, 'author-1');
    // Invalidation must include orgId so the correct tenant's cache is cleared.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project-documents', 'org-1', 'p1'] });
  });

  it('AC-DOC-004: update invokes the repository with id + input', async () => {
    const { result } = renderHook(() => useDocumentMutations('p1'), { wrapper: wrap(freshClient()) });
    const input = { code: 'DOC-1', category: 'Spec', title: 'X', revision: 'B', doc_date: '' };
    await act(async () => {
      await result.current.update.mutateAsync({ id: 'd1', input });
    });
    expect(document.update).toHaveBeenCalledWith('d1', input);
  });

  it('AC-DOC-005: transition invokes the repository with id + status', async () => {
    const { result } = renderHook(() => useDocumentMutations('p1'), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.transition.mutateAsync({ id: 'd1', status: 'Issued' });
    });
    expect(document.transition).toHaveBeenCalledWith('d1', 'Issued');
  });

  it('AC-DOC-006: delete invokes the repository with the id', async () => {
    const { result } = renderHook(() => useDocumentMutations('p1'), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.remove.mutateAsync('d1');
    });
    expect(document.delete).toHaveBeenCalledWith('d1');
  });
});
