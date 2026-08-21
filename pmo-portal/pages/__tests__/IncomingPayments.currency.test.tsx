import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * #530 / AC-L10N-020 — an incoming payment renders in ITS OWN currency.
 *
 * ⚑ Why this file exists. #529 made every money formatter take the record's currency, but every
 * fixture on this surface was USD — so replacing `p.currency` with a literal `'USD'` left the suite
 * green. A test that cannot tell the record's own currency from a hardcoded one is not testing the
 * seam; it is testing that some money renders. Verified: the mutation reddens these.
 */

const { paymentsState, invoicesState } = vi.hoisted(() => ({
  paymentsState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  invoicesState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
}));

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
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));

import IncomingPayments from '../IncomingPayments';

const payment = (over: Record<string, unknown>) => ({
  id: 'ip-1',
  org_id: 'org-1',
  customer_id: 'cust-1',
  sales_invoice_id: null,
  ip_number: 'ACC-PAY-0001',
  reference_number: null,
  date: '2026-07-01',
  amount: 123_400,
  currency: 'USD',
  status: 'Paid',
  erp_docstatus: 1,
  erp_modified: null,
  erp_amended_from: null,
  erp_cancelled_at: null,
  created_at: '2026-07-01T00:00:00Z',
  ...over,
});

function renderPage() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <ImpersonationProvider realRole="Finance">
          <IncomingPayments />
        </ImpersonationProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  paymentsState.data = [];
  invoicesState.data = [];
});

describe('IncomingPayments — currency (#530)', () => {
  it('renders an IDR payment in IDR, never the org default', () => {
    paymentsState.data = [payment({ id: 'ip-idr', currency: 'IDR' })];
    renderPage();
    const table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain('IDR');
    expect(table).not.toContain('$');
  });

  it('renders two currencies side by side — per record, not per page', () => {
    paymentsState.data = [
      payment({ id: 'ip-usd', currency: 'USD' }),
      payment({ id: 'ip-idr', currency: 'IDR' }),
    ];
    renderPage();
    const table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain('IDR');
    expect(table).toContain('$');
  });
});
