import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { documents } = vi.hoisted(() => ({
  documents: { list: vi.fn(), count: vi.fn(), create: vi.fn(), saveDraft: vi.fn(), post: vi.fn(), cancel: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { documents } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { useStockDocuments, useStockDocumentMutations } from './useStock';

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client()}>{children}</QueryClientProvider>
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

describe('C8b useStock.ts:133 — a write refreshes the document count with the list', () => {
  it('a cancelled document invalidates the count key the chip reads, not only the list', async () => {
    documents.cancel.mockResolvedValue(undefined);
    const qc = client();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useStockDocumentMutations(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await act(async () => { await result.current.cancel.mutateAsync('d1'); });

    const keys = spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    for (const root of ['stock-on-hand', 'stock-ledger', 'stock-documents', 'stock-documents-count', 'stock-document', 'stock-consumption']) {
      expect(keys).toContain(JSON.stringify([root, 'org-1']));
    }
  });
});
