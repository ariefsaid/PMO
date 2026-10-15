import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  invoices: { data: [] as SalesInvoiceRow[], isPending: false, isError: false, refetch: vi.fn() },
  rateArgs: [] as unknown[][],
  rate: {
    data: null as { rate: number; rate_date: string } | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  exportColumns: [] as Array<{ key: string; exportValue?: (row: SalesInvoiceRow) => unknown }>,
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => h.invoices,
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1', role: 'Finance' } }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string) => action === 'view',
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'IDR',
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: (enabled: boolean) => ({
    day: enabled ? '2026-10-12' : null,
    isPending: false,
    isError: false,
    retry: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useFxRates', () => ({
  useFxRate: (base: string, quote: string, day: string | null, enabled: boolean) => {
    h.rateArgs.push([base, quote, day, enabled]);
    if (!enabled) return { ...h.rate, data: null };
    const result =
      day === '2026-10-10'
        ? { rate: 16234.56, rate_date: '2026-10-09' }
        : { rate: 16300, rate_date: '2026-10-12' };
    return { ...h.rate, data: result };
  },
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useInvoiceProjectOptions: () => ({ data: [] }),
  useClientCompanyOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useRecordContext', () => ({
  useRecordContext: () => ({ closeRecord: vi.fn() }),
}));
vi.mock('@/src/hooks/useCommandIntent', () => ({
  useCommandIntent: () => 'intent',
  useCommandIntentMap: () => ({ intentFor: () => 'intent', release: vi.fn() }),
}));
vi.mock('@/src/hooks/useErpItemOptions', () => ({
  useErpItemOptions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useInvoicePdfDownload', () => ({
  useInvoicePdfDownload: () => ({ inFlightIds: new Set<string>(), download: vi.fn() }),
}));
vi.mock('@/src/components/export', async () => {
  const actual =
    await vi.importActual<typeof import('@/src/components/export')>('@/src/components/export');
  return {
    ...actual,
    ExportButton: ({
      columns,
    }: {
      columns: Array<{ key: string; exportValue?: (row: SalesInvoiceRow) => unknown }>;
    }) => {
      h.exportColumns = columns;
      return <button type="button">Export invoices</button>;
    },
  };
});

import SalesInvoices from '../SalesInvoices';

const invoice = (overrides: Partial<SalesInvoiceRow>): SalesInvoiceRow => ({
  id: 'inv-usd',
  org_id: 'org-1',
  erp_project: null,
  project_id: null,
  customer_id: 'client-1',
  customer_name: 'USD client',
  si_number: 'SI-USD',
  reference_number: 'PO-USD',
  invoice_date: '2026-10-10',
  amount: 100,
  currency: 'USD',
  tax_treatment: 'exclusive',
  tax_amount: 11,
  tax_rate: 11,
  tax_base_numerator: 1,
  tax_base_denominator: 1,
  erp_outstanding_amount: 25,
  status: 'Unpaid',
  erp_docstatus: 1,
  erp_modified: null,
  erp_amended_from: null,
  erp_cancelled_at: null,
  created_at: '2026-10-12T00:00:00Z',
  author_user_id: null,
  author_user_ids: [],
  erp_payment_terms_days: null,
  erp_due_date: null,
  received_date: null,
  pmo_native: true,
  pmo_number: null,
  native_lines: [{ item_code: 'SVC', description: 'Services', qty: 1, rate: 100, amount: 100 }],
  approved_by_id: null,
  approved_at: null,
  overpaid_amount: null,
  erp_opening_amount: null,
  erp_opening_at: null,
  efaktur_number: null,
  efaktur_date: null,
  ...overrides,
});
const rows = [
  invoice({}),
  invoice({
    id: 'inv-usd-old',
    si_number: 'SI-USD-OLD',
    invoice_date: '2026-10-12',
    amount: 100,
    erp_outstanding_amount: 0,
    pmo_native: false,
  }),
  invoice({
    id: 'inv-idr',
    si_number: 'SI-IDR',
    invoice_date: '2026-10-10',
    currency: 'IDR',
    amount: 50,
    tax_amount: 0,
    tax_treatment: 'inclusive',
    erp_outstanding_amount: 10,
    pmo_native: false,
  }),
  invoice({
    id: 'inv-eur',
    si_number: 'SI-EUR',
    currency: 'EUR',
    amount: 80,
    tax_amount: 0,
    tax_treatment: 'inclusive',
    erp_outstanding_amount: 20,
    pmo_native: false,
  }),
  invoice({
    id: 'inv-null',
    si_number: 'SI-NULL',
    amount: null,
    erp_outstanding_amount: null,
    tax_amount: 0,
  }),
];

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/sales-invoices" element={<SalesInvoices />} />
            <Route path="/sales-invoices/:invoiceId" element={<SalesInvoices />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.invoices.data = rows;
  h.invoices.isPending = false;
  h.invoices.isError = false;
  h.rateArgs = [];
  h.exportColumns = [];
});
afterEach(() => cleanup());

describe('AC-FX-012 sales invoice equivalents', () => {
  it('adds only display equivalents to USD list amounts, gross and latest outstanding, not to IDR/EUR or null money', () => {
    renderAt('/sales-invoices');
    const table = screen.getByRole('table');
    const usd = within(table).getByText('SI-USD').closest('tr') as HTMLElement;
    expect(usd).toHaveTextContent('≈ Rp 1,623,456 (JISDOR 2026-10-09)');
    expect(usd).toHaveTextContent('≈ Rp 1,802,036 (JISDOR 2026-10-09)');
    expect(usd).toHaveTextContent('≈ Rp 407,500 (JISDOR 2026-10-12)');
    const idr = within(table).getByText('SI-IDR').closest('tr') as HTMLElement;
    const eur = within(table).getByText('SI-EUR').closest('tr') as HTMLElement;
    const nullMoney = within(table).getByText('SI-NULL').closest('tr') as HTMLElement;
    expect(idr).not.toHaveTextContent('JISDOR');
    expect(eur).not.toHaveTextContent('≈ Rp');
    expect(eur).toHaveTextContent(/USD contracts in IDR organizations only/);
    expect(nullMoney).not.toHaveTextContent('≈ Rp');
    expect(h.rateArgs).toContainEqual(['USD', 'IDR', '2026-10-12', true]);
    expect(h.rateArgs).toContainEqual(['USD', 'IDR', '2026-10-10', true]);
    expect(h.rateArgs.some((args) => args[3] === true && args[0] !== 'USD')).toBe(false);
  });

  it('keeps export columns on original invoice values and shows date-based equivalents on the routable detail preview', () => {
    renderAt('/sales-invoices');
    const amountColumn = h.exportColumns.find((column) => column.key === 'amount');
    expect(h.exportColumns.map((column) => column.key)).not.toContain('fxEquivalent');
    expect(amountColumn?.exportValue?.(rows[0])).toBe(100);
    expect(amountColumn?.exportValue?.(rows[0])).not.toBe(1_630_000);

    cleanup();
    h.rateArgs = [];
    renderAt('/sales-invoices/inv-usd');
    expect(screen.getByRole('heading', { name: 'Invoice SI-USD' })).toBeInTheDocument();
    expect(screen.getByText('≈ Rp 1,623,456 (JISDOR 2026-10-09)')).toBeInTheDocument();
    expect(screen.getByText('≈ Rp 1,802,036 (JISDOR 2026-10-09)')).toBeInTheDocument();
    expect(screen.getByText('≈ Rp 407,500 (JISDOR 2026-10-12)')).toBeInTheDocument();
    expect(h.rateArgs).toContainEqual(['USD', 'IDR', '2026-10-12', true]);
  });
});
