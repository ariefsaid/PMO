import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { buildManagementPack, type PackRow } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';

/**
 * Regression guard for the live Reports surface that replaced Revenue by Project.
 * These checks keep its honest-money, per-currency and tax-basis behavior tied to the
 * component users now open; client receivables remain in the Receivables workspace.
 */
const h = vi.hoisted(() => ({
  query: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown, refetch: vi.fn() },
  revenueQuery: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  exportTable: vi.fn(),
  revenueRows: [] as Array<Record<string, unknown>>,
  orgCurrency: { currency: 'IDR', isResolved: true, isError: false },
  capturedColumns: [] as Array<{ key: string; exportValue?: (row: PackRow) => unknown }>,
}));

vi.mock('@/src/components/ui', async (orig) => {
  const actual = await orig<typeof import('@/src/components/ui')>();
  return {
    ...actual,
    DataTable: (props: React.ComponentProps<typeof actual.DataTable>) => {
      h.capturedColumns = props.columns as Array<{ key: string; exportValue?: (row: unknown) => unknown }>;
      return <actual.DataTable {...props} />;
    },
  };
});

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
  useRevenuePerProject: () => h.revenueQuery,
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => h.orgCurrency }));
vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportTable: h.exportTable, exportXlsx: vi.fn(), busy: false }),
}));
vi.mock('@/src/components/reports/BoardPackAction', () => ({ BoardPackAction: () => null }));
vi.mock('@/src/components/reports/RecordProgressModal', () => ({ RecordProgressModal: () => null }));

import ManagementPack from '../ManagementPack';
import { BahasaProvider } from '../../test/bahasa';

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
  h.revenueQuery = {
    data: h.revenueRows,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
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
    expect(screen.getByRole('heading', { name: /^Projects as at/ })).toHaveTextContent('excl. tax');
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

  it('AC-1540-01: shows loading dash with accessible context and keeps amounts when revenue query is pending or disabled without data', () => {
    // 1. Pending without data
    h.revenueQuery = { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() };
    const { rerender } = renderPage();

    // Report amounts remain available
    const alphaRows = screen.getAllByRole('row').filter((row) => within(row).queryByText('Alpha'));
    expect(alphaRows).toHaveLength(2);
    expect(within(alphaRows[0]).getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/IDR\s?62,400,000/);

    // Each invoice count cell is unknown with accessible loading context; no false zero
    const invoiceCells = screen.getAllByTestId('pack-cell-invoices');
    expect(invoiceCells.length).toBeGreaterThan(0);
    for (const cell of invoiceCells) {
      expect(cell).toHaveTextContent('—');
      expect(within(cell).getByLabelText('Loading invoice counts')).toBeInTheDocument();
      expect(within(cell).queryByText('0')).not.toBeInTheDocument();
    }

    // Totals row also has loading dash with accessible context, not zero
    const totalsRow = screen.getAllByRole('row').find((r) => within(r).queryByText(/Total · IDR/));
    expect(totalsRow).toBeDefined();
    expect(within(totalsRow!).getByLabelText('Loading invoice counts')).toBeInTheDocument();
    expect(within(totalsRow!).queryByText('0')).not.toBeInTheDocument();

    // 2. Disabled-org pending at query-result boundary (isPending: true, data: undefined)
    h.revenueQuery = { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() };
    rerender(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);
    const disabledCells = screen.getAllByTestId('pack-cell-invoices');
    for (const cell of disabledCells) {
      expect(cell).toHaveTextContent('—');
      expect(within(cell).getByLabelText('Loading invoice counts')).toBeInTheDocument();
      expect(within(cell).queryByText('0')).not.toBeInTheDocument();
    }
  });

  it('AC-1540-02: shows unavailable on failed revenue query (even with cached data), offers scoped retry, and recovers on success', async () => {
    const revenueRefetch = vi.fn();
    // Failed revenue query, even with cached prior data
    h.revenueQuery = {
      data: h.revenueRows,
      isPending: false,
      isError: true,
      error: new Error('network failed'),
      refetch: revenueRefetch,
    };
    const { rerender } = renderPage();

    // Counts and totals explicitly say unavailable
    const invoiceCells = screen.getAllByTestId('pack-cell-invoices');
    expect(invoiceCells.length).toBeGreaterThan(0);
    for (const cell of invoiceCells) {
      expect(cell).toHaveTextContent('Unavailable');
    }
    const totalsRow = screen.getAllByRole('row').find((r) => within(r).queryByText(/Total · IDR/));
    expect(totalsRow).toBeDefined();
    expect(within(totalsRow!).getByText('Unavailable')).toBeInTheDocument();

    // Other columns remain intact
    const alphaRows = screen.getAllByRole('row').filter((row) => within(row).queryByText('Alpha'));
    expect(within(alphaRows[0]).getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/IDR\s?62,400,000/);

    // Accessible inline message and scoped retry button; no raw error message
    expect(screen.getByRole('status', { name: /unavailable/i })).toBeInTheDocument();
    expect(screen.queryByText(/network failed/i)).not.toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: 'Retry invoice counts' });
    expect(retryBtn).toBeInTheDocument();

    // Clicking retry calls revenue refetch only, not report refetch
    await userEvent.setup().click(retryBtn);
    expect(revenueRefetch).toHaveBeenCalledTimes(1);
    expect(h.query.refetch).not.toHaveBeenCalled();

    // Failed retry: still error
    h.revenueQuery = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('retry failed'),
      refetch: revenueRefetch,
    };
    rerender(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);
    expect(screen.getAllByTestId('pack-cell-invoices')[0]).toHaveTextContent('Unavailable');
    expect(screen.getByRole('button', { name: 'Retry invoice counts' })).toBeInTheDocument();

    // Recovery: simulate success on rerender
    // p1 has entries for IDR and USD; p2 has NO revenueRow so it represents an absent successful bucket
    h.revenueQuery = {
      data: [
        { project_id: 'p1', currency: 'IDR', total_amount: 62_400_000, open_ar: 5_000_000, invoice_count: 5 },
        { project_id: 'p1', currency: 'USD', total_amount: 1_250, open_ar: 80, invoice_count: 2 },
      ],
      isPending: false,
      isError: false,
      error: null,
      refetch: revenueRefetch,
    };
    rerender(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);

    // Scoped retry notice is gone
    expect(screen.queryByRole('button', { name: 'Retry invoice counts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /unavailable/i })).not.toBeInTheDocument();

    // Correct per-project/currency values and true zero for absent bucket (Beta / p2)
    const updatedAlpha = screen.getAllByRole('row').filter((row) => within(row).queryByText('Alpha'));
    expect(within(updatedAlpha[0]).getByTestId('pack-cell-invoices')).toHaveTextContent('5');
    expect(within(updatedAlpha[1]).getByTestId('pack-cell-invoices')).toHaveTextContent('2');

    const betaRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Beta'));
    expect(betaRow).toBeDefined();
    // Beta row has absent bucket in successful result -> true zero!
    expect(within(betaRow!).getByTestId('pack-cell-invoices')).toHaveTextContent('0');
  });

  it('AC-1540-03: toolbar and row-menu exports omit invoice count in pending, error, and success states; exportValue returns blank for unknown', async () => {
    const user = userEvent.setup();

    // 1. Pending revenue read
    h.revenueQuery = { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() };
    const { unmount: unmountPending } = renderPage();

    // Toolbar export
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(h.exportTable).toHaveBeenCalledTimes(1);
    const [toolbarTablePending] = h.exportTable.mock.calls[0];
    expect(toolbarTablePending.header).not.toContain('Invoices');
    expect(toolbarTablePending.header).not.toContain('Invoice count');
    for (const hItem of toolbarTablePending.header) {
      expect(String(hItem).toLowerCase()).not.toContain('invoice count');
    }
    h.exportTable.mockClear();

    // Row-menu export
    const alphaActions = screen.getAllByRole('button', { name: /Actions for Alpha/i });
    expect(alphaActions.length).toBeGreaterThan(0);
    await user.click(alphaActions[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Export row' }));
    expect(h.exportTable).toHaveBeenCalledTimes(1);
    const [rowTablePending] = h.exportTable.mock.calls[0];
    expect(rowTablePending.header).not.toContain('Invoices');
    expect(rowTablePending.header).not.toContain('Invoice count');
    h.exportTable.mockClear();
    unmountPending();

    // 2. Failed revenue read
    h.revenueQuery = { data: undefined, isPending: false, isError: true, error: new Error('net fail'), refetch: vi.fn() };
    const { unmount: unmountError } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(h.exportTable).toHaveBeenCalledTimes(1);
    const [toolbarTableError] = h.exportTable.mock.calls[0];
    expect(toolbarTableError.header).not.toContain('Invoices');
    expect(toolbarTableError.header).not.toContain('Invoice count');
    h.exportTable.mockClear();

    const alphaActionsError = screen.getAllByRole('button', { name: /Actions for Alpha/i });
    await user.click(alphaActionsError[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Export row' }));
    expect(h.exportTable).toHaveBeenCalledTimes(1);
    const [rowTableError] = h.exportTable.mock.calls[0];
    expect(rowTableError.header).not.toContain('Invoices');
    h.exportTable.mockClear();
    unmountError();

    // 3. Successful revenue read
    h.revenueQuery = { data: h.revenueRows, isPending: false, isError: false, error: null, refetch: vi.fn() };
    const { unmount: unmountSuccess } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(h.exportTable).toHaveBeenCalledTimes(1);
    const [toolbarTableSuccess] = h.exportTable.mock.calls[0];
    expect(toolbarTableSuccess.header).not.toContain('Invoices');
    h.exportTable.mockClear();

    const alphaActionsSuccess = screen.getAllByRole('button', { name: /Actions for Alpha/i });
    await user.click(alphaActionsSuccess[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Export row' }));
    expect(h.exportTable).toHaveBeenCalledTimes(1);
    const [rowTableSuccess] = h.exportTable.mock.calls[0];
    expect(rowTableSuccess.header).not.toContain('Invoices');
    h.exportTable.mockClear();
    unmountSuccess();

    // 4. Exercised via captured column props
    const sampleRow: PackRow = {
      key: 'p1|IDR',
      kind: 'contract',
      projectId: 'p1',
      projectName: 'Alpha',
      projectNumber: null,
      clientName: null,
      projectManagerId: null,
      projectStatus: 'Ongoing Project',
      currency: 'IDR',
      contractNet: null,
      latestProgress: null,
      months: [],
    };
    const unmatchedRow: PackRow = {
      ...sampleRow,
      key: 'p-unknown|IDR',
      projectId: 'p-unknown',
    };

    h.revenueQuery = { data: h.revenueRows, isPending: false, isError: false, error: null, refetch: vi.fn() };
    const { unmount: unmountColSuccess } = renderPage();
    const invoiceColSuccess = h.capturedColumns.find((c) => c.key === 'invoiceCount');
    expect(invoiceColSuccess).toBeDefined();
    expect(invoiceColSuccess?.exportValue?.(sampleRow)).toBe(1);
    expect(invoiceColSuccess?.exportValue?.(unmatchedRow)).toBe(0);
    unmountColSuccess();

    // In error state, exportValue returns ''
    h.revenueQuery = { data: undefined, isPending: false, isError: true, error: new Error('net err'), refetch: vi.fn() };
    const { unmount: unmountColErr } = renderPage();
    const invoiceColError = h.capturedColumns.find((c) => c.key === 'invoiceCount');
    expect(invoiceColError?.exportValue?.(sampleRow)).toBe('');
    unmountColErr();

    // In pending state, exportValue returns ''
    h.revenueQuery = { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() };
    const { unmount: unmountColPend } = renderPage();
    const invoiceColPending = h.capturedColumns.find((c) => c.key === 'invoiceCount');
    expect(invoiceColPending?.exportValue?.(sampleRow)).toBe('');
    unmountColPend();
  });

  it('AC-1540-04: report read and revenue read errors are isolated; retry triggers only the relevant refetch; no raw network errors shown', async () => {
    const reportRefetch = vi.fn();
    const revenueRefetch = vi.fn();
    const user = userEvent.setup();

    // Scenario A: Report read fails independently
    h.query = { data: undefined, isPending: false, isError: true, error: new Error('net::ERR_TIMED_OUT'), refetch: reportRefetch };
    h.revenueQuery = { data: h.revenueRows, isPending: false, isError: false, error: null, refetch: revenueRefetch };
    const { unmount: unmountA } = renderPage();

    expect(screen.getByText("Couldn't load Reports")).toBeInTheDocument();
    expect(screen.queryByText(/net::ERR_TIMED_OUT/)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/^pack-cell-/)).toHaveLength(0);

    const reportRetry = screen.getByRole('button', { name: 'Retry' });
    await user.click(reportRetry);
    expect(reportRefetch).toHaveBeenCalledTimes(1);
    expect(revenueRefetch).not.toHaveBeenCalled();
    unmountA();

    // Scenario B: Revenue read fails independently
    h.query = { data: buildManagementPack(facts), isPending: false, isError: false, error: null, refetch: reportRefetch };
    h.revenueQuery = { data: undefined, isPending: false, isError: true, error: new Error('revenue::ERR_FAILED'), refetch: revenueRefetch };
    reportRefetch.mockClear();
    revenueRefetch.mockClear();
    const { unmount: unmountB } = renderPage();

    // Pack data and report-only flow stay intact
    expect(screen.queryByText("Couldn't load Reports")).not.toBeInTheDocument();
    expect(screen.queryByText(/revenue::ERR_FAILED/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('pack-cell-contract').length).toBeGreaterThan(0);

    // Scoped invoice retry button only invokes revenue refetch
    const invoiceRetry = screen.getByRole('button', { name: 'Retry invoice counts' });
    await user.click(invoiceRetry);
    expect(revenueRefetch).toHaveBeenCalledTimes(1);
    expect(reportRefetch).not.toHaveBeenCalled();
    unmountB();
  });

  it('AC-1540-05: verifies Bahasa translations for unavailable, loading, and retry states', async () => {
    const revenueRefetch = vi.fn();
    const user = userEvent.setup();

    // Failed revenue read in Bahasa
    h.revenueQuery = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('gagal'),
      refetch: revenueRefetch,
    };

    const { rerender } = render(
      <BahasaProvider>
        <MemoryRouter>
          <ToastProvider>
            <ManagementPack />
          </ToastProvider>
        </MemoryRouter>
      </BahasaProvider>,
    );

    // Count cells and total show "Jumlah faktur tidak tersedia"
    const cells = screen.getAllByTestId('pack-cell-invoices');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell).toHaveTextContent('Jumlah faktur tidak tersedia');
    }
    const totalsRow = screen.getAllByRole('row').find((r) => within(r).queryByText(/Total · IDR/));
    expect(totalsRow).toBeDefined();
    expect(within(totalsRow!).getByText('Jumlah faktur tidak tersedia')).toBeInTheDocument();

    // Inline status and retry button in Bahasa
    expect(screen.getByRole('status', { name: 'Jumlah faktur tidak tersedia' })).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: 'Coba lagi jumlah faktur' });
    expect(retryBtn).toBeInTheDocument();
    await user.click(retryBtn);
    expect(revenueRefetch).toHaveBeenCalledTimes(1);

    // Pending revenue read in Bahasa
    h.revenueQuery = {
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      refetch: revenueRefetch,
    };
    rerender(
      <BahasaProvider>
        <MemoryRouter>
          <ToastProvider>
            <ManagementPack />
          </ToastProvider>
        </MemoryRouter>
      </BahasaProvider>,
    );

    const pendingCells = screen.getAllByTestId('pack-cell-invoices');
    for (const cell of pendingCells) {
      expect(cell).toHaveTextContent('—');
      expect(within(cell).getByLabelText('Memuat jumlah faktur')).toBeInTheDocument();
    }
    const pendingTotal = screen.getAllByRole('row').find((r) => within(r).queryByText(/Total · IDR/));
    expect(within(pendingTotal!).getByLabelText('Memuat jumlah faktur')).toBeInTheDocument();
  });
});
