import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProcurementListRow } from '../ProcurementListRow';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => ({
    data: { id: 'p-1', project_id: 'p1', title: 'Transformer upgrade', status: 'Requested', total_value: 25000, currency: 'USD', project: { name: 'Tower project', code: 'T-1' }, items: [{ id: 'i-1', name: 'Transformer', quantity: 1, rate: 25000 }] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useBudget', () => ({ useProjectBudget: () => ({ data: 100000, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 1000, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 2000, projectCurrency: 'IDR', budgetCurrency: 'IDR', isPending: false, isError: false }),
}));

const row = {
  id: 'p-1', code: 'PR-1', title: 'Transformer upgrade', status: 'Requested', total_value: 25000, currency: 'USD', created_at: '2026-10-01T00:00:00Z',
  project_id: 'p1', requested_by_id: 'u1', project: { name: 'Tower project', code: 'T-1' }, requested_by: { full_name: 'Alice Requester' }, vendor: null, vendor_id: null,
} as ProcurementWithRefs;

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="route-probe" data-state={JSON.stringify(location.state ?? null)}>{location.pathname}</output>;
};

const renderRow = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/procurement?tab=all']}>
      <LocationProbe />
      <ToastProvider><ProcurementListRow row={row} /></ToastProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  sessionStorage.clear();
});

describe('Procurement grouped row floor control', () => {
  it('floor: View procurement case opens the selected record with list-return context', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /Show preview for Transformer upgrade/i }));
    expect(await screen.findByRole('region', { name: 'Preview for Transformer upgrade' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'View procurement case' }));
    const route = screen.getByTestId('route-probe');
    await waitFor(() => expect(route).toHaveTextContent('/procurement/p-1'));
    expect(JSON.parse(route.getAttribute('data-state') ?? 'null')).toMatchObject({ pmoListReturn: { list: 'procurement' } });
  });
});
