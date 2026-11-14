import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * Floor tests for the Receivables page shell (floor-tests/receivables.md 3, 4, 5, 37).
 * The embedded SalesInvoices/IncomingPayments pages are REAL — the page-level controls must
 * drive them. Money writes are asserted on the mocked repository seam, never a real write.
 */
const h = vi.hoisted(() => ({
  role: 'Finance' as 'Finance' | 'Executive',
  invoices: [] as unknown[],
  payments: [] as unknown[],
  financePending: false,
  financeError: false,
  receivablesPending: false,
  receivablesError: false,
  cashPending: false,
  cashError: false,
  invoiceError: false,
  paymentError: false,
  invoiceRefetch: vi.fn(),
  paymentRefetch: vi.fn(),
  createPaymentMutate: vi.fn(async () => ({ id: 'ip-new' })),
  cancelPaymentMutate: vi.fn(async () => undefined),
  applyMutate: vi.fn(async () => ['al-new']),
  unapplyMutate: vi.fn(async () => undefined),
  createMutate: vi.fn(async () => ({ id: 'si-new' })),
  submitMutate: vi.fn(async () => undefined),
  cancelMutate: vi.fn(async () => undefined),
  setReceivedDateMutate: vi.fn(async () => undefined),
  assignMutate: vi.fn(async () => undefined),
  position: {
    receivablesCount: 0, receivablesUnknownCount: 0, overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [],
    unappliedPayments: [], unappliedTotals: {}, payables: [], payablesTotals: {}, payablesUnknownCount: 0,
    receivablesAgeing: { IDR: { notDue: 0, noDueDate: 0, d1_30: 0, d61_90: 0, d31_60: 0, over90: 0 } },
    receivablesNoDueDateCounts: {},
    payablesAgeing: {},
  } as FinancePosition,
}));

vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({ position: h.position, today: '2026-10-27', isPending: h.financePending, isError: h.financeError, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: h.invoices, isPending: h.receivablesPending, isError: h.invoiceError, refetch: h.invoiceRefetch }),
  useIncomingPayments: () => ({ data: h.payments, isPending: h.cashPending, isError: h.paymentError, refetch: h.paymentRefetch }),
  useSalesInvoiceEvidence: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useAssignInvoiceProject: () => ({ mutateAsync: h.assignMutate, isPending: false }),
  useRevenueMutations: () => ({
    create: { mutateAsync: h.createMutate, isPending: false },
    submitInvoice: { mutateAsync: h.submitMutate, isPending: false },
    cancelInvoice: { mutateAsync: h.cancelMutate, isPending: false },
    setReceivedDate: { mutateAsync: h.setReceivedDateMutate, isPending: false },
    createPayment: { mutateAsync: h.createPaymentMutate, isPending: false },
    cancelPayment: { mutateAsync: h.cancelPaymentMutate, isPending: false },
    applyReceipt: { mutateAsync: h.applyMutate, isPending: false },
    unapplyAllocation: { mutateAsync: h.unapplyMutate, isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/lib/finance/financePosition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/finance/financePosition')>();
  return { ...actual, buildFinancePosition: () => h.position };
});
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'IDR',
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }, { value: 'cust-2', label: 'Borealis Marine', sub: 'Client' }] }),
  useInvoiceProjectOptions: () => ({ data: [
    { value: 'proj-1', label: 'Alpha Platform', contractualName: 'Alpha Platform', sub: 'ALP-01', clientId: 'cust-1', subjectToVat: true, taxRate: 12, archived: false },
    { value: 'proj-2', label: 'Beta Norates', sub: 'BNR-01', clientId: 'cust-1', subjectToVat: true, taxRate: null, archived: false },
  ] }),
  useProjectOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: async () => [] }) }));
vi.mock('@/src/hooks/useFxRates', () => ({ useFxRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string) => h.role !== 'Executive' || action === 'view',
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin2', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));

import ReceivablesPage from '../finance/ReceivablesPage';

const invoice = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'invoice-1', org_id: 'org-1', project_id: 'project-1', erp_project: null, billing_kind: 'contract',
  customer_id: 'client-1', customer_name: 'Northwind', si_number: 'SI-1', reference_number: null,
  invoice_date: '2026-10-22', amount: 100, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0,
  erp_outstanding_amount: 100, status: 'Unpaid', erp_docstatus: 1, erp_modified: null,
  erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-22T00:00:00Z',
  author_user_id: 'author-1', author_user_ids: ['author-1'], erp_payment_terms_days: 14,
  erp_due_date: null, received_date: null, efaktur_number: null, efaktur_date: null, ...over,
});

const payment = (over: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow => ({
  id: 'payment-1', org_id: 'org-1', customer_id: 'client-1', customer_name: 'Northwind',
  sales_invoice_id: null, ip_number: 'IP-1', reference_number: null, date: '2026-10-05',
  amount: 150, currency: 'IDR', received_amount: 100, withheld_amount: 50,
  withholding_slip_number: null, allocation_details: [], status: 'Paid', erp_docstatus: 1,
  erp_modified: null, erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-05T00:00:00Z',
  ...over,
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

let queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPage(initialEntry = '/finance/receivables') {
  return render(
    <QueryClientProvider client={queryClient}>
      <FinanceI18nTestProvider>
        <ImpersonationProvider realRole={h.role}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <ToastProvider>
              <Routes><Route path="/finance/receivables" element={<ReceivablesPage />} /></Routes>
              <LocationProbe />
            </ToastProvider>
          </MemoryRouter>
        </ImpersonationProvider>
      </FinanceI18nTestProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.role = 'Finance';
  h.financePending = false;
  h.financeError = false;
  h.receivablesPending = false;
  h.receivablesError = false;
  h.cashPending = false;
  h.cashError = false;
  h.invoiceError = false;
  h.paymentError = false;
  h.invoiceRefetch.mockReset();
  h.paymentRefetch.mockReset();
  h.createPaymentMutate.mockReset().mockResolvedValue({ id: 'ip-new' });
  h.cancelPaymentMutate.mockReset().mockResolvedValue(undefined);
  h.invoices = [invoice(), invoice({ id: 'invoice-2', si_number: 'SI-2', invoice_date: '2026-10-01', erp_payment_terms_days: 14 })];
  h.payments = [
    payment(),
    payment({ id: 'payment-previous', date: '2026-09-05', amount: 40, received_amount: 40, withheld_amount: 0 }),
    payment({ id: 'payment-cancelled', date: '2026-10-06', amount: 999, received_amount: 999, cancelled_at: '2026-10-07T00:00:00Z' }),
    payment({ id: 'payment-scheduled', date: '2026-10-12', amount: 500, received_amount: 500, status: 'Scheduled' }),
  ];
  h.position = {
    receivablesCount: 2, receivablesUnknownCount: 0,
    overdue: [{ invoice: invoice({ id: 'overdue', erp_outstanding_amount: 10 }), daysOverdue: 5, outstanding: 1000 }],
    overdueTotals: { IDR: 1000 }, overdueUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [], unappliedPayments: [], unappliedTotals: {},
    payables: [], payablesTotals: {}, payablesUnknownCount: 0,
    receivablesAgeing: { IDR: { notDue: 8000, noDueDate: 0, d1_30: 1000, d31_60: 0, d61_90: 0, over90: 1000 } },
    receivablesNoDueDateCounts: {},
    payablesAgeing: {},
  };
  await financeTestI18n.changeLanguage('en');
});

describe('Receivables page — floor', () => {
  it('floor: Receive payment opens the payments view with its create form (floor-tests/receivables.md 3)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(within(screen.getByTestId('receivables-header-receive-payment')).getByRole('button'));

    expect(screen.getByTestId('location')).toHaveTextContent('/finance/receivables?view=payments');
    expect(await screen.findByRole('dialog', { name: /Receive payment/ })).toBeInTheDocument();
  });

  it("floor: a hidden figure's See invoices link opens the unpaid invoice list (floor-tests/receivables.md 4)", async () => {
    h.invoices = [invoice({ erp_outstanding_amount: null })];
    h.position = {
      ...h.position,
      receivablesAgeing: {},
      receivablesUnknownCount: 1,
      overdueTotals: {},
      overdueUnknownCount: 1,
      overdue: [{ invoice: invoice({ erp_outstanding_amount: null }), daysOverdue: 5, outstanding: null }],
    };
    const user = userEvent.setup();
    renderPage();

    const hiddenLine = screen.getByTestId('figures-hidden');
    await user.click(within(hiddenLine).getByRole('link', { name: /See invoices/ }));

    expect(screen.getByTestId('location')).toHaveTextContent('/finance/receivables?status=Unpaid');
  });

  it('floor: the figure Retry and the cash Retry each refetch only their own read (floor-tests/receivables.md 5)', async () => {
    const user = userEvent.setup();

    const financeActivityRetry = () => {
      // Both page error states share one title ("Couldn't load finance activity") and the error
      // ListState carries no test id, so find the page-level alert by its title text.
      const alert = screen.getAllByRole('alert').find((el) => el.textContent?.includes("Couldn't load finance activity"));
      expect(alert).toBeDefined();
      return within(alert!).getByRole('button');
    };

    h.invoiceError = true;
    const invoiceView = renderPage();
    await user.click(financeActivityRetry());
    expect(h.invoiceRefetch).toHaveBeenCalledTimes(1);
    expect(h.paymentRefetch).not.toHaveBeenCalled();
    invoiceView.unmount();

    h.invoiceError = false;
    h.paymentError = true;
    h.cashError = true;
    h.invoiceRefetch.mockClear();
    h.paymentRefetch.mockClear();
    renderPage();
    await user.click(financeActivityRetry());
    expect(h.paymentRefetch).toHaveBeenCalledTimes(1);
    expect(h.invoiceRefetch).not.toHaveBeenCalled();
  });

  it('floor: the page-level Receive payment flow records a client receipt (floor-tests/receivables.md 37)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(within(screen.getByTestId('receivables-header-receive-payment')).getByRole('button'));
    const dialog = await screen.findByRole('dialog', { name: /Receive payment/ });
    await user.click(within(dialog).getByRole('combobox', { name: 'Customer' }));
    await user.click(await screen.findByRole('option', { name: /Acme Energy/ }));
    for (const label of [/Amount settled/, /Cash received/]) {
      const field = within(dialog).getByLabelText(label);
      await user.clear(field);
      await user.type(field, '100');
    }
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));

    expect(h.createPaymentMutate).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cust-1', paidAmount: 100, receivedAmount: 100,
    }));
    expect(screen.queryByRole('dialog', { name: /Receive payment/ })).not.toBeInTheDocument();
  });
});
