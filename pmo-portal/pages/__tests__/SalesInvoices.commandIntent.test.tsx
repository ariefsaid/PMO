/**
 * SalesInvoices — the duplicate-money regression (BLOCK 2, ADR-0058).
 *
 * THE BUG this locks out: the command identity was minted per ATTEMPT inside the repository, so a
 * human retry after a LOST response ("external system unreachable — try again") opened a SECOND
 * outbox row with a fresh 4-tuple, which could not see the Payment Entry / Sales Invoice ERP had
 * already committed — a second SUBMITTED money document with posted GL, cancel-only.
 *
 * The property: within ONE form session every attempt carries the SAME {id, idempotencyKey}; a new
 * form session (after a terminal success) carries a DIFFERENT one. The REAL `useRevenueMutations`
 * hook runs here — only the repository seam is mocked, so this proves the whole click→hook→seam path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/** The invoice body the page sends (the repository's first argument). */
interface InvoiceBody {
  customerId: string;
  projectId?: string | null;
  items: Array<{ item_code: string; qty: number; rate: number }>;
}
/** The command identity (the repository's second argument) — what these tests are about. */
interface Intent {
  id: string;
  idempotencyKey: string;
}

const { revenue } = vi.hoisted(() => ({
  revenue: {
    listInvoices: vi.fn(async () => []),
    createInvoice: vi.fn(async (_input: InvoiceBody, _intent?: Intent) => ({
      id: 'si-new',
      si_number: 'ACC-SINV-0001',
    })),
  },
}));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = await orig<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { revenue } };
});

vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }] }),
  useProjectOptions: () => ({ data: [] }),
}));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'external') }));

import SalesInvoices from '../SalesInvoices';

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole="Finance">
        <MemoryRouter>
          <ToastProvider>
            <SalesInvoices />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
};

/** Fills the create form with a real customer + line item and presses Create invoice. */
async function submitAnInvoice(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
  await user.click(screen.getByRole('combobox', { name: 'Customer' }));
  await user.click(await screen.findByRole('option', { name: /Acme Energy/ }));
  await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
  await user.click(screen.getByRole('button', { name: 'Create invoice' }));
}

/** Presses Create invoice again on the still-open form (the retry after a lost response). */
async function retry(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Create invoice' }));
}

beforeEach(() => {
  revenue.createInvoice.mockClear();
  revenue.createInvoice.mockResolvedValue({ id: 'si-new', si_number: 'ACC-SINV-0001' });
});

describe('SalesInvoices — a retry reuses the command identity (no duplicate money doc)', () => {
  it('sends the SAME {id, idempotencyKey} on a retry after a failed attempt', async () => {
    const user = userEvent.setup();
    revenue.createInvoice.mockRejectedValueOnce(new Error('external system unreachable'));
    renderPage();

    await submitAnInvoice(user);
    // The form stays open on failure — the user presses the same button again.
    await retry(user);

    expect(revenue.createInvoice).toHaveBeenCalledTimes(2);
    const firstIntent = revenue.createInvoice.mock.calls[0][1];
    const secondIntent = revenue.createInvoice.mock.calls[1][1];
    expect(firstIntent).toEqual(expect.objectContaining({ id: expect.any(String), idempotencyKey: expect.any(String) }));
    expect(secondIntent).toEqual(firstIntent);
  });

  it('a NEW form session after a success sends a DIFFERENT identity', async () => {
    const user = userEvent.setup();
    renderPage();

    await submitAnInvoice(user); // succeeds → the modal closes
    expect(screen.queryByRole('button', { name: 'Create invoice' })).not.toBeInTheDocument();
    await submitAnInvoice(user); // a brand-new invoice

    expect(revenue.createInvoice).toHaveBeenCalledTimes(2);
    const first = revenue.createInvoice.mock.calls[0][1] as Intent;
    const second = revenue.createInvoice.mock.calls[1][1] as Intent;
    expect(second.id).not.toBe(first.id);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('never smuggles the intent into the invoice body (it is the dispatch identity, not a field)', async () => {
    const user = userEvent.setup();
    renderPage();

    await submitAnInvoice(user);

    expect(revenue.createInvoice.mock.calls[0][0]).toEqual({
      customerId: 'cust-1',
      projectId: null,
      items: [{ item_code: 'ITEM-001', qty: 1, rate: 0 }],
    });
  });
});
