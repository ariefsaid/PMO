// AC-NBR-004 / AC-NBR-091: the receipt rows gate on the receipt read alone; the revenue mode only holds the action cells.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';

const h = vi.hoisted(() => ({
  mode: 'native' as 'native' | 'erp' | undefined,
  payments: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => h.mode }));
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
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));

import IncomingPayments from './IncomingPayments';

const receipt = {
  id: 'ip-1', org_id: 'org-1', customer_id: 'cust-1', customer_name: 'Acme Energy', sales_invoice_id: 'si-1',
  ip_number: null, pmo_number: 'RCV-2610070001', pmo_native: true, cancelled_at: null, reference_number: null,
  date: '2026-10-07', amount: 500_000, received_amount: 500_000, withheld_amount: 0, withholding_slip_number: null,
  currency: 'IDR', status: 'Paid', erp_docstatus: null, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: null, created_at: '2026-10-07T00:00:00Z', allocations: [],
} as unknown as IncomingPaymentRow;

const page = () => render(
  <ImpersonationProvider realRole="Finance">
    <MemoryRouter initialEntries={['/finance/receivables?view=payments']}>
      <ToastProvider><IncomingPayments embedded /></ToastProvider>
    </MemoryRouter>
  </ImpersonationProvider>,
);

beforeEach(() => {
  h.mode = 'native';
  h.payments.data = [receipt];
  h.payments.isPending = false;
  h.payments.isError = false;
});

describe('AC-NBR-004 receipts list: revenue mode holds only the action cells', () => {
  it('(P) mode pending: the receipt rows render, not a whole-list skeleton', () => {
    h.mode = undefined;
    page();
    expect(screen.getAllByText('Acme Energy').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('liststate-loading')).not.toBeInTheDocument();
  });
  it('(F) mode failed (hook falls back to native): rows render', () => {
    h.mode = 'native';
    page();
    expect(screen.getAllByText('Acme Energy').length).toBeGreaterThan(0);
  });
  it('AC-NBR-091: a pending receipt read is the list skeleton and never "empty"', () => {
    h.payments.data = undefined as unknown as unknown[];
    h.payments.isPending = true;
    page();
    expect(screen.queryByText('No payments match your filters')).not.toBeInTheDocument();
    expect(screen.queryByText('Acme Energy')).not.toBeInTheDocument();
  });
  it('AC-NBR-004: mode pending: no Expected chip, a reserved placeholder instead; chips appear once mode is known', () => {
    h.mode = undefined;
    const { unmount } = page();
    expect(screen.queryByText('Expected')).toBeNull();
    expect(screen.getByTestId('status-filters-pending')).toBeInTheDocument();
    unmount();
    h.mode = 'erp';
    page();
    expect(screen.queryByTestId('status-filters-pending')).toBeNull();
    expect(screen.getAllByText('Expected').length).toBeGreaterThan(0);
  });
});
