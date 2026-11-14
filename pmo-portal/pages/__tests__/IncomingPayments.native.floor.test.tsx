import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';

const h = vi.hoisted(() => ({
  cancelMutate: vi.fn(async (_input: unknown): Promise<void> => undefined),
  exportXlsx: vi.fn(),
  payments: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  exportedRows: [] as unknown[],
  pagePosition: {
    position: {
      receivablesCount: 0, receivablesUnknownCount: 0, overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
      drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [], unappliedPayments: [], unappliedTotals: {},
      payables: [], payablesTotals: {}, payablesUnknownCount: 0,
      receivablesAgeing: { IDR: { notDue: 0, noDueDate: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 } },
      receivablesNoDueDateCounts: {}, payablesAgeing: {},
    },
    today: '2026-10-27', invoices: [] as unknown[], payments: [] as unknown[],
    receivablesPending: false, receivablesError: false, cashPending: false, cashError: false,
    invoiceCount: 0, paymentCount: 0, retryCash: vi.fn(), retryReceivables: vi.fn(),
  },
}));

vi.mock('@/src/components/export', async () => {
  const React = await import('react');
  return {
    ExportButton: ({ rows, label = 'Export' }: { rows: unknown[]; label?: string }) => React.createElement('button', {
      type: 'button', onClick: () => { h.exportedRows = rows; },
    }, label),
    withCurrencyColumn: <Row,>(columns: Row[]) => columns,
  };
});
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: h.exportXlsx, busy: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
  useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useIncomingPayments: () => h.payments,
  useSalesInvoices: () => h.invoices,
  useRevenueMutations: () => ({
    createPayment: { mutateAsync: vi.fn(), isPending: false },
    cancelPayment: { mutateAsync: h.cancelMutate, isPending: false },
    applyReceipt: { mutateAsync: vi.fn(), isPending: false },
    unapplyAllocation: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }] }),
  useInvoiceProjectOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => action === 'create' && entity === 'incomingPayment' ? true : true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useReceivablesPagePosition', () => ({ useReceivablesPagePosition: () => h.pagePosition }));
vi.mock('@/pages/SalesInvoices', () => ({ default: () => null }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...real, useToast: () => ({ toast: vi.fn() }) };
});

import IncomingPayments from '../IncomingPayments';
import ReceivablesPage from '../finance/ReceivablesPage';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const receipt = (over: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow => ({
  id: 'ip-1', org_id: 'org-1', customer_id: 'cust-1', customer_name: 'Acme Energy', sales_invoice_id: 'si-1',
  ip_number: null, pmo_number: 'RCV-2610070001', pmo_native: true, cancelled_at: null, reference_number: null,
  date: '2026-10-07', amount: 500_000, received_amount: 500_000, withheld_amount: 0, withholding_slip_number: null,
  currency: 'IDR', status: 'Paid', erp_docstatus: null, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: null, created_at: '2026-10-07T00:00:00Z', allocations: [], ...over,
}) as IncomingPaymentRow;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="floor-location">{location.pathname}{location.search}</output>;
}

function renderPayments(initialEntry: string, embedded = true, secondaryAction?: { label: string; onSelect: () => void }) {
  return render(
    <FinanceI18nTestProvider>
      <ImpersonationProvider realRole="Finance">
        <MemoryRouter initialEntries={[initialEntry]}>
          <ToastProvider>
            <Routes>
              <Route path="/incoming-payments" element={<IncomingPayments embedded={embedded} secondaryAction={secondaryAction} />} />
              <Route path="/incoming-payments/:receiptId" element={<IncomingPayments embedded={embedded} secondaryAction={secondaryAction} />} />
              <Route path="*" element={<IncomingPayments embedded={embedded} secondaryAction={secondaryAction} />} />
            </Routes>
            <LocationProbe />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </FinanceI18nTestProvider>,
  );
}

function renderReceivables(initialEntry = '/finance/receivables') {
  return render(
    <FinanceI18nTestProvider>
      <ImpersonationProvider realRole="Finance">
        <MemoryRouter initialEntries={[initialEntry]}>
          <ToastProvider><ReceivablesPage /><LocationProbe /></ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </FinanceI18nTestProvider>,
  );
}

/** The one list row (table row or phone card) whose text matches. */
function rowFor(text: string): HTMLElement {
  const branch = screen.queryByTestId('dt-table-branch') ?? screen.getByTestId('dt-card-branch');
  const rows = within(branch).queryAllByRole('row').length > 0 ? within(branch).getAllByRole('row') : within(branch).getAllByRole('listitem');
  const hits = rows.filter((row) => row.textContent?.includes(text));
  expect(hits).toHaveLength(1);
  return hits[0];
}

function mockPhoneViewport() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: !query.includes('min-width: 768px'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

afterEach(() => {
  resetActiveLocale();
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  h.cancelMutate.mockReset();
  h.cancelMutate.mockResolvedValue(undefined);
  h.exportXlsx.mockReset();
  h.payments.data = [];
  h.payments.isError = false;
  h.invoices.data = [];
  h.exportedRows = [];
  h.pagePosition.invoices = [];
  h.pagePosition.payments = [];
  h.pagePosition.invoiceCount = 0;
  h.pagePosition.paymentCount = 0;
  await financeTestI18n.changeLanguage('en');
});

describe('Incoming payments floor controls', () => {
  it('floor: Payments received switches the receivables list to payment rows', async () => {
    h.payments.data = [receipt()];
    const user = userEvent.setup();
    renderReceivables();
    await user.click(screen.getByRole('tab', { name: /Payments received/ }));
    expect(screen.getByTestId('floor-location')).toHaveTextContent('/finance/receivables?view=payments');
    expect(screen.getByText('RCV-2610070001')).toBeInTheDocument();
  });

  it('floor: View payment opens the selected receipt drawer', async () => {
    h.payments.data = [receipt()];
    const user = userEvent.setup();
    renderPayments('/finance/receivables?view=payments');
    await user.click(within(rowFor('RCV-2610070001')).getByRole('button', { name: 'Row actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'View payment' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('floor-location')).toHaveTextContent('/finance/receivables?view=payments&open=ip-1');
  });

  it('floor: Cancel payment asks for confirmation before cancelling the receipt', async () => {
    h.payments.data = [receipt()];
    const user = userEvent.setup();
    renderPayments('/incoming-payments', false);
    await user.click(within(rowFor('RCV-2610070001')).getByRole('button', { name: 'Row actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(h.cancelMutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel payment' }));
    expect(h.cancelMutate).toHaveBeenCalledWith(expect.objectContaining({
      ipId: 'ip-1', intent: expect.objectContaining({ id: expect.any(String), idempotencyKey: expect.any(String) }),
    }));
  });

  it('floor: Select all and Clear update the selected payment rows', async () => {
    h.payments.data = [receipt({ id: 'ip-a', pmo_number: 'RCV-A' }), receipt({ id: 'ip-b', pmo_number: 'RCV-B' })];
    const user = userEvent.setup();
    renderPayments('/finance/receivables?view=payments');
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(screen.getByRole('checkbox', { name: 'Select RCV-A' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select RCV-B' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('checkbox', { name: 'Select RCV-A' })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Export selected' })).not.toBeInTheDocument();
  });

  it('floor: Export downloads only receipts in the active status filter', async () => {
    h.payments.data = [receipt({ id: 'ip-a', pmo_number: 'RCV-A' }), receipt({ id: 'ip-b', pmo_number: 'RCV-B', cancelled_at: '2026-10-08T00:00:00Z' })];
    const user = userEvent.setup();
    renderPayments('/finance/receivables?view=payments');
    await user.click(screen.getByRole('tab', { name: 'Received' }));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect((h.exportedRows as IncomingPaymentRow[]).map((row) => row.id)).toEqual(['ip-a']);
  });

  it('floor: Phone Filters narrows payment rows by status', async () => {
    mockPhoneViewport();
    h.payments.data = [receipt({ id: 'ip-a', pmo_number: 'RCV-A' }), receipt({ id: 'ip-b', pmo_number: 'RCV-B', cancelled_at: '2026-10-08T00:00:00Z' })];
    const user = userEvent.setup();
    renderPayments('/finance/receivables?view=payments');
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const filterRegion = screen.getByRole('region', { name: 'Filters' });
    await user.click(within(filterRegion).getByRole('tab', { name: 'Cancelled' }));
    expect(screen.getByText('RCV-B')).toBeInTheDocument();
    expect(screen.queryByText('RCV-A')).not.toBeInTheDocument();
  });

  it('floor: Phone More actions exports the filtered payment rows', async () => {
    mockPhoneViewport();
    h.payments.data = [receipt({ id: 'ip-a', pmo_number: 'RCV-A' })];
    const user = userEvent.setup();
    renderPayments('/finance/receivables?view=payments', true, { label: 'New invoice', onSelect: vi.fn() });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    expect(h.exportXlsx).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'ip-a' })]), expect.any(Array), 'Incoming Payments');
  });

  it('floor: Phone More actions runs the available secondary action', async () => {
    mockPhoneViewport();
    h.payments.data = [receipt()];
    const user = userEvent.setup();
    renderReceivables('/finance/receivables?view=payments');
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'New invoice' }));
    expect(screen.getByTestId('floor-location')).toHaveTextContent('/finance/receivables?create=1');
  });

  it('floor: Receive payment opens the receipt form from Receivables', async () => {
    h.payments.data = [receipt()];
    const user = userEvent.setup();
    renderReceivables();
    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    expect(screen.getByTestId('floor-location')).toHaveTextContent('/finance/receivables?view=payments');
    expect(await screen.findByRole('combobox', { name: 'Customer' })).toBeInTheDocument();
  });

  it('floor: Open full page and Back preserve the payment list query', async () => {
    h.payments.data = [receipt()];
    const user = userEvent.setup();
    renderPayments('/incoming-payments?view=payments&open=ip-1');
    const drawer = await screen.findByRole('dialog');
    await user.click(within(drawer).getByRole('button', { name: 'Open full page' }));
    expect(await screen.findByRole('heading', { name: /RCV-2610070001/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Back to Incoming Payments/i }));
    expect(screen.getByTestId('floor-location')).toHaveTextContent('/incoming-payments?view=payments');
  });

  it('floor: Payment actions confirms cancellation before calling the receipt transition', async () => {
    h.payments.data = [receipt()];
    const user = userEvent.setup();
    renderPayments('/finance/receivables?view=payments&open=ip-1');
    const drawer = await screen.findByRole('dialog');
    await user.click(within(drawer).getByRole('button', { name: 'Payment actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(h.cancelMutate).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel payment' }));
    expect(h.cancelMutate).toHaveBeenCalledWith(expect.objectContaining({
      ipId: 'ip-1', intent: expect.objectContaining({ id: expect.any(String), idempotencyKey: expect.any(String) }),
    }));
  });
});
