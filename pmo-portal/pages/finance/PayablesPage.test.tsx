import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancePosition } from '@/src/lib/finance/financePosition';

const state = vi.hoisted(() => ({
  role: 'Finance',
  position: null as FinancePosition | null,
  exportXlsx: vi.fn(),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => entity === 'finance' && action === 'view',
}));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({ position: state.position, isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({
    data: [{
      id: 'project-1',
      name: 'North project',
      short_name: 'North',
      code: 'PRJ-10',
      pmo_project_number: null,
      pm: { full_name: 'Dana Wibowo' },
    }],
  }),
}));
vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportXlsx: state.exportXlsx, busy: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));

import PayablesPage from './PayablesPage';

function payablesFixture(): FinancePosition {
  return {
    receivablesCount: 0,
    overdue: [],
    overdueTotals: {},
    overdueUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] },
    toSend: [],
    unappliedPayments: [],
    unappliedTotals: {},
    payables: [{
      procurement: {
        id: 'procurement-1',
        title: 'Equipment inspection',
        code: 'PR-104',
        status: 'Vendor Invoiced',
        vendor_id: 'supplier-1',
        vendor: { name: 'Sinar Supplier' },
        total_value: 62_400_000,
        currency: 'IDR',
        vendor_invoiced_at: null,
        updated_at: '2026-07-19T00:00:00Z',
        project_id: 'project-1',
        project: { name: 'North project', short_name: 'North', code: 'PRJ-10', pmo_project_number: null },
      } as FinancePosition['payables'][number]['procurement'],
      ageDays: 100,
      amount: 6_240_000_000,
    }],
    payablesTotals: { IDR: 6_240_000_000 },
    receivablesAgeing: {},
    payablesAgeing: { IDR: { d0_30: 0, d31_60: 0, d61_90: 0, over90: 6_240_000_000 } },
  };
}

function Location() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

function renderPage(role = 'Finance') {
  state.role = role;
  state.position = payablesFixture();
  return render(
    <MemoryRouter initialEntries={['/finance/payables']}>
      <Routes>
        <Route path="/finance/payables" element={<><PayablesPage /><Location /></>} />
        <Route path="/procurement/:id" element={<><p>PROCUREMENT RECORD</p><Location /></>} />
        <Route path="/companies/:id" element={<p>SUPPLIER RECORD</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.position = payablesFixture();
  state.exportXlsx.mockClear();
});

afterEach(() => {
  cleanup();
  state.role = 'Finance';
});

describe('Payables page', () => {
  it('AC-1405-PAY-001: shows one shared to-pay total, ageing and supplier/project context', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Payables', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText(/62,400,000/).length).toBeGreaterThan(0);
    expect(screen.getByText('Sinar Supplier')).toBeInTheDocument();
    expect(screen.getByText('PR-104')).toBeInTheDocument();
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(screen.getByText('DW')).toBeInTheDocument();
    expect(screen.getAllByText(/100 days/)).toHaveLength(2);
    expect(screen.queryByText(/Paid this month/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\.00\b/)).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Procurement' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Procurement title \+ code/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Jul 19, 2026|19 Jul 2026/)).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByText('How it is calculated')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'How this figure is calculated' })).toHaveLength(2);
  });

  it('AC-1405-PAY-004: keeps search and export in the table card beside the table', () => {
    renderPage();

    const tableCard = screen.getByTestId('finance-payables-table-card');
    expect(tableCard).toContainElement(screen.getByRole('searchbox', { name: 'Search payables' }));
    expect(tableCard).toContainElement(screen.getByRole('button', { name: 'Export' }));
    expect(tableCard).toContainElement(screen.getByRole('table', { name: 'Supplier invoices waiting to be paid' }));
    expect(tableCard).not.toContainElement(screen.getByRole('region', { name: 'Payables figures' }));
  });

  it('AC-1405-PAY-002: row activation opens procurement and selection exports only the selected rows', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Open supplier invoice for Sinar Supplier/ }));
    expect(screen.getByRole('status', { name: 'Current path' })).toHaveTextContent('/procurement/procurement-1');
    cleanup();
    renderPage();
    await user.click(screen.getByRole('checkbox', { name: /Select supplier invoice/ }));
    await user.click(screen.getByRole('button', { name: 'Export selected' }));
    expect(state.exportXlsx).toHaveBeenCalledTimes(1);
    expect(state.exportXlsx.mock.calls[0][0]).toHaveLength(1);
  });

  it('AC-1405-PAY-003: Executive has read and export access without money actions', () => {
    renderPage('Executive');

    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Record payment|Edit|Cancel|Pay supplier/i })).not.toBeInTheDocument();
  });
});
