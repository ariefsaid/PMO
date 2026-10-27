import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const { paymentsState, invoicesState, createPaymentMutate, clientOptions } = vi.hoisted(() => ({
  paymentsState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  invoicesState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  createPaymentMutate: vi.fn(),
  clientOptions: [{ value: 'cust-1', label: 'Acme Co', sub: 'Client' }],
}));

vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useIncomingPayments: () => paymentsState,
  useSalesInvoices: () => invoicesState,
  useRevenueMutations: () => ({
    createPayment: { mutateAsync: createPaymentMutate, isPending: false },
    cancelPayment: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: clientOptions }),
}));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));

import IncomingPayments from '../IncomingPayments';

const payment = (over: Record<string, unknown>) => ({
  id: 'ip-1',
  org_id: 'org-1',
  customer_id: 'cust-1',
  customer_name: 'Acme Co',
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
  createPaymentMutate.mockClear();
});

describe('IncomingPayments — currency (#530)', () => {
  it('AC-S27-004: form settlement, cash, and collapsed withholding use the selected invoice currency', async () => {
    invoicesState.data = [{
      id: 'si-idr',
      customer_id: 'cust-1',
      customer_name: 'Acme Co',
      si_number: 'SI-IDR',
      pmo_number: 'SI-IDR',
      currency: 'IDR',
      invoice_date: '2026-07-01',
      amount: 123_400,
      erp_outstanding_amount: 123_400,
      status: 'Unpaid',
      pmo_native: true,
    }];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('combobox', { name: 'Customer' }));
    await user.click(await screen.findByRole('option', { name: /Acme Co/ }));
    await user.click(screen.getByRole('combobox', { name: 'Sales Invoice' }));
    await user.click(await screen.findByRole('option', { name: /SI-IDR/ }));

    const settled = screen.getByLabelText(/^Amount settled/);
    const cash = screen.getByLabelText(/^Cash received/);
    const adornment = (input: HTMLElement) => input.parentElement?.textContent ?? '';
    expect(adornment(settled)).toContain('IDR');
    expect(adornment(settled)).not.toContain('$');
    expect(adornment(cash)).toContain('IDR');
    expect(adornment(cash)).not.toContain('$');

    const disclosure = screen.getByRole('button', { name: 'Tax withheld' });
    await user.click(disclosure);
    const withheld = screen.getByLabelText(/Withheld tax amount/);
    expect(adornment(withheld)).toContain('IDR');
    expect(adornment(withheld)).not.toContain('$');
    await user.type(withheld, '110');
    await user.type(screen.getByLabelText('Withholding-slip number'), 'SYN-WHT-IDR');
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(withheld).not.toBeVisible();
    expect(screen.getByText(/Tax withheld:/)).toHaveTextContent(/IDR.*110/);
    expect(screen.getByText('Withholding slip: SYN-WHT-IDR')).toBeInTheDocument();
  });

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
