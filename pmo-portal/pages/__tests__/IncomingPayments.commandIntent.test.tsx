/**
 * IncomingPayments — the duplicate-money regression (BLOCK 2, ADR-0058).
 *
 * The exact scenario from the bug report: Finance clicks "Record payment" → ERP COMMITS the Payment
 * Entry → the response is lost → the toast says "external system unreachable — try again" and the
 * modal stays open → Finance clicks again. Before the fix that second click minted a NEW identity
 * and posted a SECOND submitted Payment Entry with GL. Now both attempts carry the SAME identity,
 * so the outbox reconciles onto the already-committed doc.
 *
 * The REAL `useRevenueMutations` runs here — only the repository seam is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

interface PaymentBody {
  customerId: string;
  salesInvoiceId?: string | null;
  paidAmount: number;
  receivedAmount?: number;
  date: string;
}
interface Intent {
  id: string;
  idempotencyKey: string;
}

const { revenue } = vi.hoisted(() => ({
  revenue: {
    listPayments: vi.fn(async () => []),
    listInvoices: vi.fn(async () => []),
    createPayment: vi.fn(async (_input: PaymentBody, _intent?: Intent) => ({
      id: 'ip-new',
      ip_number: 'ACC-PAY-0001',
    })),
  },
}));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = await orig<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { revenue } };
});

vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }] }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'external') }));

import IncomingPayments from '../IncomingPayments';

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole="Finance">
        <MemoryRouter>
          <ToastProvider>
            <IncomingPayments />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
};

/** Opens the receipt form, fills a real customer + amounts, and presses Record payment. */
async function recordAPayment(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
  await user.click(screen.getByRole('combobox', { name: 'Customer' }));
  await user.click(await screen.findByRole('option', { name: /Acme Energy/ }));
  const paid = screen.getByLabelText(/Paid Amount/);
  await user.clear(paid);
  await user.type(paid, '25000');
  const received = screen.getByLabelText(/Received Amount/);
  await user.clear(received);
  await user.type(received, '25000');
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
}

beforeEach(() => {
  revenue.createPayment.mockClear();
  revenue.createPayment.mockResolvedValue({ id: 'ip-new', ip_number: 'ACC-PAY-0001' });
});

describe('IncomingPayments — a retry reuses the command identity (no second Payment Entry)', () => {
  it('sends the SAME {id, idempotencyKey} when the user retries after "unreachable"', async () => {
    const user = userEvent.setup({ delay: null });
    revenue.createPayment.mockRejectedValueOnce(new Error('external system unreachable'));
    renderPage();

    await recordAPayment(user);
    // The modal stays open on failure — the user presses Record payment again.
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(revenue.createPayment).toHaveBeenCalledTimes(2);
    const first = revenue.createPayment.mock.calls[0][1] as Intent;
    expect(first).toEqual(expect.objectContaining({ id: expect.any(String), idempotencyKey: expect.any(String) }));
    expect(revenue.createPayment.mock.calls[1][1]).toEqual(first);
  }, 20000);

  it('a NEW form session after a success sends a DIFFERENT identity', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();

    await recordAPayment(user); // succeeds → the modal closes
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    await recordAPayment(user); // a genuinely new receipt

    const first = revenue.createPayment.mock.calls[0][1] as Intent;
    const second = revenue.createPayment.mock.calls[1][1] as Intent;
    expect(second.id).not.toBe(first.id);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  }, 20000);

  it('never smuggles the intent into the payment body', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();

    await recordAPayment(user);

    expect(revenue.createPayment.mock.calls[0][0]).toEqual({
      customerId: 'cust-1',
      salesInvoiceId: null,
      paidAmount: 25000,
      receivedAmount: 25000,
      date: expect.any(String),
    });
  });
});
