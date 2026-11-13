import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * Floor tests for the embedded receivables invoice list (floor-tests/receivables.md) and the
 * sales invoices list (floor-tests/sales-invoices-list.md). Real page, mocked repository seam:
 * every money transition is asserted on the mutation call, never a real write.
 */
const h = vi.hoisted(() => ({
  submitMutate: vi.fn(async () => undefined),
  cancelMutate: vi.fn(async () => undefined),
  setReceivedDateMutate: vi.fn(async () => undefined),
  setEfakturMutate: vi.fn(async () => undefined),
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  payments: [] as unknown[],
  route: 'pmo' as 'pmo' | 'external',
  ownershipLoaded: true,
  userId: 'u-fin2',
  role: 'Finance' as 'Finance' | 'Project Manager' | 'Executive',
  toast: vi.fn(),
  exportedRows: [] as unknown[],
  projects: [] as unknown[],
  profiles: [] as unknown[],
}));
vi.mock('@/src/components/export', async () => {
  const React = await import('react');
  return {
    ExportButton: ({ rows, label = 'Export' }: { rows: unknown[]; label?: string }) => React.createElement('button', {
      type: 'button',
      onClick: () => { h.exportedRows = rows; },
    }, label),
    withCurrencyColumn: <Row,>(columns: Row[]) => columns,
  };
});
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: async () => [] }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'IDR',
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-12', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useFxRates', () => ({ useFxRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoiceEvidence: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: h.payments, isPending: false, isError: false }),
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSalesInvoices: () => h.invoices,
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: h.submitMutate, isPending: false },
    cancelInvoice: { mutateAsync: h.cancelMutate, isPending: false },
    setReceivedDate: { mutateAsync: h.setReceivedDateMutate, isPending: false },
    setEfaktur: { mutateAsync: h.setEfakturMutate, isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }, { value: 'cust-2', label: 'Borealis Marine', sub: 'Client' }] }),
  useInvoiceProjectOptions: () => ({ data: [
    { value: 'proj-1', label: 'Alpha Platform', contractualName: 'Alpha Platform', sub: 'ALP-01', clientId: 'cust-1', subjectToVat: true, taxRate: 12, archived: false },
    { value: 'proj-2', label: 'Beta Norates', contractualName: 'Beta Norates', sub: 'BNR-01', clientId: 'cust-1', subjectToVat: true, taxRate: null, archived: false },
    { value: 'proj-3', label: 'Gamma Other Client', sub: 'GOC-01', clientId: 'cust-2', subjectToVat: false, taxRate: null, archived: false },
  ] }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: h.projects, isPending: false }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: h.profiles, isPending: false }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => h.route) }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({
  data: !h.ownershipLoaded ? undefined : h.route === 'external' ? [{ id: 'o-1', orgId: 'org-1', externalTier: 'erpnext', domain: 'revenue' }] : [],
  isError: false,
}) }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...real, useToast: () => ({ toast: h.toast }) };
});

import SalesInvoices from '../SalesInvoices';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';

const nativeInvoice = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'si-n1', org_id: 'org-1', project_id: 'proj-1', customer_id: 'cust-1', customer_name: 'Acme Energy',
  si_number: null, pmo_number: null, pmo_native: true, reference_number: null, invoice_date: null,
  amount: 1_000_000, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 110_000, tax_rate: 12,
  tax_base_numerator: 11, tax_base_denominator: 12, erp_outstanding_amount: null, status: 'Draft',
  erp_docstatus: null, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-07T00:00:00Z', author_user_id: 'u-fin1', author_user_ids: ['u-fin1'],
  native_lines: [{ item_code: 'SVC', description: 'Site survey', qty: 2, rate: 500_000, amount: 1_000_000 }],
  erp_payment_terms_days: null, erp_due_date: null, received_date: null, ...over,
}) as SalesInvoiceRow;

/** The one list row (table row or phone card) whose text matches — never "the first of several matches". */
function rowFor(text: string | RegExp): HTMLElement {
  const branch = screen.queryByTestId('dt-table-branch') ?? screen.getByTestId('dt-card-branch');
  const rows = within(branch).queryAllByRole('row').length > 0 ? within(branch).getAllByRole('row') : within(branch).getAllByRole('listitem');
  const hits = rows.filter((r) => (typeof text === 'string' ? r.textContent?.includes(text) : text.test(r.textContent ?? '')));
  expect(hits, `row target ${text}`).toHaveLength(1);
  return hits[0];
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  await user.click(within(row).getByRole('button', { name: 'Row actions' }));
}

// The page's PDF hook (#912) reads the query cache — one client per test, kept across rerenders.
let queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
beforeEach(() => { queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mockPhoneViewport() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: !query.includes('min-width: 768px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

const page = (initialEntry = '/sales-invoices', embedded = false) => (
  <QueryClientProvider client={queryClient}>
  <FinanceI18nTestProvider>
    <ImpersonationProvider realRole={h.role}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <Routes>
            <Route path="/sales-invoices" element={<SalesInvoices embedded={embedded} />} />
            <Route path="/sales-invoices/:invoiceId" element={<SalesInvoices embedded={embedded} />} />
            <Route path="/finance/receivables" element={<SalesInvoices embedded={embedded} />} />
          </Routes>
          <LocationProbe />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>
  </QueryClientProvider>
);
const renderPage = (initialEntry?: string, embedded = false) => render(page(initialEntry, embedded));

beforeEach(async () => {
  h.submitMutate.mockClear();
  h.cancelMutate.mockReset().mockResolvedValue(undefined);
  h.setReceivedDateMutate.mockReset().mockResolvedValue(undefined);
  h.setEfakturMutate.mockReset().mockResolvedValue(undefined);
  h.invoices.data = [];
  h.invoices.isError = false;
  h.payments = [];
  h.route = 'pmo';
  h.ownershipLoaded = true;
  h.userId = 'u-fin2';
  h.role = 'Finance';
  h.projects = [];
  h.profiles = [];
  h.toast.mockClear();
  h.exportedRows = [];
  await financeTestI18n.changeLanguage('en');
});

describe('Sales invoices — floor (receivables)', () => {
  it('floor: Group by Project then None regroups the rows and clears the URL (floor-tests/receivables.md 12)', async () => {
    h.invoices.data = [
      nativeInvoice({ id: 'si-a', pmo_number: 'INV-A', status: 'Unpaid', erp_outstanding_amount: 600_000 }),
      nativeInvoice({ id: 'si-b', pmo_number: 'INV-B', project_id: 'proj-2', status: 'Unpaid', erp_outstanding_amount: 400_000 }),
    ];
    const user = userEvent.setup();
    renderPage('/finance/receivables?view=invoices', true);

    await user.click(screen.getByRole('tab', { name: 'Project' }));
    expect(screen.getByTestId('location')).toHaveTextContent('group=project');
    expect(screen.getByRole('button', { name: /Alpha Platform\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Beta Norates\s*1/ })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'None' }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('group=');
    expect(screen.queryByRole('button', { name: /Alpha Platform\s*\d/ })).not.toBeInTheDocument();
    expect(rowFor('INV-A')).toBeInTheDocument();
    expect(rowFor('INV-B')).toBeInTheDocument();
  });

  it('floor: the drawer Open full page opens the record route with the list query (floor-tests/receivables.md 16, sales-invoices-list.md 23)', async () => {
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 1_110_000, invoice_date: '2026-10-01', erp_payment_terms_days: 14 })];
    const user = userEvent.setup();
    renderPage('/finance/receivables?status=Unpaid', true);
    await user.click(screen.getByRole('button', { name: 'Open INV-2610070001' }));
    const drawer = await screen.findByRole('dialog');

    await user.click(within(drawer).getByRole('button', { name: 'Open full page' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/sales-invoices/si-n1?status=Unpaid');
  });

  it('floor: accepting the cancel confirmation gives cancelInvoice this invoice id (floor-tests/receivables.md 21, sales-invoices-list.md 15)', async () => {
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 610_000 })];
    const user = userEvent.setup();
    renderPage('/finance/receivables?view=invoices', true);

    await openMenu(user, rowFor('INV-2610070001'));
    await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(h.cancelMutate).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel invoice' }));

    expect(h.cancelMutate).toHaveBeenCalledWith(expect.objectContaining({
      siId: 'si-n1', intent: expect.objectContaining({ id: expect.any(String) }),
    }));
  });

  it('floor: the header select-all selects every visible invoice row (floor-tests/receivables.md 24)', async () => {
    h.invoices.data = [
      nativeInvoice({ id: 'si-a', pmo_number: 'INV-A', status: 'Unpaid', erp_outstanding_amount: 600_000 }),
      nativeInvoice({ id: 'si-b', pmo_number: 'INV-B', customer_name: 'Borealis Marine', status: 'Unpaid', erp_outstanding_amount: 400_000 }),
    ];
    const user = userEvent.setup();
    renderPage('/finance/receivables?view=invoices', true);

    await user.click(screen.getByRole('checkbox', { name: 'Select INV-A' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }));

    expect(screen.getByRole('checkbox', { name: 'Select INV-A' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select INV-B' })).toBeChecked();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('floor: Export exports exactly the rows matching the active filters (floor-tests/receivables.md 25, sales-invoices-list.md 17)', async () => {
    h.invoices.data = [
      nativeInvoice({ id: 'si-a', pmo_number: 'INV-A', status: 'Unpaid', erp_outstanding_amount: 1_110_000 }),
      nativeInvoice({ id: 'si-b', pmo_number: 'INV-B', customer_name: 'Borealis Marine', status: 'Paid', erp_outstanding_amount: 0 }),
      nativeInvoice({ id: 'si-c', pmo_number: 'INV-C', status: 'Draft' }),
    ];
    const user = userEvent.setup();
    renderPage('/finance/receivables?view=invoices', true);

    await user.click(screen.getByRole('tab', { name: 'Unpaid' }));
    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect((h.exportedRows as SalesInvoiceRow[]).map((row) => row.id)).toEqual(['si-a']);
  });

  it('floor: Clear empties the invoice selection and closes the bulk bar (floor-tests/receivables.md 26, sales-invoices-list.md 16)', async () => {
    h.invoices.data = [
      nativeInvoice({ id: 'si-a', pmo_number: 'INV-A', status: 'Unpaid', erp_outstanding_amount: 600_000 }),
      nativeInvoice({ id: 'si-b', pmo_number: 'INV-B', customer_name: 'Borealis Marine', status: 'Unpaid', erp_outstanding_amount: 400_000 }),
    ];
    const user = userEvent.setup();
    renderPage('/finance/receivables?view=invoices', true);

    await user.click(screen.getByRole('checkbox', { name: 'Select INV-A' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByRole('checkbox', { name: 'Select INV-A' })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Export selected' })).not.toBeInTheDocument();
  });
});

describe('Sales invoices — floor (sales-invoices-list)', () => {
  it('floor: a failed list read offers Retry and refetches (floor-tests/sales-invoices-list.md 18)', async () => {
    h.invoices.isError = true;
    h.invoices.data = undefined;
    const user = userEvent.setup();
    renderPage('/sales-invoices');

    const alert = screen.getAllByRole('alert').find((el) => el.textContent?.includes("Couldn't load sales invoices"));
    expect(alert).toBeDefined();
    await user.click(within(alert!).getByRole('button', { name: 'Retry' }));

    expect(h.invoices.refetch).toHaveBeenCalledTimes(1);
  });

  it("floor: a zero-match search's Clear all restores the rows (floor-tests/sales-invoices-list.md 18)", async () => {
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-A', erp_outstanding_amount: 1_110_000 })];
    const user = userEvent.setup();
    renderPage('/sales-invoices?q=zzz-no-match');
    expect(screen.getByText('No invoices match your filters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(screen.getByRole('table').textContent).toContain('INV-A');
  });

  it('floor: on a phone Overdue only and Group by drive the URL and the rows (floor-tests/sales-invoices-list.md 21)', async () => {
    mockPhoneViewport();
    h.invoices.data = [
      nativeInvoice({ id: 'si-a', pmo_number: 'INV-A', status: 'Unpaid', invoice_date: '2026-05-31', erp_payment_terms_days: 30, erp_outstanding_amount: 1_110_000 }),
      nativeInvoice({ id: 'si-b', pmo_number: 'INV-B', status: 'Unpaid', invoice_date: '2026-10-01', erp_payment_terms_days: 19, erp_outstanding_amount: 1_110_000 }),
    ];
    const user = userEvent.setup();
    renderPage('/finance/receivables?view=invoices', true);

    await user.click(screen.getByRole('button', { name: 'Overdue only' }));
    expect(screen.getByTestId('location')).toHaveTextContent('overdue=true');
    expect(rowFor('INV-A')).toBeInTheDocument();
    expect(screen.queryByText(/INV-B/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Client' }));
    expect(screen.getByTestId('location')).toHaveTextContent('group=client');
  });

  it("floor: the drawer's Record delivery primary saves this invoice's delivery date (floor-tests/sales-invoices-list.md 22)", async () => {
    h.invoices.data = [nativeInvoice({ status: 'Submitted', pmo_number: 'INV-2610070001', erp_outstanding_amount: 1_110_000 })];
    const user = userEvent.setup();
    renderPage('/finance/receivables?view=invoices&open=si-n1', true);
    const drawer = await screen.findByRole('dialog');

    await user.click(within(drawer).getByRole('button', { name: 'Record delivery' }));
    const modal = await screen.findByRole('dialog', { name: 'Record delivery date' });
    await user.type(within(modal).getByLabelText('Delivered'), '2026-10-11');
    await user.click(within(modal).getByRole('button', { name: 'Save' }));

    expect(h.setReceivedDateMutate).toHaveBeenCalledWith({ siId: 'si-n1', receivedDate: '2026-10-11' });
  });

  it('floor: the drawer Invoice actions menu records an e-Faktur for this invoice (floor-tests/sales-invoices-list.md 24)', async () => {
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 1_110_000, project_subject_to_vat: true })];
    const user = userEvent.setup();
    renderPage('/finance/receivables?view=invoices&open=si-n1', true);
    const drawer = await screen.findByRole('dialog');

    await user.click(within(drawer).getByRole('button', { name: 'Invoice actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Record e-Faktur' }));
    const modal = await screen.findByRole('dialog', { name: 'Record e-Faktur details' });
    await user.type(within(modal).getByLabelText('e-Faktur number'), '010.001-26.12345678');
    fireEvent.change(within(modal).getByLabelText('e-Faktur date'), { target: { value: '2026-09-28' } });
    await user.click(within(modal).getByRole('button', { name: 'Save' }));

    expect(h.setEfakturMutate).toHaveBeenCalledWith({ siId: 'si-n1', efakturNumber: '010.001-26.12345678', efakturDate: '2026-09-28' });
  });
});
