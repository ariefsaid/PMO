import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
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

const Where = () => <output data-testid="where">{useLocation().search}</output>;
const renderBlock = (url = '/procurement') => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[url]}><ToastProvider><ProcurementBlock showCreate={false} /><Where /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);
const openButtons = () => screen.getAllByRole('button', { name: /^Open Purchase PR-/ });
const next = () => userEvent.click(screen.getByRole('button', { name: 'Next page' }));

describe('ProcurementBlock company list is numbered pages of 50 over the whole set', () => {
  it('draws the first 50 newest rows with one count line', () => {
    renderBlock();
    expect(openButtons()).toHaveLength(50);
    expect(screen.getAllByText(/Showing/)).toHaveLength(1);
    expect(screen.getByText('Showing 1–50 of 120')).toBeInTheDocument();
  });
  it('Next goes to page 2, the address carries it, and Previous returns to page 1 without it', async () => {
    renderBlock();
    await next();
    // The page is read from the address, which the router commits as a transition: wait for the page a person would see.
    expect(await screen.findByText('Showing 51–100 of 120')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('page=2');
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('Showing 1–50 of 120')).toBeInTheDocument();
    expect(screen.getByTestId('where')).not.toHaveTextContent('page=');
  });
  it('a shared link to page 3 opens page 3', () => {
    renderBlock('/procurement?page=3');
    expect(screen.getByText('Showing 101–120 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Purchase PR-110' })).toBeInTheDocument();
  });
  it('Buyer finds a purchase by number on page 3 by paging', async () => {
    renderBlock();
    expect(screen.queryByRole('button', { name: 'Open Purchase PR-110' })).not.toBeInTheDocument();
    await next();
    // The second click must meet page 2's Next button, so wait for page 2 before pressing again.
    await screen.findByText('Showing 51–100 of 120');
    await next();
    expect(await screen.findByRole('button', { name: 'Open Purchase PR-110' })).toBeInTheDocument();
  });
  it('Buyer finds a purchase by number that lies on page 3 by search, and a search starts again at page 1', async () => {
    renderBlock('/procurement?page=2');
    await userEvent.type(screen.getByRole('searchbox'), 'PR-110');
    expect(await screen.findByRole('button', { name: 'Open Purchase PR-110' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).not.toHaveTextContent('page=');
  });
  it('select all selects every matching row, not only the 50 on the page', async () => {
    renderBlock();
    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    expect(screen.getByText(/120 selected/i)).toBeInTheDocument();
  });
  it('?open= opens a row that lies on another page', () => {
    renderBlock('/procurement?open=110');
    expect(screen.getAllByText('Purchase PR-110').length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
