/**
 * AC-W3-NUM-003 — QuotationsSection: quoted total numeric validation.
 *
 * "Quoted total" is required and must parse to a number > 0.
 * Empty / non-numeric / ≤ 0 → inline error AND Add is blocked (onAdd NOT
 * called). A valid quote still adds as today.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useFkOptions', () => ({
  useVendorOptions: () => ({
    data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }],
  }),
}));

import { QuotationsSection } from './QuotationsSection';

function renderSection(props: Partial<React.ComponentProps<typeof QuotationsSection>> = {}) {
  const onAdd = props.onAdd ?? vi.fn().mockResolvedValue(undefined);
  const onSelect = props.onSelect ?? vi.fn().mockResolvedValue(undefined);
  const onError = props.onError ?? vi.fn();
  render(
    <ToastProvider>
      <QuotationsSection
        quotations={props.quotations ?? []}
        canAdd={props.canAdd ?? true}
        canSelect={props.canSelect ?? false}
        onAdd={onAdd}
        onSelect={onSelect}
        onError={onError}
      />
    </ToastProvider>,
  );
  return { onAdd, onSelect, onError };
}

/** Open the add-quotation form and pick a vendor. */
async function openAndPickVendor() {
  await userEvent.click(screen.getByTestId('add-quotation'));
  const form = screen.getByTestId('add-quotation-form');
  await userEvent.click(within(form).getByRole('combobox', { name: /vendor/i }));
  await userEvent.click(await screen.findByRole('option', { name: /apex supply/i }));
  return form;
}

beforeEach(() => vi.clearAllMocks());

// ── AC-W3-NUM-003 ─────────────────────────────────────────────────────────────

describe('AC-W3-NUM-003 QuotationsSection — quoted total numeric validation', () => {
  it('AC-W3-NUM-003: non-numeric total ("abc") shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const form = await openAndPickVendor();
    await userEvent.type(within(form).getByLabelText(/quoted total/i), 'abc');
    await userEvent.click(within(form).getByRole('button', { name: /add quotation/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-003: zero total ("0") shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const form = await openAndPickVendor();
    await userEvent.type(within(form).getByLabelText(/quoted total/i), '0');
    await userEvent.click(within(form).getByRole('button', { name: /add quotation/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-003: negative total ("-100") shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const form = await openAndPickVendor();
    await userEvent.type(within(form).getByLabelText(/quoted total/i), '-100');
    await userEvent.click(within(form).getByRole('button', { name: /add quotation/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-003: mixed garbage ("12x") shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const form = await openAndPickVendor();
    await userEvent.type(within(form).getByLabelText(/quoted total/i), '12x');
    await userEvent.click(within(form).getByRole('button', { name: /add quotation/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-003: valid total ("2710") submits with the correct parsed number (regression)', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSection({ onAdd });
    const form = await openAndPickVendor();
    await userEvent.type(within(form).getByLabelText(/quoted total/i), '2710');
    const addBtn = within(form).getByRole('button', { name: /add quotation/i });
    await waitFor(() => expect(addBtn).toBeEnabled());
    await userEvent.click(addBtn);
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0]).toMatchObject({ vendorId: 'v1', totalAmount: 2710 });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('AC-W3-NUM-003: comma-formatted valid total ("2,710") submits with the correct parsed number', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSection({ onAdd });
    const form = await openAndPickVendor();
    await userEvent.type(within(form).getByLabelText(/quoted total/i), '2,710');
    const addBtn = within(form).getByRole('button', { name: /add quotation/i });
    await waitFor(() => expect(addBtn).toBeEnabled());
    await userEvent.click(addBtn);
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0]).toMatchObject({ vendorId: 'v1', totalAmount: 2710 });
  });
});
