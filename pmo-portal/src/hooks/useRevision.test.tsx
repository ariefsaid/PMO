import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { document } = vi.hoisted(() => ({ document: { createRevision: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { document } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'author-1', org_id: 'org-1' } }),
}));

import { useRevision } from './useRevision';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const base = { parentId: 'd1', title: 'T', code: 'C', category: 'Drawing', revision: 'B', doc_date: '' };

describe('useRevision', () => {
  it('AC-M365DOC-068: forwards the optional Microsoft reference as the fourth argument', async () => {
    document.createRevision.mockResolvedValue({ id: 'd2' });
    const reference = { drive_id: 'drive-1', item_id: 'item-1', web_url: 'https://example.invalid/f', name: 'Synthetic.pdf', item_kind: 'file' as const };
    const { result } = renderHook(() => useRevision('p1'), { wrapper: wrap(new QueryClient()) });
    await act(async () => { await result.current.createRevision.mutateAsync({ ...base, microsoft: reference }); });
    expect(document.createRevision).toHaveBeenCalledWith('d1', expect.objectContaining({ title: 'T' }), 'author-1', reference);
  });

  it('existing three-argument callers stay valid (no reference forwarded)', async () => {
    document.createRevision.mockResolvedValue({ id: 'd2' });
    const { result } = renderHook(() => useRevision('p1'), { wrapper: wrap(new QueryClient()) });
    await act(async () => { await result.current.createRevision.mutateAsync(base); });
    expect(document.createRevision).toHaveBeenLastCalledWith('d1', expect.anything(), 'author-1');
  });
});
