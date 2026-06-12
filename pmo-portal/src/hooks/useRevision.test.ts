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
  useAuth: () => ({ currentUser: { id: 'author-1' } }),
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
  it('AC-DOC-051 (hook): createRevision mutation passes parentId + revision + authorId', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRevision('proj1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createRevision.mutateAsync({ parentId: 'parent-1', revision: 'B' });
    });

    expect(repo.createRevision).toHaveBeenCalledWith('parent-1', 'B', 'author-1');
  });
});