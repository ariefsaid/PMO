import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const repo = vi.hoisted(() => ({
  createRevision: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { document: repo },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'author-1', org_id: 'org-1' } }),
}));

import { useRevision } from './useRevision';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.createRevision.mockResolvedValue({ id: 'child-1', title: 'Test', revision: 'B', status: 'Draft' });
});

describe('useRevision', () => {
  it('AC-DOC-051 (hook): createRevision mutation passes the full editable payload + authorId', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRevision('proj1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createRevision.mutateAsync({
        parentId: 'parent-1',
        title: 'Edited title',
        code: 'DWG-002',
        category: 'Specification',
        revision: 'B',
        doc_date: '2026-06-12',
      });
    });

    expect(repo.createRevision).toHaveBeenCalledWith(
      'parent-1',
      {
        parentId: 'parent-1',
        title: 'Edited title',
        code: 'DWG-002',
        category: 'Specification',
        revision: 'B',
        doc_date: '2026-06-12',
      },
      'author-1',
    );
  });
});