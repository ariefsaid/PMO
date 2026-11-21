import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { setPricesHidden } from '@/src/lib/priceReadPath';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';

/**
 * AC-009 (#2699): the default Table view has no Value column and no money figure when the server hides prices
 * from the person; a person who may see prices keeps both.
 */
const makeRow = (id: string, value: number, status: string, enteredStageAt: string) => ({
  id, code: `PR-${id}`, title: `Row ${id}`, status, total_value: value, approved_total_value: null, currency: 'USD',
  project_id: 'pr-1', budget_category: 'Materials', requested_by_id: 'u-2', vendor_id: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  status_events: [{ to_status: status, created_at: enteredStageAt }],
  project: { name: 'Site', code: 'P1' }, vendor: null, requested_by: { full_name: 'Requester' },
});

// Ages (days in stage, ascending): b (2026-10-01) < a (2026-09-01) < c (2026-08-01).
// Values (ascending): b 100 < c 200 < a 300.
const rows = [
  makeRow('a', 300, 'Ordered', '2026-09-01T00:00:00.000Z'),
  makeRow('b', 100, 'Ordered', '2026-10-01T00:00:00.000Z'),
  makeRow('c', 200, 'Ordered', '2026-08-01T00:00:00.000Z'),
];
const procState = { data: rows as unknown[], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, isPending: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: 'Finance' }) }));

const renderBlock = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><ToastProvider><ProcurementBlock showCreate={false} /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

afterEach(() => act(() => setPricesHidden(false)));

describe('AC-009 procurement table without prices', () => {
  it('shows the Value column and amounts while prices are visible', () => {
    renderBlock();
    expect(screen.getByRole('button', { name: /^Value/ })).toBeInTheDocument();
    expect(screen.getAllByText(/\$\d/).length).toBeGreaterThan(0);
  });
  it('shows no Value column and no money when the server hides prices, and keeps the rows', () => {
    act(() => setPricesHidden(true));
    renderBlock();
    expect(screen.queryByRole('button', { name: /^Value/ })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /^Value/ })).toBeNull();
    expect(screen.queryByText(/\$\d/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Open Row / })).toHaveLength(3);
  });
});
