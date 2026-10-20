import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * AC-RD-TBL-INV-001 (T4) + FIN-S1: the invoice list is the shared DataTable with a number+customer primary
 * cell, at most 7 columns at 1440, and none of the subtracted chrome in its default state.
 */
const h = vi.hoisted(() => ({
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  orgDay: { day: '2026-10-18' as string | null, isPending: false },
  mode: 'erp' as 'erp' | 'native',
  projects: [
    { value: 'project-1', label: 'Harbor Retrofit', clientId: 'cust-1', subjectToVat: false, taxRate: null, archived: false, customerContractRef: 'CLIENT-PO-1' },
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

describe('FIN-S1 / AC-RD-TBL-INV-001: invoice list default state', () => {
  it('shows at most 7 columns, with no Date, Received, separate Customer or empty e-Faktur column', () => {
    renderAt('/sales-invoices');
    const cols = headers();
    expect(cols.length).toBeLessThanOrEqual(7);
    expect(cols).toEqual(expect.arrayContaining(['Invoice #', 'Customer reference', 'Status', 'Amount', 'Outstanding', 'Due Date']));
    for (const gone of ['Date', 'Received', 'Customer', 'e-Faktur']) expect(cols).not.toContain(gone);
  });

  it('adds the e-Faktur column only when a loaded row carries a value', () => {
    h.invoices.data = [invoice('INV-001', { efaktur_number: '010.000-26.00000001', efaktur_date: '2026-10-02' })];
    renderAt('/sales-invoices');
    expect(headers()).toContain('e-Faktur');
    expect(screen.getByText('010.000-26.00000001')).toBeInTheDocument();
  });

  it('puts the invoice number and the customer in one primary cell, with the full amount in another', () => {
    renderAt('/sales-invoices');
    const row = screen.getByRole('row', { name: /INV-001/ });
    const primary = within(row).getByRole('link', { name: 'INV-001' }).closest('td,th')!;
    expect(primary).toHaveTextContent('Northwind Services');
    expect(within(row).getAllByText('$1,250,000.50').length).toBeGreaterThan(0);
  });

  it('shows the project under the customer only when its label is known', () => {
    h.invoices.data = [
      invoice('INV-001', { project_id: 'project-1' }),
      invoice('INV-002', { project_id: 'project-gone' }),
      invoice('INV-003', { project_id: null }),
    ];
    renderAt('/sales-invoices');
    expect(within(screen.getByRole('row', { name: /INV-001/ })).getByText(/Harbor Retrofit/)).toBeInTheDocument();
    for (const id of ['INV-002', 'INV-003']) {
      const text = screen.getByRole('row', { name: new RegExp(id) }).textContent ?? '';
      expect(text).not.toMatch(/Project (not recorded|details)/);
    }
    expect(screen.getAllByText(/Harbor Retrofit/)).toHaveLength(1);
  });

  it('shows a dash for a missing customer reference and never the project reference fallback', () => {
    h.invoices.data = [invoice('INV-001', { project_id: 'project-1' })];
    renderAt('/sales-invoices');
    expect(screen.queryByText(/Project reference/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CLIENT-PO-1/)).not.toBeInTheDocument();
  });

  it('shows the currency code only when the invoice is not in the organization currency', () => {
    h.invoices.data = [invoice('INV-001'), invoice('INV-002', { currency: 'EUR' })];
    renderAt('/sales-invoices');
    expect(within(screen.getByRole('row', { name: /INV-001/ })).queryByText('USD')).not.toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /INV-002/ })).getByText('EUR')).toBeInTheDocument();
  });

  it('has no project filter, no sort button and no organization-date loading text; Overdue only appears once', () => {
    h.orgDay.day = null;
    h.orgDay.isPending = true;
    renderAt('/sales-invoices');
    expect(screen.queryByRole('combobox', { name: 'Filter by project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Oldest overdue first/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading the organization date/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Overdue only' })).toHaveLength(1);
  });

  it('describes the page in one short line and offers no Browse Projects button to a project manager', () => {
    renderAt('/sales-invoices', 'Project Manager');
    expect(screen.getByText('Client invoices.')).toBeInTheDocument();
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

  it('a ?project= link-in shows a chip that clears only the project', async () => {
    h.invoices.data = [invoice('INV-001', { project_id: 'project-1' }), invoice('INV-002')];
    const user = userEvent.setup();
    renderAt('/sales-invoices?project=project-1&q=INV');
    const chip = screen.getByTestId('project-filter');
    expect(chip).toHaveTextContent('Harbor Retrofit');
    expect(screen.queryByRole('link', { name: 'INV-002' })).not.toBeInTheDocument();
    await user.click(within(chip).getByRole('button', { name: 'Clear project filter' }));
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
