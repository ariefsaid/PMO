import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancePosition } from '@/src/lib/finance/financePosition';

/**
 * R2 (ux/1110): the payables search box is URL-owned (`?q=`) so a search survives opening a
 * procurement record and pressing Back, or a plain refresh.
 */

const state = vi.hoisted(() => ({
  position: null as FinancePosition | null,
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => entity === 'finance' && action === 'view',
}));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({ position: state.position, isPending: false, isError: false, retry: vi.fn() }),
}));
// The page reads procurements and the org day directly since the regions load on their own reads (r2-gates-c).
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({
    data: state.position?.payables.map(({ procurement, ageDays, amount }) => ({
      ...procurement,
      procurement_invoices: procurement.procurement_invoices?.length === 0 && amount === null ? [] : [{
        invoice_date: ageDays === null ? null : new Date(Date.parse(`2026-07-19T00:00:00Z`) - ageDays * 86_400_000).toISOString().slice(0, 10),
        amount: amount === null ? null : (amount / 100),
        erp_outstanding_amount: amount === null ? null : (amount / 100),
      }],
    })) ?? [],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-07-19', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isPending: false, isError: false }),
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
  useExport: () => ({ exportXlsx: vi.fn(), busy: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));

import PayablesPage from './PayablesPage';

function payablesFixture(): FinancePosition {
  return {
    receivablesCount: 0, receivablesUnknownCount: 0,
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
        procurement_invoices: [{ invoice_date: '2026-04-10', amount: 62_400_000, erp_outstanding_amount: 62_400_000 }],
        project_id: 'project-1',
        project: { name: 'North project', short_name: 'North', code: 'PRJ-10', pmo_project_number: null },
      } as FinancePosition['payables'][number]['procurement'],
      ageDays: 100,
      amount: 6_240_000_000,
    }],
    payablesTotals: { IDR: 6_240_000_000 },
    payablesUnknownCount: 0,
    receivablesAgeing: {},
    payablesAgeing: { IDR: { d0_30: 0, d31_60: 0, d61_90: 0, over90: 6_240_000_000 } },
  };
}

function LocationProbe() {
  return <div data-testid="location-probe" data-search={useLocation().search} />;
}

function ReturnToPayables() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Back to Payables</button>;
}

function renderPage(initialEntry = '/finance/payables') {
  state.position = payablesFixture();
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/finance/payables" element={<PayablesPage />} />
        <Route path="/procurement/:id" element={<ReturnToPayables />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.position = payablesFixture();
});

afterEach(() => {
  cleanup();
});

describe('R2 — payables search lives in the URL', () => {
  it('opens with the search box showing ?q= and the list narrowed to the matches', () => {
    renderPage('/finance/payables?q=inspection');
    const search = screen.getByRole('searchbox', { name: 'Search payables' }) as HTMLInputElement;
    expect(search).toHaveValue('inspection');
    // The seeded procurement matches "inspection" by title.
    expect(screen.getByText('Equipment inspection')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?q=inspection');
  });

  it('typing in the search box writes the query into the URL', () => {
    renderPage('/finance/payables');
    const search = screen.getByRole('searchbox', { name: 'Search payables' });
    fireEvent.change(search, { target: { value: 'sinar' } });
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?q=sinar');
  });

  it('keeps the URL search when opening procurement and returning with Back', async () => {
    const user = userEvent.setup();
    renderPage('/finance/payables?q=inspection');

    await user.click(screen.getByRole('button', { name: 'Open supplier invoice for Sinar Supplier' }));
    expect(screen.getByRole('button', { name: 'Back to Payables' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to Payables' }));

    expect(screen.getByRole('searchbox', { name: 'Search payables' })).toHaveValue('inspection');
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?q=inspection');
  });
});
