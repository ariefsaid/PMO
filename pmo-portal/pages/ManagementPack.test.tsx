import React from 'react';
import { MemoryRouter } from 'react-router';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ManagementPack } from '@/src/lib/reports/managementPack';

const state = vi.hoisted(() => ({ pack: null as ManagementPack | null }));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: null }) }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({ data: state.pack, isPending: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {} }) }));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportTable: vi.fn(), busy: false }) }));
vi.mock('@/src/components/reports/RecordProgressModal', () => ({ RecordProgressModal: () => null }));

import ManagementPackPage from './ManagementPack';

const month = '2026-10-01';
const report = (): ManagementPack => ({
  from: month,
  to: month,
  timezone: 'UTC',
  months: [month],
  rows: [{
    key: 'project|USD|contract', kind: 'contract', projectId: null, projectName: null, projectNumber: null,
    clientName: null, projectManagerId: null, projectStatus: null, currency: 'USD', contractNet: 100_000,
    latestProgress: null,
    months: [{ month, planned: 10_000, recognised: 10_000, invoiced: 10_000, invoiceCount: 0, recognisedToDate: 10_000,
      invoicedToDate: 10_000, invoiceCountToDate: 0, unbilled: 0, backlog: null, basis: 'invoiced' }],
  }],
  totals: [{ currency: 'USD', months: [{ month, planned: 10_000, recognised: 10_000, invoiced: 10_000, invoiceCount: 0,
    recognisedToDate: 10_000, invoicedToDate: 10_000, invoiceCountToDate: 0, unbilled: 0, backlog: null }] }],
  undatedInvoiceCount: 0,
});

beforeEach(() => { state.pack = report(); });

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><ManagementPackPage /></MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Management pack money display (#1260, #1437)', () => {
  it('AC-MONEY-DISPLAY: keeps unknown backlog separate from known zero unbilled and links to invoice review', () => {
    renderPage();

    const figures = screen.getByRole('region', { name: 'Report figures' });
    const backlogHelp = within(figures).getByRole('button', { name: 'How this figure is calculated: Backlog of contract total' });
    expect(backlogHelp).toBeInTheDocument();
    const backlogTile = backlogHelp.parentElement?.parentElement;
    expect(backlogTile).not.toBeNull();
    expect(backlogTile).not.toHaveTextContent(/\$|USD|\d|—|Unavailable/);
    expect(within(figures).queryByRole('status')).not.toBeInTheDocument();
    expect(within(figures).getAllByText('$0', { exact: true })).toHaveLength(1);
    expect(within(figures).queryByRole('button', { name: /foreign-currency invoice needs reconciliation/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();

    expect(screen.getAllByText(/Backlog is left out where a foreign-currency invoice needs reconciliation before the balance can be known/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Review invoices' })).toHaveAttribute('href', '/finance/receivables');
  });
});
