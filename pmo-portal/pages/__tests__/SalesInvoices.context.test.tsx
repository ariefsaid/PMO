import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** #2564: the receivables phone cards and record drawer keep the project, project manager and delivery context. */
const h = vi.hoisted(() => ({
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  orgDay: { day: '2026-10-18' as string | null, isPending: false, isError: false, retry: vi.fn() },
  mode: 'erp' as 'erp' | 'native',
  received: vi.fn(async () => {}),
  submit: vi.fn(async (_input: { siId: string; intent: unknown }) => {}),
  projectsError: false,
  retryProjects: vi.fn(async () => ({ data: [], error: null })),
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
    setReceivedDate: { mutateAsync: h.received, isPending: false },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: h.submit, isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-finance', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Northwind Services' }], isPending: false, isError: false, refetch: vi.fn() }),
  useInvoiceProjectOptions: () => ({ data: h.projects, isPending: false, isError: h.projectsError, refetch: h.retryProjects }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => h.orgDay }));
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

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: 'project-1', pm: { full_name: 'Rina Pratama' } }, { id: 'project-2', pm: null }], isPending: false }),
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


function renderList() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FinanceI18nTestProvider>
        <ImpersonationProvider realRole="Finance">
          <MemoryRouter initialEntries={['/sales-invoices']}>
            <ToastProvider>
              <Routes><Route path="/sales-invoices" element={<SalesInvoices embedded />} /></Routes>
            </ToastProvider>
          </MemoryRouter>
        </ImpersonationProvider>
      </FinanceI18nTestProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
  h.invoices.isPending = false;
  h.invoices.isError = false;
  h.mode = 'erp';
  await financeTestI18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('#2564 receivables rows keep delivery and project context', () => {
  it('AC-RECV-CTX-001 the phone card names the project, its manager and the delivery state', () => {
    h.invoices.data = [invoice('INV-001', { project_id: 'project-1', received_date: '2026-10-05' })];
    renderList();
    expect(screen.getByText(/Contractual Harbor Retrofit · Rina Pratama/)).toBeInTheDocument();
    expect(screen.getByText(/Delivered 5 Oct/)).toBeInTheDocument();
  });

  it('AC-RECV-CTX-002 an unassigned manager and an undelivered invoice are said in words', () => {
    h.invoices.data = [invoice('INV-002', { project_id: null })];
    renderList();
    expect(screen.getByText('Unassigned PM')).toBeInTheDocument();
    expect(screen.getByText('Not delivered yet')).toBeInTheDocument();
  });

  it('AC-RECV-CTX-003 reads in Bahasa on the phone card', async () => {
    await financeTestI18n.changeLanguage('id');
    h.invoices.data = [invoice('INV-002', { project_id: null })];
    renderList();
    expect(screen.getByText('PM belum ditetapkan')).toBeInTheDocument();
    expect(screen.getByText('Belum dikirim')).toBeInTheDocument();
  });

  it('AC-RECV-CTX-004 the record drawer lists Project manager and Delivery and leaves the amounts alone', async () => {
    h.invoices.data = [invoice('INV-001', { project_id: 'project-1', received_date: '2026-10-05' })];
    renderList();
    await userEvent.click(screen.getByRole('button', { name: /Open INV-001/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Project manager')).toBeInTheDocument();
    expect(within(dialog).getByText('Rina Pratama')).toBeInTheDocument();
    expect(within(dialog).getByText('Delivery')).toBeInTheDocument();
    expect(within(dialog).getByText(/Delivered 5 Oct/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/1,250,000\.50/).length).toBeGreaterThan(0);
  });
});
