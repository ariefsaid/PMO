import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancePosition } from '@/src/lib/finance/financePosition';

const state = vi.hoisted(() => ({
  role: 'Finance',
  position: null as FinancePosition | null,
  financePending: false,
  financeError: false,
  payablesPending: false,
  payablesError: false,
  orgDayPending: false,
  orgDayError: false,
  exportXlsx: vi.fn(),
  erpDocuments: [] as unknown[],
  refetchProcurements: vi.fn(),
  refetchErp: vi.fn(),
  retryOrgDay: vi.fn(),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => entity === 'finance' && action === 'view',
}));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({ position: state.position, isPending: state.financePending, isError: state.financeError, retry: vi.fn() }),
}));
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
    refetch: state.refetchProcurements,
  }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({
    day: state.orgDayPending || state.orgDayError ? null : '2026-07-19',
    isPending: state.orgDayPending,
    isError: state.orgDayError,
    retry: state.retryOrgDay,
  }),
}));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: state.erpDocuments, isPending: state.payablesPending, isError: state.payablesError, refetch: state.refetchErp }),
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

function Location() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

function renderPage(role = 'Finance', position: FinancePosition = payablesFixture()) {
  state.role = role;
  state.position = position;
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
  state.financePending = false;
  state.financeError = false;
  state.payablesPending = false;
  state.payablesError = false;
  state.orgDayPending = false;
  state.orgDayError = false;
  state.erpDocuments = [];
  state.exportXlsx.mockClear();
  state.refetchProcurements.mockClear();
  state.refetchErp.mockClear();
  state.retryOrgDay.mockClear();
});

afterEach(() => {
  cleanup();
  state.role = 'Finance';
});

describe('Payables page', () => {
  it('B5: renders payable figures while an unrelated finance position read is pending', () => {
    state.financePending = true;
    renderPage();

    expect(screen.getByText('IDR 62.4M')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Supplier invoices waiting to be paid' })).toBeInTheDocument();
  });

  it('B5: shows the payable error when a payable source fails without reporting zero', () => {
    state.payablesError = true;
    renderPage();

    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes("Couldn't load supplier invoices"))).toBe(true);
    expect(screen.queryByText(/IDR 62\.4M/)).not.toBeInTheDocument();
    expect(screen.queryByText(/IDR\s*0\b/)).not.toBeInTheDocument();
  });

  it('retries procurement and accounting-system reads from the payable error', async () => {
    state.payablesError = true;
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);

    expect(state.refetchProcurements).toHaveBeenCalledTimes(1);
    expect(state.refetchErp).toHaveBeenCalledTimes(1);
  });

  it('B5: shows the balance and table while organization-day ageing is pending', () => {
    state.orgDayPending = true;
    renderPage();

    expect(screen.getByText('IDR 62.4M')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Sinar Supplier/ })).toHaveTextContent('62,400,000');
    expect(within(screen.getByRole('region', { name: 'Invoice age, by days' })).getByTestId('liststate-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('100 days')).not.toBeInTheDocument();
  });

  it('B5: shows an ageing error while balance and table figures remain available', () => {
    state.orgDayError = true;
    renderPage();

    expect(screen.getByText('IDR 62.4M')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Sinar Supplier/ })).toHaveTextContent('62,400,000');
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes("Couldn't load balance ageings"))).toBe(true);
    expect(screen.queryByText('100 days')).not.toBeInTheDocument();
  });

  it('retries organization-day age data from the ageing error', async () => {
    state.orgDayError = true;
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(state.retryOrgDay).toHaveBeenCalledTimes(1);
  });

  it('B5: shows its loading state while the linked purchase read is pending', () => {
    state.payablesPending = true;
    renderPage();

    expect(screen.getByRole('heading', { name: 'Payables', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search payables' })).toBeInTheDocument();
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(1);
    expect(screen.getByText('100 days')).toBeInTheDocument();
    expect(screen.queryByText(/IDR\s*0\b/)).not.toBeInTheDocument();
  });

  it('keeps Export disabled while the payable read is pending or failed', () => {
    state.payablesPending = true;
    renderPage();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();

    cleanup();
    state.payablesPending = false;
    state.payablesError = true;
    renderPage();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('does not surface unrelated receivable errors as a payables table error', () => {
    state.financeError = true;
    renderPage();

    expect(screen.getByRole('row', { name: /Sinar Supplier/ })).toBeInTheDocument();
  });

  it('shows the age and overdue count for every invoice over 90 days', () => {
    const base = payablesFixture();
    const next = {
      ...base.payables[0],
      procurement: { ...base.payables[0].procurement, id: 'procurement-next', title: 'Inspection follow-up', code: 'PR-105' },
      ageDays: 95,
    } as FinancePosition['payables'][number];
    renderPage('Finance', { ...base, payables: [next, base.payables[0]] });

    const lateAges = screen.getAllByTestId('payables-late-age');
    expect(lateAges).toHaveLength(2);
    expect(screen.getByTestId('payables-overdue-count')).toHaveTextContent('2 overdue');
    expect(screen.getByRole('heading', { name: 'Invoice age' })).toBeVisible();
    expect(lateAges.map((row) => row.textContent)).toEqual(['100 days', '95 days']);
  });

  it('AC-1405-PAY-001: shows one shared to-pay total, ageing and supplier/project context', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Payables', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText(/62,400,000/).length).toBeGreaterThan(0);
    expect(screen.getByText('Sinar Supplier')).toBeInTheDocument();
    expect(screen.getByText('PR-104')).toBeInTheDocument();
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(screen.getByText('DW')).toBeInTheDocument();
    expect(screen.getAllByText(/100 days/)).toHaveLength(2);
    expect(screen.getByText('Oldest invoice age')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Invoice age, by days/ })).toBeInTheDocument();
    expect(screen.queryByText(/Paid this month/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\.00\b/)).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Procurement' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Procurement title \+ code/ })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Invoice age' })).toBeInTheDocument();
    expect(screen.queryByText(/19 Jul/)).not.toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByText('How it is calculated')).not.toBeInTheDocument();
    // One help control for the page; no per-figure "?".
    expect(screen.queryAllByRole('button', { name: 'How this figure is calculated' })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /About Payables/ })).toHaveLength(1);
  });

  it('opens the page help with the invoice-age basis and tile definition', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'About Payables' }));
    expect(screen.getByText('Invoice age is counted from the supplier invoice date.')).toBeInTheDocument();
    expect(screen.getByText(/Unpaid supplier invoice balances/)).toBeInTheDocument();
  });

  it('F11: the to-pay figure is short with its exact amount kept, while the table total stays full', () => {
    renderPage();
    const figures = screen.getByRole('region', { name: 'Payables figures' });
    expect(within(figures).getByText('IDR 62.4M').getAttribute('title')).toMatch(/^IDR\s62,400,000$/);
    expect(within(screen.getByRole('table', { name: 'Supplier invoices waiting to be paid' })).getAllByText(/62,400,000/).length).toBeGreaterThan(0);
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

  it('selects every visible row for Export selected', async () => {
    const base = payablesFixture();
    const second = {
      ...base.payables[0],
      procurement: { ...base.payables[0].procurement, id: 'procurement-2', title: 'Crane rental', code: 'PR-105', vendor: { name: 'Bumi Rental' }, vendor_id: 'supplier-2' },
      ageDays: 75,
      amount: 2_000_000,
    } as FinancePosition['payables'][number];
    const user = userEvent.setup();
    renderPage('Finance', { ...base, payables: [base.payables[0], second] });

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    await user.click(screen.getByRole('button', { name: 'Export selected' }));

    expect(state.exportXlsx).toHaveBeenCalledTimes(1);
    expect(state.exportXlsx.mock.calls[0][0]).toHaveLength(2);
  });

  it('opens the supplier from a row action menu', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Open supplier' }));

    expect(screen.getByText('SUPPLIER RECORD')).toBeInTheDocument();
  });

  it('opens procurement from a row action menu', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Open procurement' }));

    expect(screen.getByRole('status', { name: 'Current path' })).toHaveTextContent('/procurement/procurement-1');
  });

  it('AC-1405-PAY-003: Executive has read and export access without money actions', () => {
    renderPage('Executive');

    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Record payment|Edit|Cancel|Pay supplier/i })).not.toBeInTheDocument();
  });

  it('uses the supplier invoice empty state when no procurement is awaiting payment (ported from PayablesList)', () => {
    renderPage('Finance', { ...payablesFixture(), payables: [], payablesTotals: {}, payablesAgeing: {} });

    expect(screen.getByText('No supplier invoices waiting to be paid.')).toBeInTheDocument();
    expect(screen.getByText('To pay suppliers').parentElement?.parentElement).toHaveTextContent(/IDR\s*0/);
    expect(screen.queryByRole('button', { name: /Open supplier invoice for/ })).not.toBeInTheDocument();
  });

  it('SEC-RS-2 / C4: an unknown supplier balance is left out of its row and the total, counted, and explained once', () => {
    const base = payablesFixture();
    const unknownRow = {
      ...base.payables[0],
      procurement: { ...base.payables[0].procurement, id: 'procurement-2', title: 'Crane hire', code: 'PR-105', vendor: { name: 'Bumi Rental' }, vendor_id: 'supplier-2' },
      ageDays: 12,
      amount: null,
    } as FinancePosition['payables'][number];
    renderPage('Finance', { ...base, payables: [base.payables[0], unknownRow], payablesUnknownCount: 1 });

    const row = screen.getByRole('row', { name: /Bumi Rental/ });
    expect(row).not.toHaveTextContent(/IDR\s?0\b|Rp\s?0\b/);
    expect(row).not.toHaveTextContent('—');
    expect(screen.getAllByText(/1 invoice has no amount and is left out of the total/)).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: /Invoice age, by days/ })).getByTestId('ageing-bucket-IDR-d0_30')).toHaveTextContent('1 balance unknown');
  });

  it('counts only known suppliers and names invoices with an unknown supplier', () => {
    const base = payablesFixture();
    const unknownSupplier = {
      ...base.payables[0],
      procurement: { ...base.payables[0].procurement, id: 'procurement-unknown-vendor', vendor: null, vendor_id: null },
      ageDays: null,
    } as FinancePosition['payables'][number];
    renderPage('Finance', { ...base, payables: [unknownSupplier] });

    const figures = screen.getByRole('region', { name: 'Payables figures' });
    expect(within(figures).getByText('1 invoice, supplier not recorded')).toBeInTheDocument();
    expect(within(figures).queryByText(/0 suppliers?/)).not.toBeInTheDocument();
  });

  it('L12(a): a supplier invoice kept in the accounting system shows the amount the procurement record shows', () => {
    const base = payablesFixture();
    const erpRow = {
      ...base.payables[0],
      procurement: { ...base.payables[0].procurement, id: 'procurement-erp', title: 'Inverter replacement, block B', code: 'RS1404-001', vendor: { name: 'SunVolt Modules' }, vendor_id: 'supplier-3', currency: 'USD', purchase_requests: [], purchase_orders: [], procurement_invoices: [], payments: [] },
      ageDays: 27,
      amount: null,
    } as FinancePosition['payables'][number];
    state.erpDocuments = [{ id: 'doc-1', doctype: 'Purchase Invoice', name: 'ACC-PINV-1', procurementId: 'procurement-erp', grandTotal: 62_000, outstanding: 62_000, currency: 'USD' }];
    renderPage('Finance', { ...base, payables: [base.payables[0], erpRow], payablesUnknownCount: 1 });

    expect(within(screen.getByRole('row', { name: /SunVolt Modules/ })).getByText('$62,000')).toBeInTheDocument();
    expect(screen.queryByText(/balances? unknown/)).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Total · USD/ })).toHaveTextContent('$62,000');
  });

  it('L12(b): ageing places each invoice by its real age; an old invoice with an unknown balance is counted over 90 days, not in 0–30', () => {
    const base = payablesFixture();
    const old = { ...base.payables[0], procurement: { ...base.payables[0].procurement, id: 'procurement-old', vendor: { name: 'Old Supplier' } }, ageDays: 101, amount: null } as FinancePosition['payables'][number];
    const recent = { ...base.payables[0], ageDays: 15 };
    renderPage('Finance', {
      ...base,
      payables: [old, recent],
      payablesUnknownCount: 1,
      payablesAgeing: { IDR: { d0_30: 6_240_000_000, d31_60: 0, d61_90: 0, over90: 0 } },
    });

    const ageing = screen.getByRole('region', { name: /Invoice age, by days/ });
    expect(within(ageing).getByTestId('ageing-bucket-IDR-over90')).toHaveTextContent('1 balance unknown');
    expect(within(ageing).getByTestId('ageing-bucket-IDR-over90')).not.toHaveTextContent(/IDR\s?0\b/);
    expect(within(ageing).getByTestId('ageing-bucket-IDR-d0_30')).not.toHaveTextContent(/unknown/);
    expect(screen.getByRole('region', { name: 'Payables figures' })).toHaveTextContent('101 days');
  });
});
