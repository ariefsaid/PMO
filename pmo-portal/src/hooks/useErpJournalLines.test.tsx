import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePurchaseJournalLines } from './useErpJournalLines';

const h = vi.hoisted(() => ({ listProject: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { erpJournalLines: { listProject: h.listProject } } }));

const line = (voucherNo: string, procurementId: string | null) => ({ voucherNo, procurementId });

describe('#2107 purchase journal lines share the project read', () => {
  it('opening 5 purchases of one project downloads the project journal lines once', async () => {
    h.listProject.mockResolvedValue([line('J1', 'a'), line('J2', 'b'), line('J3', 'a'), line('J4', null)]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const results: string[][] = [];
    for (const id of ids) {
      const { result, unmount } = renderHook(() => usePurchaseJournalLines(id, 'p1'), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      results.push((result.current.data ?? []).map((l) => l.voucherNo));
      unmount();
    }
    expect(h.listProject).toHaveBeenCalledTimes(1);
    expect(results).toEqual([['J1', 'J3'], ['J2'], [], [], []]);
  });
});
