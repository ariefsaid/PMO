import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * SalesInvoices — the create-invoice journey (read-model audit BLOCK 1 + 1b).
 *
 * Before the fix a Finance user could NOT raise an invoice from PMO at all: all four money
 * pickers were `loadOptions={async () => []}` stubs, so `customerId` could never leave '' (the
 * Combobox only emits on select), `isComplete` stayed false and "Create invoice" was permanently
 * disabled. And the line items lived in a DETACHED `useState`, so whatever the user typed never
 * reached the submitted `values.lineItems` — a $50,000 invoice would have posted as $0.
 *
 * These tests drive the real journey: open the form, pick a real customer, type a real line item,
 * submit, and assert what the mutation actually receives.
 *
 * NOTE: the affordance gate is stubbed here — this file tests the FORM, not the gate. The gate is
 * owned by src/auth/policy.test.ts (`create salesInvoice` = Finance + Admin, owner ruling 2026-07-20).
 */

const hoisted = vi.hoisted(() => ({
  createMutate: vi.fn(async () => ({ id: 'si-new', si_number: 'ACC-SINV-0001' })),
  salesInvoicesState: { data: [], isPending: false, isError: false, refetch: vi.fn() },
  clientOptions: [
    { value: 'cust-1', label: 'Acme Energy', sub: 'Client' },
    { value: 'cust-2', label: 'Borealis Marine', sub: 'Client' },
  ],
  projectOptions: [{ value: 'proj-1', label: 'Alpha Platform', sub: 'ALP-01' }],
}));

vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => hoisted.salesInvoicesState,
  useRevenueMutations: () => ({
    create: { mutateAsync: hoisted.createMutate, isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: hoisted.clientOptions }),
  useProjectOptions: () => ({ data: hoisted.projectOptions }),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));

vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));

import SalesInvoices from '../SalesInvoices';

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter>
        <ToastProvider>
          <SalesInvoices />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

/** Opens the create form (the header action; the empty state offers the same button). */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
}

/** Picks `label` in the named picker. */
async function pick(user: ReturnType<typeof userEvent.setup>, picker: string, label: string) {
  await user.click(screen.getByRole('combobox', { name: picker }));
  const option = await screen.findByRole('option', { name: new RegExp(label) });
  await user.click(option);
}

beforeEach(() => {
  hoisted.createMutate.mockClear();
});

describe('SalesInvoices — a Finance user can actually raise an invoice (BLOCK 1)', () => {
  it('offers the org\'s real client companies in the customer picker', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await user.click(screen.getByRole('combobox', { name: 'Customer' }));

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /Acme Energy/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /Borealis Marine/ })).toBeInTheDocument();
  });

  it('offers the org\'s real projects in the project picker', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await user.click(screen.getByRole('combobox', { name: 'Project' }));

    expect(await screen.findByRole('option', { name: /Alpha Platform/ })).toBeInTheDocument();
  });

  it('enables "Create invoice" once a customer is chosen (it was permanently disabled)', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    const submit = screen.getByRole('button', { name: 'Create invoice' });
    expect(submit).toBeDisabled();

    await pick(user, 'Customer', 'Acme Energy');

    expect(screen.getByRole('button', { name: 'Create invoice' })).toBeEnabled();
  });

  it('submits the line items the USER typed — never the untouched $0 stub (BLOCK 1b)', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');

    await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
    const qty = screen.getByLabelText(/Qty/);
    await user.clear(qty);
    await user.type(qty, '2');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '25000');

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(hoisted.createMutate).toHaveBeenCalledWith({
      customerId: 'cust-1',
      projectId: 'proj-1',
      items: [{ item_code: 'ITEM-001', qty: 2, rate: 25000 }],
      // BLOCK 2 (ADR-0058): the form session's command identity rides along with the body.
      intent: { id: expect.any(String), idempotencyKey: expect.any(String) },
    });
  });

  it('submits every line the user added, not just the first', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await pick(user, 'Customer', 'Acme Energy');
    await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
    await user.click(screen.getByRole('button', { name: /Add line item/i }));

    const codes = screen.getAllByLabelText(/Item code/);
    expect(codes).toHaveLength(2);
    await user.type(codes[1], 'ITEM-002');

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(hoisted.createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { item_code: 'ITEM-001', qty: 1, rate: 0 },
          { item_code: 'ITEM-002', qty: 1, rate: 0 },
        ],
      }),
    );
  });
});
