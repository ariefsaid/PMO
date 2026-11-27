import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const many = Array.from({ length: 120 }, (_, i) => ({ ...row(String(i + 1).padStart(3, '0'), 'Ordered'), title: `Purchase PR-${String(i + 1).padStart(3, '0')}`, code: `PR-${String(i + 1).padStart(3, '0')}`, created_at: new Date(Date.UTC(2026, 9, 1) - i * 60_000).toISOString() }));
const procState = { data: many, isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, refetch: vi.fn() }),
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
const openButtons = () => screen.getAllByRole('button', { name: /^Open Purchase PR-/ });

describe('ProcurementBlock company list is shown 50 rows at a time over the whole set', () => {
  it('draws the first 50 newest rows and says how many there are', () => {
    renderBlock();
    expect(openButtons()).toHaveLength(50);
    expect(screen.getByText(/Showing 50 of 120/)).toBeInTheDocument();
  });
  it('Show more adds the next 50, then the rest', async () => {
    renderBlock();
    await userEvent.click(screen.getByRole('button', { name: /show more/i }));
    expect(openButtons()).toHaveLength(100);
    await userEvent.click(screen.getByRole('button', { name: /show more/i }));
    expect(openButtons()).toHaveLength(120);
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
  });
  it('Buyer finds a purchase by number that lies beyond the first 50', async () => {
    renderBlock();
    expect(screen.queryByRole('button', { name: 'Open Purchase PR-110' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'PR-110');
    expect(screen.getByRole('button', { name: 'Open Purchase PR-110' })).toBeInTheDocument();
  });
  it('select all selects every matching row, not only the 50 drawn', async () => {
    renderBlock();
    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    expect(screen.getByText(/120 selected/i)).toBeInTheDocument();
  });
});
