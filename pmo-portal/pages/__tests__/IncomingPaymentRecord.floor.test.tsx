import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import type { BreadcrumbPart } from '@/src/components/shell/Breadcrumb';

const h = vi.hoisted(() => ({
  payments: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  route: 'pmo' as 'pmo' | 'external',
  role: 'Finance' as 'Finance' | 'Engineer',
}));

vi.mock('@/src/components/export', () => ({ ExportButton: () => null, withCurrencyColumn: <Row,>(columns: Row[]) => columns }));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: vi.fn(), busy: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useIncomingPayments: () => h.payments,
  useSalesInvoices: () => h.invoices,
  useRevenueMutations: () => ({
    createPayment: { mutateAsync: vi.fn(), isPending: false },
    cancelPayment: { mutateAsync: vi.fn(), isPending: false },
    applyReceipt: { mutateAsync: vi.fn(), isPending: false },
    unapplyAllocation: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }] }),
  useInvoiceProjectOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => {
  if (action === 'view' && entity === 'incomingPayment') return h.role !== 'Engineer';
  if (action === 'create' && entity === 'incomingPayment') return h.role === 'Finance';
  if (action === 'transition' && entity === 'incomingPayment') return h.role === 'Finance';
  return true;
} }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({
  data: h.route === 'external' ? [{ id: 'o-1', orgId: 'org-1', externalTier: 'erpnext', domain: 'revenue' }] : [],
  isError: false,
}) }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...real, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/src/lib/agent/runtime/AgentRuntimeContext', () => ({
  useAgentRuntimeContext: () => ({ togglePanel: vi.fn(), openPanel: vi.fn(), open: false }),
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => false }));
vi.mock('@/src/hooks/useAssistantHotkey', () => ({ useAssistantHotkey: vi.fn() }));
vi.mock('@/src/hooks/useCachedRecordLists', () => ({ useCachedRecordLists: () => ({
  lists: { projects: [], opportunities: [], procurements: [], companies: [], contacts: [], userViews: [] }, resolved: true,
}) }));
vi.mock('@/src/hooks/useRecordSearch', () => ({ useRecordSearch: () => ({ records: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/auth/impersonation', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/auth/impersonation')>();
  return { ...real, useOptionalRealRole: () => 'Finance' };
});
vi.mock('@/src/auth/useIsOperator', () => ({ useOperatorMembership: () => ({ isOperator: false, isError: false }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));
vi.mock('@/src/lib/agent/context/useAgentContext', () => ({ useAgentContext: () => ({ setEntity: vi.fn() }) }));
vi.mock('@/src/components/shell', async () => {
  const React = await import('react');
  const { Breadcrumb } = await import('@/src/components/shell/Breadcrumb');
  return {
    AppShell: ({ header }: { header: React.ReactNode }) => React.createElement(React.Fragment, null, header),
    Rail: () => null,
    ContextBar: ({ breadcrumb }: { breadcrumb: BreadcrumbPart[] }) => React.createElement(Breadcrumb, { parts: breadcrumb }),
    CommandPalette: () => null,
    PhoneNavBar: () => null,
    LegacyHomeRedirect: () => null,
    modulesForRoleWithOperator: () => [],
    agentEntityForPath: () => null,
    breadcrumbForPath: () => [],
    recordLabelForPath: () => undefined,
    recordContractualNameForPath: () => undefined,
    recordStatusGroupForPath: () => undefined,
    deriveRailActiveOverride: () => null,
  };
});

import IncomingPayments from '../IncomingPayments';
import { ShellChrome } from '../../App';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const openInvoice = {
  id: 'si-1', customer_id: 'cust-1', si_number: null, pmo_number: 'INV-2610070001', pmo_native: true,
  status: 'Unpaid', erp_outstanding_amount: 610_000, currency: 'IDR',
} as unknown as SalesInvoiceRow;

const receipt = (over: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow => ({
  id: 'ip-1', org_id: 'org-1', customer_id: 'cust-1', customer_name: 'Acme Energy', sales_invoice_id: 'si-1',
  ip_number: null, pmo_number: 'RCV-2610070001', pmo_native: true, cancelled_at: null, reference_number: null,
  date: '2026-10-07', amount: 500_000, received_amount: 500_000, withheld_amount: 0, withholding_slip_number: null,
  currency: 'IDR', status: 'Paid', erp_docstatus: null, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: null, created_at: '2026-10-07T00:00:00Z',
  allocations: [{ id: 'al-1', sales_invoice_id: 'si-1', amount: 500_000, cash_amount: 500_000, withheld_amount: 0, currency: 'IDR' }],
  ...over,
}) as IncomingPaymentRow;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="floor-location">{location.pathname}{location.search}</output>;
}

function renderAt(initialEntry: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <FinanceI18nTestProvider>
      <ImpersonationProvider realRole="Finance">
        <MemoryRouter initialEntries={[initialEntry]}>
          <ToastProvider>
            <Routes>
              <Route path="/incoming-payments/:receiptId" element={<IncomingPayments />} />
              <Route path="/incoming-payments" element={<IncomingPayments />} />
              <Route path="/sales-invoices/:invoiceId" element={<p>Sales invoice record</p>} />
              <Route path="/" element={<p>Dashboard</p>} />
              <Route path="*" element={<p>Unknown route</p>} />
            </Routes>
            <LocationProbe />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </FinanceI18nTestProvider>,
  );
}

afterEach(() => resetActiveLocale());
beforeEach(async () => {
  h.role = 'Finance';
  h.route = 'pmo';
  h.payments.data = [receipt()];
  h.payments.isError = false;
  h.invoices.data = [];
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  await financeTestI18n.changeLanguage('en');
});

describe('Incoming payment record floor controls', () => {
  it('floor: Back to Incoming Payments returns to the list path remembered by the record', async () => {
    const user = userEvent.setup();
    renderAt({ pathname: '/incoming-payments/ip-1', state: { recordContext: { listPath: '/finance/receivables?view=payments&q=RCV' } } });
    await user.click(screen.getByRole('button', { name: /Back to Incoming Payments/i }));
    expect(screen.getByTestId('floor-location')).toHaveTextContent('/finance/receivables?view=payments&q=RCV');
  });

  it('floor: Back to Incoming Payments from a missing receipt returns to the filtered payment list', async () => {
    h.payments.data = [];
    const user = userEvent.setup();
    renderAt('/incoming-payments/missing?status=Paid&view=payments');
    await user.click(screen.getByRole('button', { name: /Back to Incoming Payments/i }));
    expect(screen.getByTestId('floor-location')).toHaveTextContent('/incoming-payments?status=Paid&view=payments');
  });

  it('floor: Back to dashboard leaves the denied incoming payments route', async () => {
    h.role = 'Engineer';
    const user = userEvent.setup();
    renderAt('/incoming-payments/ip-1');
    await user.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('floor-location')).toHaveTextContent('/');
  });

  it('floor: settled invoice link opens its invoice record', async () => {
    h.invoices.data = [openInvoice];
    const user = userEvent.setup();
    renderAt('/incoming-payments/ip-1');
    const allocations = screen.getByRole('table', { name: 'Invoices this receipt settled' });
    await user.click(within(allocations).getByRole('link', { name: 'INV-2610070001' }));
    expect(screen.getByText('Sales invoice record')).toBeInTheDocument();
    expect(screen.getByTestId('floor-location')).toHaveTextContent('/sales-invoices/si-1');
  });

  it('floor: Receivables breadcrumb opens the remembered payment list', async () => {
    const user = userEvent.setup();
    render(
      <FinanceI18nTestProvider>
        <MemoryRouter initialEntries={[{
          pathname: '/incoming-payments/ip-1',
          state: { recordContext: { listPath: '/finance/receivables?view=payments&q=RCV' } },
        }]}>
          <ShellChrome />
          <LocationProbe />
        </MemoryRouter>
      </FinanceI18nTestProvider>,
    );
    await user.click(screen.getByRole('link', { name: 'Receivables' }));
    expect(screen.getByTestId('floor-location')).toHaveTextContent('/finance/receivables?view=payments&q=RCV');
  });
});

describe('Incoming payment record name', () => {
  it('shows Payment received as the current breadcrumb', () => {
    render(
      <FinanceI18nTestProvider>
        <MemoryRouter initialEntries={[{
          pathname: '/incoming-payments/ip-1',
          state: { recordContext: { listPath: '/finance/receivables?view=payments' } },
        }]}>
          <ShellChrome />
          <LocationProbe />
        </MemoryRouter>
      </FinanceI18nTestProvider>,
    );
    expect(screen.getByText('Payment received')).toBeInTheDocument();
  });
});
