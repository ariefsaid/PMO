import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  customers: [
    { value: 'company-canonical-1', label: 'Northwind Services', sub: 'Client' },
    { value: 'company-canonical-2', label: 'Borealis Engineering', sub: 'Client' },
  ],
  projects: [
    { value: 'project-1', label: 'Harbor Retrofit', clientId: 'company-canonical-1', subjectToVat: false, taxRate: null, archived: false },
    { value: 'project-2', label: 'Offshore Survey', clientId: 'company-canonical-1', subjectToVat: false, taxRate: null, archived: false },
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
  useClientCompanyOptions: () => ({ data: h.customers, isPending: false, isError: false, refetch: vi.fn() }),
  useInvoiceProjectOptions: () => ({ data: h.projects, isPending: false, isError: false, refetch: vi.fn(async () => ({ data: h.projects, error: null })) }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-18', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'erp' }));
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

const invoice = (
  id: string,
  customerId: string,
  projectId: string,
  invoiceDate: string,
  overrides: Partial<SalesInvoiceRow> = {},
): SalesInvoiceRow => ({
  id,
  org_id: 'org-1',
  project_id: projectId,
  customer_id: customerId,
  customer_name: customerId === 'company-canonical-1' ? 'Northwind Services' : 'Borealis Engineering',
  si_number: id,
  reference_number: null,
  invoice_date: invoiceDate,
  amount: 1000,
  currency: 'USD',
  tax_treatment: 'exclusive',
  tax_amount: 0,
  tax_rate: 0,
  tax_base_numerator: 1,
  tax_base_denominator: 1,
  erp_outstanding_amount: 1000,
  status: 'Submitted',
  erp_docstatus: 1,
  erp_modified: null,
  erp_amended_from: null,
  erp_cancelled_at: null,
  created_at: `${invoiceDate}T00:00:00Z`,
  author_user_id: 'author-1',
  author_user_ids: ['author-1'],
  erp_payment_terms_days: 30,
  erp_due_date: null,
  received_date: null,
  ...overrides,
}) as SalesInvoiceRow;

const SEED: SalesInvoiceRow[] = [
  invoice('INV-C1-P1-OVERDUE', 'company-canonical-1', 'project-1', '2026-08-01'),
  invoice('INV-C1-P1-CURRENT', 'company-canonical-1', 'project-1', '2026-10-01'),
  invoice('INV-C1-P2-OVERDUE', 'company-canonical-1', 'project-2', '2026-08-01'),
  invoice('INV-C2-P1-OVERDUE', 'company-canonical-2', 'project-1', '2026-08-01'),
];

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
};

function renderAt(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ImpersonationProvider realRole="Finance">
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

beforeEach(() => {
  h.invoices.data = [...SEED];
  h.invoices.isPending = false;
  h.invoices.isError = false;
});

describe('SalesInvoices customer collections deep link (AC-S36-004)', () => {
  it('intersects exact customer ID with project and overdue URL filters and shows its authorized company label', () => {
    renderAt('/sales-invoices?customer=company-canonical-1&project=project-1&overdue=true');

    const table = screen.getByRole('table');
    expect(within(table).getByText('INV-C1-P1-OVERDUE')).toBeInTheDocument();
    expect(within(table).queryByText('INV-C1-P1-CURRENT')).not.toBeInTheDocument();
    expect(within(table).queryByText('INV-C1-P2-OVERDUE')).not.toBeInTheDocument();
    expect(within(table).queryByText('INV-C2-P1-OVERDUE')).not.toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /INV-C1-P1-OVERDUE/ })).toHaveTextContent('$1,000.00');
    expect(screen.getByTestId('customer-filter')).toHaveTextContent('Customer: Northwind Services');
  });

  it('clears only customer and retains the current project, overdue, sort, and search URL state', async () => {
    const user = userEvent.setup();
    renderAt('/sales-invoices?customer=company-canonical-1&project=project-1&overdue=true&q=INV-C1-P1-OVERDUE');

    await user.click(screen.getByRole('button', { name: 'Clear customer filter' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/sales-invoices?project=project-1&overdue=true&q=INV-C1-P1-OVERDUE');
  });

  it('keeps an unknown customer filter exact and never falls back to all invoices', () => {
    renderAt('/sales-invoices?customer=not-authorized-customer');

    expect(screen.getByTestId('customer-filter')).toHaveTextContent('Selected customer is unavailable');
    const table = screen.getByRole('table');
    for (const row of SEED) expect(within(table).queryByText(row.si_number!)).not.toBeInTheDocument();
    expect(within(table).getByText('No invoices match your filters')).toBeInTheDocument();
  });
});
