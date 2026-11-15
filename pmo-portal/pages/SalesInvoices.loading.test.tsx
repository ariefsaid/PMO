// AC-NBR-004 / AC-NBR-091 / AC-NBR-020: the invoice rows gate on the invoice read alone; the revenue mode only
// holds the action cells, and a deep link never waits for the list.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const row = (over: Partial<SalesInvoiceRow>) => ({
  id: 'inv-1', org_id: 'org-1', project_id: null, customer_id: 'cust-1', customer_name: 'Acme Energy',
  si_number: 'ACC-SINV-2026-00001', reference_number: 'PO-1', invoice_date: '2026-07-01', amount: 10000, currency: 'USD',
  tax_treatment: 'inclusive', erp_outstanding_amount: 5000, status: 'Submitted', erp_docstatus: 1, erp_modified: null,
  erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-07-01T00:00:00Z', author_user_id: 'u-pm',
  author_user_ids: ['u-pm'], pmo_native: false, erp_payment_terms_days: 30, erp_due_date: null, ...over,
}) as SalesInvoiceRow;

const hoisted = vi.hoisted(() => ({
  mode: 'native' as 'native' | 'erp' | undefined,
  getInvoice: vi.fn(),
  evidence: { data: undefined, isPending: false, isError: false, refetch: vi.fn() },
  list: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoiceEvidence: () => hoisted.evidence,
  useInvoiceEvidence: () => hoisted.evidence,
  useIncomingPayments: (...args: unknown[]) => {
    void args;
    return { data: [], isPending: false, isError: false };
  },
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSalesInvoices: () => hoisted.list,
  useRevenueMutations: () => ({
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
    create: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));

vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { ...actual.repositories, revenue: { ...actual.repositories.revenue, getInvoice: hoisted.getInvoice } } };
});
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({
  routeDomainWrite: vi.fn(() => 'pmo'),
  domainTier: vi.fn((domain: string) => {
    const owner = ([] as unknown[]).find((entry) =>
      typeof entry === 'object' && entry !== null && 'domain' in entry && entry.domain === domain,
    ) as { externalTier?: unknown } | undefined;
    return typeof owner?.externalTier === 'string' ? owner.externalTier : null;
  }),
}));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useOdooPurchase', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useOdooUnreachable: (enabled = true) => ({ unreachable: enabled && false, lastOkAt: null }) }));
vi.mock('@/src/hooks/useOdooRevenue', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useOdooRevenueCommandsForInvoices: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => hoisted.mode }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-16', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useInvoiceProjectOptions: () => ({ data: [] }),
  useClientCompanyOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [], isPending: false }) }));
vi.mock('@/pages/approvals/SalesInvoiceApprovalRow', () => ({
  SalesInvoiceApprovalPreview: ({ inv }: { inv: SalesInvoiceRow }) => <div>Invoice preview {inv.si_number}</div>,
}));

vi.mock('@/src/hooks/useInvoicePdfDownload', () => ({
  useInvoicePdfDownload: () => ({ download: vi.fn(), inFlightIds: new Set<string>() }),
}));

vi.mock('@/src/lib/analytics', () => ({
  trackFilterApplied: vi.fn(),
  trackSearchUsed: vi.fn(),
}));

import SalesInvoices from './SalesInvoices';

const renderAt = (url: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Routes>
            <Route path="/finance/receivables" element={<SalesInvoices embedded />} />
            <Route path="/sales-invoices/:invoiceId" element={<SalesInvoices />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </QueryClientProvider>,
);

beforeEach(() => {
  hoisted.mode = 'native';
  hoisted.getInvoice.mockReset();
  hoisted.list.data = [row({})];
  hoisted.list.isPending = false;
  hoisted.list.isError = false;
});

describe('AC-NBR-004 receivables invoices: revenue mode holds only the action cells', () => {
  it('(P) mode pending: rows render', async () => {
    hoisted.mode = undefined;
    renderAt('/finance/receivables');
    expect((await screen.findAllByText('Acme Energy')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('liststate-loading')).not.toBeInTheDocument();
  });
  it('(F) mode failed (hook falls back to native): rows render', async () => {
    hoisted.mode = 'native';
    renderAt('/finance/receivables');
    expect((await screen.findAllByText('Acme Energy')).length).toBeGreaterThan(0);
  });
  it('AC-NBR-091: a pending list does not conclude empty', () => {
    hoisted.list.data = undefined;
    hoisted.list.isPending = true;
    renderAt('/finance/receivables');
    expect(screen.queryByText('No invoices yet')).not.toBeInTheDocument();
  });
});

describe('AC-NBR-020 invoice deep link does not wait for the list', () => {
  it('(P) list pending, by-id ready: the record renders', async () => {
    hoisted.list.data = undefined;
    hoisted.list.isPending = true;
    hoisted.getInvoice.mockResolvedValue(row({ id: 'inv-9', si_number: 'ACC-SINV-2026-00009' }));
    renderAt('/sales-invoices/inv-9');
    expect((await screen.findAllByText(/ACC-SINV-2026-00009/)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Couldn't load sales invoices")).not.toBeInTheDocument();
  });
  it('(F) by-id failed, list ready but unlisted: the detail error state', async () => {
    hoisted.getInvoice.mockRejectedValue(new Error('network'));
    renderAt('/sales-invoices/inv-missing');
    expect(await screen.findByText("Couldn't load sales invoices")).toBeInTheDocument();
  });
  it('a list error does not mask a loaded by-id record', async () => {
    hoisted.list.data = undefined;
    hoisted.list.isError = true;
    hoisted.getInvoice.mockResolvedValue(row({ id: 'inv-9', si_number: 'ACC-SINV-2026-00009' }));
    renderAt('/sales-invoices/inv-9');
    expect((await screen.findAllByText(/ACC-SINV-2026-00009/)).length).toBeGreaterThan(0);
  });
});

describe('AC-NBR-020 invoice record: a pending revenue mode holds only the action buttons', () => {
  it('(P) mode pending, record loaded: number, customer and amount show; the primary action is held', async () => {
    hoisted.mode = undefined;
    hoisted.getInvoice.mockResolvedValue(row({ id: 'inv-9', si_number: 'ACC-SINV-2026-00009' }));
    renderAt('/sales-invoices/inv-9');
    expect((await screen.findAllByText(/ACC-SINV-2026-00009/)).length).toBeGreaterThan(0);
    expect(screen.getByText('Acme Energy')).toBeInTheDocument();
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
    expect(screen.queryByTestId('liststate-loading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Record delivery|Approve|Record payment/ })).not.toBeInTheDocument();
    // the action's space is held, so the facts card does not drop when the mode lands
    expect(screen.getByTestId('record-action-pending')).toBeInTheDocument();
  });
  it('a record with no mode-dependent action (Paid) holds no slot', async () => {
    hoisted.mode = undefined;
    hoisted.getInvoice.mockResolvedValue(row({ id: 'inv-9', si_number: 'ACC-SINV-2026-00009', status: 'Paid' }));
    renderAt('/sales-invoices/inv-9');
    expect((await screen.findAllByText(/ACC-SINV-2026-00009/)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('record-action-pending')).toBeNull();
  });
  it('mode ready, same record: the primary action shows', async () => {
    hoisted.mode = 'erp';
    hoisted.getInvoice.mockResolvedValue(row({ id: 'inv-9', si_number: 'ACC-SINV-2026-00009' }));
    renderAt('/sales-invoices/inv-9');
    expect((await screen.findAllByText(/ACC-SINV-2026-00009/)).length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: /Record delivery|Approve|Record payment/ })).toBeInTheDocument();
  });
  it('AC-NBR-004: mode pending: no Submitted chip, a placeholder holds the chip row; chips appear once mode is known', async () => {
    hoisted.mode = undefined;
    const first = renderAt('/finance/receivables');
    await screen.findAllByText('Acme Energy');
    expect(screen.queryByRole('tab', { name: 'Submitted' })).toBeNull();
    expect(screen.getByTestId('status-filters-pending')).toBeInTheDocument();
    first.unmount();
    hoisted.mode = 'erp';
    renderAt('/finance/receivables');
    await screen.findAllByText('Acme Energy');
    expect(screen.queryByTestId('status-filters-pending')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Submitted' })).toBeInTheDocument();
  });
});
