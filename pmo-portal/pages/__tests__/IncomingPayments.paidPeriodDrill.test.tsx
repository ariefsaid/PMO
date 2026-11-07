import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';

/**
 * #1461 — the dashboard "Collected" figure sums Paid receipts dated inside the selected period;
 * its drill carries `?view=payments&status=Paid&from=<month>&to=<month>`, and the payments list
 * must then show exactly those records.
 */

const { paymentsState, invoicesState } = vi.hoisted(() => ({
  paymentsState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  invoicesState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useIncomingPayments: () => paymentsState,
  useSalesInvoices: () => invoicesState,
  useRevenueMutations: () => ({
    createPayment: { mutateAsync: vi.fn(), isPending: false },
    cancelPayment: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [] }),
  useInvoiceProjectOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'erp' }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));

import IncomingPayments from '../IncomingPayments';

const payment = (id: string, over: Record<string, unknown>) => ({
  id,
  org_id: 'org-1',
  customer_id: 'cust-1',
  customer_name: 'Acme Co',
  sales_invoice_id: null,
  ip_number: `PAY-${id}`,
  reference_number: null,
  date: '2026-02-10',
  amount: 123_400,
  currency: 'USD',
  status: 'Paid',
  cancelled_at: null,
  erp_docstatus: 1,
  erp_modified: null,
  erp_amended_from: null,
  erp_cancelled_at: null,
  created_at: '2026-02-10T00:00:00Z',
  ...over,
});

function renderPage(search = '') {
  render(
    <MemoryRouter initialEntries={[`/finance/receivables${search}`]}>
      <ToastProvider>
        <ImpersonationProvider realRole="Finance">
          <IncomingPayments embedded />
        </ImpersonationProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  paymentsState.data = [
    payment('in-window', {}),
    payment('before-window', { date: '2025-12-31' }),
    payment('after-window', { date: '2026-04-01' }),
    payment('scheduled-in-window', { status: 'Scheduled' }),
  ];
  invoicesState.data = [];
});

describe('#1461 — payments ?status=Paid&from&to drill', () => {
  it('opens with the URL status selected and only Paid receipts dated inside the window', () => {
    renderPage('?view=payments&status=Paid&from=2026-01&to=2026-03');
    // The status tab strip opens with "Received" (the Paid filter's label) selected.
    expect(screen.getByRole('tab', { name: 'Received', selected: true })).toBeInTheDocument();
    const list = document.body.textContent ?? '';
    expect(list).toContain('PAY-in-window');
    expect(list).not.toContain('PAY-before-window');
    expect(list).not.toContain('PAY-after-window');
    expect(list).not.toContain('PAY-scheduled-in-window');
  });

  it('without the drill params the list stays unfiltered', () => {
    renderPage('?view=payments');
    const list = document.body.textContent ?? '';
    for (const id of ['in-window', 'before-window', 'after-window', 'scheduled-in-window']) {
      expect(list).toContain(`PAY-${id}`);
    }
  });
});
