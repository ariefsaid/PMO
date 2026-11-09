import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * #1461 — the dashboard "Invoiced · excl. tax" figure sums issued invoices dated inside the
 * selected period; its drill carries `?from=<month>&to=<month>`, and the receivables invoice
 * list must then show exactly those records (issued, non-cancelled, dated in the window).
 */

const { salesInvoicesState } = vi.hoisted(() => ({
  salesInvoicesState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
  },
}));

vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => salesInvoicesState,
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAssignInvoiceProject: () => ({ assign: vi.fn() }),
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ ownershipCache: { get: () => undefined, set: vi.fn() } }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/lib/analytics', async importOriginal => ({
  ...(await importOriginal<typeof import('@/src/lib/analytics')>()),
  trackFilterApplied: vi.fn(),
}));

import SalesInvoices from '../SalesInvoices';

const invoice = (id: string, over: Record<string, unknown>) => ({
  id,
  org_id: 'org-1',
  project_id: null,
  customer_id: 'cust-1',
  customer_name: 'Acme Energy',
  si_number: `SINV-${id}`,
  reference_number: null,
  invoice_date: '2026-02-10',
  amount: 1000,
  currency: 'USD',
  tax_treatment: 'exclusive',
  erp_outstanding_amount: 1000,
  status: 'Unpaid',
  erp_docstatus: 1,
  erp_modified: null,
  erp_amended_from: null,
  erp_cancelled_at: null,
  created_at: '2026-02-10T00:00:00Z',
  author_user_id: 'u-fin',
  erp_payment_terms_days: 30,
  erp_due_date: null,
  received_date: null,
  ...over,
});

const renderInvoices = (search = '') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ImpersonationProvider realRole="Finance">
        <MemoryRouter initialEntries={[`/finance/receivables${search}`]}>
          <ToastProvider>
            <SalesInvoices embedded />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  salesInvoicesState.data = [
    invoice('in-window', {}),
    invoice('before-window', { invoice_date: '2025-12-31' }),
    invoice('after-window', { invoice_date: '2026-04-01' }),
    invoice('draft-in-window', { status: 'Draft' }),
    invoice('cancelled-in-window', { erp_cancelled_at: '2026-02-11T00:00:00+00:00' }),
  ];
  salesInvoicesState.isPending = false;
  salesInvoicesState.isError = false;
});

describe('#1461 — receivables invoices ?from/&to drill window', () => {
  it('without a window the list shows every invoice', () => {
    renderInvoices('');
    expect(screen.getByRole('table').textContent).toContain('SINV-before-window');
    expect(screen.getByRole('table').textContent).toContain('SINV-draft-in-window');
  });

  it('with a window the list holds exactly the issued invoices dated inside it', () => {
    renderInvoices('?from=2026-01&to=2026-03');
    const table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain('SINV-in-window');
    expect(table).not.toContain('SINV-before-window');
    expect(table).not.toContain('SINV-after-window');
    // The pack never counts drafts or ERP-cancelled invoices, even dated inside the window.
    expect(table).not.toContain('SINV-draft-in-window');
    expect(table).not.toContain('SINV-cancelled-in-window');
  });
});
