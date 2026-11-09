import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

/**
 * ProcurementBlock is memoised on its PROPS so a host page's per-query-settle re-render skips the table.
 * The contract that keeps that safe: the block reads its own data, so data arriving for it — a refetch,
 * an invalidation, a fresh cache entry — still re-renders it. This test drives the real query hook.
 */
const KEY = ['procurements', 'org-1', 'with-refs', 'with-shared-details'];
const store: { rows: unknown[] } = { rows: [] };

vi.mock('@/src/hooks/useProcurements', async () => {
  const { useQuery: useQueryImpl } = await import('@tanstack/react-query');
  const useRead = () => useQueryImpl({ queryKey: ['procurements', 'org-1', 'with-refs', 'with-shared-details'], queryFn: async () => store.rows });
  return { useProcurements: useRead, useProjectProcurements: useRead };
});
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, isPending: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/pages/project-detail/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: 'Finance' }) }));

const { ProcurementBlock } = await import('@/src/components/procurement/ProcurementBlock');

const row = (id: string, title: string) => ({
  id, code: `PR-${id}`, title, status: 'Requested', total_value: 1_000, approved_total_value: null, currency: 'USD',
  project_id: 'p-1', budget_category: 'Materials', requested_by_id: 'u-2', vendor_id: null,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', status_events: [],
  project: { name: 'Site', code: 'P1' }, vendor: null, requested_by: { full_name: 'Requester' },
});

describe('ProcurementBlock (memoised) data contract', () => {
  it('renders the rows its own query returns, and follows that query when its data changes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(KEY, [row('a', 'First purchase')]);
    store.rows = [row('a', 'First purchase')];

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><ToastProvider><ProcurementBlock showCreate={false} /></ToastProvider></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('First purchase')).toBeInTheDocument();
    expect(screen.queryByText('Second purchase')).not.toBeInTheDocument();

    // The block's own data changes (a refetch/invalidation settling), not its props.
    store.rows = [row('a', 'First purchase'), row('b', 'Second purchase')];
    await act(async () => {
      client.setQueryData(KEY, store.rows);
    });

    expect(await screen.findByText('Second purchase')).toBeInTheDocument();
  });

  it('follows a new filter prop through the memo boundary', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rows = [row('a', 'First purchase'), row('b', 'Second purchase')];
    client.setQueryData(KEY, rows);
    store.rows = rows;

    const tree = (rowFilter?: (r: { id: string }) => boolean) => (
      <QueryClientProvider client={client}>
        <MemoryRouter><ToastProvider><ProcurementBlock showCreate={false} rowFilter={rowFilter} /></ToastProvider></MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree());
    expect(await screen.findByText('Second purchase')).toBeInTheDocument();

    rerender(tree((r) => r.id === 'a'));

    expect(await screen.findByText('First purchase')).toBeInTheDocument();
    expect(screen.queryByText('Second purchase')).not.toBeInTheDocument();
  });
});
