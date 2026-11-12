import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { documents } = vi.hoisted(() => ({ documents: { list: vi.fn(), count: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { documents } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { useStockDocuments } from './useStock';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  documents.list.mockResolvedValue([]);
  documents.count.mockResolvedValue(62);
});

describe('useStockDocuments', () => {
  it('C8 StockDocuments.tsx:56 uses the exact filter count while the list remains paged', async () => {
    const filters = { kind: 'issue' as const, status: 'Posted' as const };
    const { result } = renderHook(() => useStockDocuments(filters), { wrapper });

    await waitFor(() => expect(result.current.total).toBe(62));

    expect(documents.list).toHaveBeenCalledWith({ ...filters, limit: 50, before: undefined });
    expect(documents.count).toHaveBeenCalledWith(filters);
    expect(result.current.data?.pages).toEqual([[]]);
  });

  it('keeps the paged result usable when the exact count is unavailable', async () => {
    documents.list.mockResolvedValue([{ id: 'd1' }]);
    documents.count.mockRejectedValue(new Error('count unavailable'));
    const { result } = renderHook(() => useStockDocuments({ status: 'Draft' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(documents.count).toHaveBeenCalledWith({ status: 'Draft' }));
    expect(result.current.total).toBeUndefined();
    expect(result.current.isError).toBe(false);
  });
});
