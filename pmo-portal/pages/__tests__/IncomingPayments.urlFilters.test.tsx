import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';

/**
 * R2 (ux/1110): the incoming-payments search box is URL-owned (`?q=`) so a search survives
 * opening a receipt and pressing Back, or a plain refresh — like the status drill already does.
 */

const h = vi.hoisted(() => ({
  payments: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
}));

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
  useClientCompanyOptions: () => ({ data: [] }),
  useInvoiceProjectOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/components/export', async () => {
  const React = await import('react');
  return {
    ExportButton: ({ label = 'Export' }: { label?: string }) => React.createElement('button', { type: 'button' }, label),
    withCurrencyColumn: <Row,>(columns: Row[]) => columns,
  };
});

import IncomingPayments from '../IncomingPayments';

const receipt = (): IncomingPaymentRow => ({
  id: 'ip-1', org_id: 'org-1', customer_id: 'cust-1', customer_name: 'Acme Energy', sales_invoice_id: null,
  ip_number: null, pmo_number: 'RCV-2610070001', pmo_native: true, cancelled_at: null, reference_number: null,
  date: '2026-10-07', amount: 500_000, received_amount: 500_000, withheld_amount: 0, withholding_slip_number: null,
  currency: 'IDR', status: 'Paid', erp_docstatus: null, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: null, created_at: '2026-10-07T00:00:00Z', allocations: [],
}) as IncomingPaymentRow;

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
};

const renderPage = (initialEntry = '/incoming-payments') => render(
  <FinanceI18nTestProvider>
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <LocationProbe />
          <IncomingPayments />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>,
);

beforeEach(() => {
  h.payments = { data: [receipt()], isPending: false, isError: false, refetch: vi.fn() };
  h.invoices = { data: [] as SalesInvoiceRow[], isPending: false, isError: false, refetch: vi.fn() };
});

describe('R2 — incoming payments search lives in the URL', () => {
  it('opens with the search box showing ?q= and the list narrowed to the matches', () => {
    renderPage('/incoming-payments?q=RCV-26');
    const search = screen.getByRole('searchbox', { name: 'Search incoming payments' }) as HTMLInputElement;
    expect(search).toHaveValue('RCV-26');
    // The one seeded receipt matches RCV-26; the list is not emptied by the param.
    expect(screen.getByText('RCV-2610070001')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?q=RCV-26');
  });

  it('typing in the search box writes the query into the URL', () => {
    renderPage('/incoming-payments');
    const search = screen.getByRole('searchbox', { name: 'Search incoming payments' });
    fireEvent.change(search, { target: { value: 'Acme' } });
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?q=Acme');
  });
});
