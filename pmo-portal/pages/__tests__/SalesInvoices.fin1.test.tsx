import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** Invoice collection behavior: identity, exact amounts, scope and ordering stay testable as the layout changes. */
const h = vi.hoisted(() => ({
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  orgDay: { day: '2026-10-18' as string | null, isPending: false },
  mode: 'erp' as 'erp' | 'native',
  projects: [
    { value: 'project-1', label: 'North Harbor', sub: 'Contractual Harbor Retrofit · CLIENT-PO-1', contractualName: 'Contractual Harbor Retrofit', clientId: 'cust-1', subjectToVat: false, taxRate: null, archived: false, customerContractRef: 'CLIENT-PO-1' },
  ],
}));

vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => h.invoices,
  useSalesInvoiceEvidence: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false }),
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-finance', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Northwind Services' }], isPending: false, isError: false, refetch: vi.fn() }),
  useInvoiceProjectOptions: () => ({ data: h.projects, isPending: false, isError: false, refetch: vi.fn(async () => ({ data: h.projects, error: null })) }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ ...h.orgDay, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => h.mode }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useInvoicePdfDownload', () => ({ useInvoicePdfDownload: () => ({ download: vi.fn(), inFlightIds: new Set<string>() }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [] }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
  useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxRates', () => ({ useFxRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/lib/analytics', () => ({ trackFilterApplied: vi.fn(), trackSearchUsed: vi.fn() }));
vi.mock('@/pages/approvals/SalesInvoiceApprovalRow', () => ({
  SalesInvoiceApprovalPreview: ({ inv }: { inv: SalesInvoiceRow }) => <div>Invoice preview {inv.si_number}</div>,
}));

import SalesInvoices from '../SalesInvoices';

const invoice = (id: string, overrides: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id,
  org_id: 'org-1',
  project_id: null,
  customer_id: 'cust-1',
  customer_name: 'Northwind Services',
  si_number: id,
  reference_number: null,
  invoice_date: '2026-10-01',
  amount: 1_250_000.5,
  currency: 'USD',
  tax_treatment: 'exclusive',
  tax_amount: 0,
  tax_rate: 0,
  tax_base_numerator: 1,
  tax_base_denominator: 1,
  erp_outstanding_amount: 1_250_000.5,
  status: 'Unpaid',
  erp_docstatus: 1,
  erp_modified: null,
  erp_amended_from: null,
  erp_cancelled_at: null,
  created_at: '2026-10-01T00:00:00Z',
  author_user_id: 'author-1',
  author_user_ids: ['author-1'],
  erp_payment_terms_days: 30,
  erp_due_date: null,
  received_date: null,
  efaktur_number: null,
  efaktur_date: null,
  ...overrides,
}) as SalesInvoiceRow;

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
};

function renderAt(url: string, role: 'Finance' | 'Project Manager' = 'Finance') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ImpersonationProvider realRole={role}>
        <MemoryRouter initialEntries={[url]}>
          <ToastProvider>
            <LocationProbe />
            <Routes>
              <Route path="/sales-invoices" element={<SalesInvoices />} />
              <Route path="/sales-invoices/:invoiceId" element={<SalesInvoices />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}

const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent?.trim()).filter(Boolean);

beforeEach(() => {
  h.invoices.data = [invoice('INV-001')];
  h.invoices.isPending = false;
  h.invoices.isError = false;
  h.orgDay.day = '2026-10-18';
  h.orgDay.isPending = false;
  h.mode = 'erp';
});

describe('invoice list evidence', () => {
  it('keeps invoice identity, customer context and exact amounts available', () => {
    renderAt('/sales-invoices');
    const cols = headers();
    expect(cols).toEqual(expect.arrayContaining(['Invoice #', 'Customer / project', 'Status / due', 'Currency', 'Outstanding gross', 'Invoice gross']));
    const row = screen.getByRole('row', { name: /INV-001/ });
    expect(within(row).getByText('Northwind Services')).toBeInTheDocument();
    expect(within(row).getAllByText('1,250,000.5').length).toBeGreaterThan(0);
  });

  it('shows a known project name and names an unavailable attributed project', () => {
    h.invoices.data = [
      invoice('INV-001', { project_id: 'project-1' }),
      invoice('INV-002', { project_id: 'project-gone' }),
      invoice('INV-003', { project_id: null }),
    ];
    renderAt('/sales-invoices');
    expect(within(screen.getByRole('row', { name: /INV-001/ })).getByText('Contractual Harbor Retrofit')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /INV-002/ })).getByText('Project details unavailable')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /INV-003/ })).queryByText('Project details unavailable')).not.toBeInTheDocument();
    expect(screen.getAllByText('Contractual Harbor Retrofit')).toHaveLength(1);
  });

  it('shows a dash for a missing customer reference and never the project reference fallback', () => {
    h.invoices.data = [invoice('INV-001', { project_id: 'project-1' })];
    renderAt('/sales-invoices');
    expect(screen.queryByText(/Project reference/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CLIENT-PO-1/)).not.toBeInTheDocument();
  });

  it('shows one ISO currency per invoice while money cells remain plain grouped numbers', () => {
    h.invoices.data = [invoice('INV-001'), invoice('INV-002', { currency: 'EUR' })];
    renderAt('/sales-invoices');
    expect(within(screen.getByRole('row', { name: /INV-001/ })).getByText('USD')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /INV-002/ })).getByText('EUR')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /INV-001/ })).getAllByText('1,250,000.5')).toHaveLength(2);
  });

  it('shows the visible sort and overdue filter without an organization-date loading message', () => {
    h.orgDay.day = null;
    h.orgDay.isPending = true;
    renderAt('/sales-invoices');
    expect(screen.getByRole('combobox', { name: 'Sort invoices' })).toHaveValue('due-asc');
    expect(screen.queryByText(/Loading the organization date/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Overdue only' })).toHaveLength(1);
  });

  it('places search, filters, sort, export and creation in the prescribed toolbar order', () => {
    renderAt('/sales-invoices');
    const toolbar = screen.getByTestId('money-in-toolbar');
    const search = within(toolbar).getByRole('searchbox', { name: 'Search sales invoices' });
    const filters = within(toolbar).getByRole('region', { name: 'Filter by status' });
    const sort = within(toolbar).getByRole('combobox', { name: 'Sort invoices' });
    const exportAction = within(toolbar).getByRole('button', { name: /export/i });
    const create = within(toolbar).getByRole('button', { name: 'New Invoice' });

    expect(search.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(filters.compareDocumentPosition(sort) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(sort.compareDocumentPosition(exportAction) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(exportAction.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('keeps secondary filters collapsed on phone and reports the active filter count', async () => {
    renderAt('/sales-invoices?status=Unpaid&project=project-1');
    const filters = screen.getByRole('button', { name: 'Filters · 2' });
    expect(filters).toHaveAttribute('aria-expanded', 'false');

    await userEvent.setup().click(filters);

    expect(filters).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Filter by project' })).toHaveValue('project-1');
  });

  it('orders by due date by default, leaves unknown due dates last and uses invoice IDs for ties', () => {
    h.invoices.data = [
      invoice('INV-LATER', { erp_due_date: '2026-11-01' }),
      invoice('INV-UNKNOWN', { invoice_date: null, erp_payment_terms_days: null, erp_due_date: null }),
      invoice('INV-SOONER-B', { erp_due_date: '2026-10-20' }),
      invoice('INV-SOONER-A', { erp_due_date: '2026-10-20' }),
    ];
    renderAt('/sales-invoices');
    expect(screen.getAllByRole('link', { name: /^INV-/ }).map((link) => link.textContent)).toEqual([
      'INV-SOONER-A', 'INV-SOONER-B', 'INV-LATER', 'INV-UNKNOWN',
    ]);
  });

  it('uses latest invoice date for Draft and keeps an explicit sort when status changes', async () => {
    const defaulted = renderAt('/sales-invoices?status=Draft');
    expect(screen.getByRole('combobox', { name: 'Sort invoices' })).toHaveValue('invoice-date-desc');
    defaulted.unmount();

    renderAt('/sales-invoices?sort=overdue-desc');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Draft' }));
    expect(screen.getByTestId('location')).toHaveTextContent('sort=overdue-desc');
  });

  it('describes the page in one short line and offers no Browse Projects button to a project manager', () => {
    renderAt('/sales-invoices', 'Project Manager');
    expect(screen.getByText('Due-first collection · gross amounts in each invoice currency.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Browse Projects' })).not.toBeInTheDocument();
  });
});

describe('FIN-S1: project reaches the list through search and a removable chip', () => {
  it('search matches the project label', async () => {
    h.invoices.data = [invoice('INV-001', { project_id: 'project-1' }), invoice('INV-002')];
    const user = userEvent.setup();
    renderAt('/sales-invoices');
    await user.type(screen.getByRole('searchbox', { name: 'Search sales invoices' }), 'harbor');
    expect(screen.getByRole('link', { name: 'INV-001' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'INV-002' })).not.toBeInTheDocument();
  });

  it('AC-002 #1325: search also matches the contractual title behind a short label', async () => {
    h.invoices.data = [invoice('INV-001', { project_id: 'project-1' }), invoice('INV-002')];
    const user = userEvent.setup();
    renderAt('/sales-invoices');
    await user.type(screen.getByRole('searchbox', { name: 'Search sales invoices' }), 'retrofit');
    expect(screen.getByRole('link', { name: 'INV-001' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'INV-002' })).not.toBeInTheDocument();
  });

  it('a ?project= link-in restores the project filter and clearing it preserves search', async () => {
    h.invoices.data = [invoice('INV-001', { project_id: 'project-1' }), invoice('INV-002')];
    const user = userEvent.setup();
    renderAt('/sales-invoices?project=project-1&q=INV');
    expect(screen.getByRole('combobox', { name: 'Filter by project' })).toHaveValue('project-1');
    expect(screen.queryByRole('link', { name: 'INV-002' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by project' }), '');
    expect(screen.getByTestId('location')).toHaveTextContent('/sales-invoices?q=INV');
    expect(screen.getByRole('link', { name: 'INV-002' })).toBeInTheDocument();
  });
});

describe('FIN-S1: Overdue only sorts oldest overdue first', () => {
  it('orders the overdue invoices by age, oldest first', async () => {
    h.invoices.data = [
      invoice('INV-NEWER', { invoice_date: '2026-09-01' }),
      invoice('INV-OLDEST', { invoice_date: '2026-07-01' }),
      invoice('INV-OLDER', { invoice_date: '2026-08-01' }),
      invoice('INV-CURRENT', { invoice_date: '2026-10-10' }),
    ];
    const user = userEvent.setup();
    renderAt('/sales-invoices');
    await user.click(screen.getByRole('button', { name: 'Overdue only' }));
    const order = screen.getAllByRole('link', { name: /^INV-/ }).map((a) => a.textContent);
    expect(order).toEqual(['INV-OLDEST', 'INV-OLDER', 'INV-NEWER']);
  });
});

describe('FIN-S1: Pre-ERP history keeps its opening-balance fact in a tooltip, not a line', () => {
  it('moves the "Carried into the ERP opening balance" sentence onto the Pre-ERP badge', () => {
    h.invoices.data = [invoice('INV-001', {
      pmo_native: true,
      erp_opening_amount: 500,
      erp_opening_at: '2026-06-01T00:00:00Z',
    } as Partial<SalesInvoiceRow>)];
    renderAt('/sales-invoices');
    const row = screen.getByRole('row', { name: /INV-001/ });
    expect(within(row).getByText('Pre-ERP').closest('[title]')).toHaveAttribute('title', expect.stringContaining('Carried into the ERP opening balance'));
    for (const el of within(row).queryAllByText(/Carried into/)) expect(el).toHaveClass('sr-only');
  });
});
