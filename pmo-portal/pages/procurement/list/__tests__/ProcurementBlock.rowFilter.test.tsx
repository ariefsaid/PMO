import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';

const row = (id: string, status: string) => ({
  id, code: `PR-${id}`, title: `Row ${id}`, status, total_value: 1_000, approved_total_value: null, currency: 'USD',
  project_id: 'p-1', budget_category: 'Materials', requested_by_id: 'u-2', vendor_id: null,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', status_events: [],
  project: { name: 'Site', code: 'P1' }, vendor: null, requested_by: { full_name: 'Requester' },
});
const procState = { data: [row('a', 'Requested'), row('b', 'Ordered')], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useHasErpPurchases: () => ({ data: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/pages/project-detail/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: 'Finance' }) }));

const renderBlock = (rowFilter?: (r: { id: string }) => boolean) => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><ToastProvider><ProcurementBlock rowFilter={rowFilter} /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

describe('ProcurementBlock rowFilter (route "Needs you" tab)', () => {
  it('shows every row in scope without a filter', () => {
    renderBlock();
    expect(screen.getAllByText('Row a').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Row b').length).toBeGreaterThan(0);
  });
  it('narrows the rows to the filter', () => {
    renderBlock((r) => r.id === 'a');
    expect(screen.getAllByText('Row a').length).toBeGreaterThan(0);
    expect(screen.queryByText('Row b')).not.toBeInTheDocument();
  });
});

describe('ProcurementBlock showCreate', () => {
  it('shows its own New procurement by default (the project tab)', () => {
    renderBlock();
    expect(screen.getByRole('button', { name: /new procurement/i })).toBeInTheDocument();
  });
  it('omits its own New procurement when the host page owns the primary action', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><ToastProvider><ProcurementBlock showCreate={false} /></ToastProvider></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: /new procurement/i })).not.toBeInTheDocument();
  });
});
