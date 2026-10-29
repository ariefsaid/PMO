import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { buildManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';

/**
 * Regression guard for the live Reports surface that replaced Revenue by Project.
 * These checks keep its honest-money, per-currency and tax-basis behavior tied to the
 * component users now open; client receivables remain in the Receivables workspace.
 */
const h = vi.hoisted(() => ({
  query: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown, refetch: vi.fn() },
  exportTable: vi.fn(),
  revenueRows: [] as Array<Record<string, unknown>>,
  orgCurrency: { currency: 'IDR', isResolved: true, isError: false },
}));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => h.query,
  useRecordProjectProgress: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {} }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [
    { id: 'p1', name: 'Alpha', pm: null },
    { id: 'p2', name: 'Beta', pm: null },
  ] }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useRevenuePerProject: () => ({ data: h.revenueRows, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => h.orgCurrency }));
vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportTable: h.exportTable, exportXlsx: vi.fn(), busy: false }),
}));
vi.mock('@/src/components/reports/BoardPackAction', () => ({ BoardPackAction: () => null }));
vi.mock('@/src/components/reports/RecordProgressModal', () => ({ RecordProgressModal: () => null }));

import ManagementPack from '../ManagementPack';

const project = (id: string, name: string, currency: string, contract_net: number) => ({
  id, name, pmo_project_number: null, code: null, status: 'Ongoing Project', currency, contract_net,
  start_date: null, end_date: null, project_manager_id: null, client_name: null,
});

const facts: ManagementPackFacts = {
  from: '2026-03-01', to: '2026-04-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [project('p1', 'Alpha', 'IDR', 90_000_000), project('p2', 'Beta', 'USD', 20_000)],
  invoiced: [
    { project_id: 'p1', currency: 'IDR', month: '2026-04-01', net: 62_400_000, invoice_count: 1 },
    { project_id: 'p1', currency: 'USD', month: '2026-04-01', net: 1_250, invoice_count: 1 },
  ],
  invoiced_before: [],
  progress: [],
};

const renderPage = () => render(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  h.query = { data: buildManagementPack(facts), isPending: false, isError: false, error: null, refetch: vi.fn() };
  h.exportTable.mockReset();
  h.revenueRows = [
    { project_id: 'p1', currency: 'IDR', total_amount: 62_400_000, open_ar: 5_000_000, invoice_count: 1 },
    { project_id: 'p1', currency: 'USD', total_amount: 1_250, open_ar: 80, invoice_count: 1 },
  ];
  h.orgCurrency = { currency: 'IDR', isResolved: true, isError: false };
});

describe('live Reports money honesty (adapted from RevenueByProject)', () => {
  it('shows an error without fabricated zero money when the report query fails', () => {
    h.query = { data: undefined, isPending: false, isError: true, error: new Error('network'), refetch: vi.fn() };
    renderPage();

    expect(screen.getByText("Couldn't load Reports")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^pack-cell-/)).toHaveLength(0);
    expect(screen.queryByText(/\$0(?:\.00)?/)).not.toBeInTheDocument();
  });

  it('keeps project totals in their own currencies and states the report uses net amounts', () => {
    renderPage();

    const alphaRows = screen.getAllByRole('row').filter((row) => within(row).queryByText('Alpha'));
    expect(alphaRows).toHaveLength(2);
    expect(within(alphaRows[0]).getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/IDR\s?62,400,000/);
    expect(within(alphaRows[1]).getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/\$1,250/);
    expect(screen.getByText(/All figures exclude tax/)).toBeInTheDocument();
    expect(screen.queryByText(/\$63,401,250/)).not.toBeInTheDocument();
  });

  it('keeps unpaid client balances out of the Reports table and export', async () => {
    renderPage();

    expect(screen.queryByRole('columnheader', { name: /Unpaid by client/i })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Unpaid by client|Open AR/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export' }));
    const [table] = h.exportTable.mock.calls[0];
    expect(table.header).not.toContain('Unpaid by client · incl. tax');
    expect(table.header).not.toContain('Unpaid by client');
  });
});
