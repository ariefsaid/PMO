import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

// FK options come from the cached hook ("hooks own data fetching"); mock it so
// the vendor Combobox has a selectable option without a QueryClient/network.
vi.mock('@/src/hooks/useFkOptions', () => ({
  useVendorOptions: () => ({
    data: [
      { value: 'v1', label: 'Apex Supply', sub: 'Vendor' },
      { value: 'v2', label: 'Bolt Co', sub: 'Vendor' },
    ],
  }),
}));

import { QuotationsSection } from './QuotationsSection';
import type { Tables } from '@/src/lib/supabase/database.types';

type Q = Tables<'procurement_quotations'>;
const quotes: Q[] = [
  {
    id: 'q1', org_id: 'o', procurement_id: 'p', vendor_id: 'v1', total_amount: 2710,
    received_date: '2026-06-01', is_selected: true, reference: null, vq_number: 'VQ-1', file_url: null,
  },
  {
    id: 'q2', org_id: 'o', procurement_id: 'p', vendor_id: 'v2', total_amount: 2944,
    received_date: '2026-06-01', is_selected: false, reference: null, vq_number: 'VQ-2', file_url: null,
  },
];

function renderSection(props: Partial<React.ComponentProps<typeof QuotationsSection>> = {}) {
  const onAdd = props.onAdd ?? vi.fn().mockResolvedValue(undefined);
  const onSelect = props.onSelect ?? vi.fn().mockResolvedValue(undefined);
  const onError = props.onError ?? vi.fn();
  render(
    <ToastProvider>
      <QuotationsSection
        quotations={props.quotations ?? quotes}
        canAdd={props.canAdd ?? true}
        canSelect={props.canSelect ?? true}
        onAdd={onAdd}
        onSelect={onSelect}
        onError={onError}
      />
    </ToastProvider>,
  );
  return { onAdd, onSelect, onError };
}

beforeEach(() => vi.clearAllMocks());

describe('AC-PROC-004 QuotationsSection (entry + select-quote)', () => {
  it('AC-PROC-004: shows the Selected pill on the selected quote, no Select action on it', () => {
    renderSection();
    expect(screen.getByText('Selected')).toBeInTheDocument();
    // The selected quote (VQ-1) has no Select-quote button; the unselected one does.
    expect(screen.getByRole('button', { name: /select quote vq-2/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /select quote vq-1/i })).toBeNull();
  });

  it('AC-PROC-004: clicking Select quote confirms then delegates the RPC with the quote id', async () => {
    const { onSelect } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: /select quote vq-2/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^select quote$/i }));
    expect(onSelect).toHaveBeenCalledWith('q2');
  });

  it('AC-PROC-004: Select-quote actions are hidden when canSelect is false', () => {
    renderSection({ canSelect: false });
    expect(screen.queryByRole('button', { name: /select quote/i })).toBeNull();
  });

  it('AC-PROC-004: the Add-quotation entry opens + Add is disabled until vendor + total set', async () => {
    renderSection({ quotations: [] });
    await userEvent.click(screen.getByTestId('add-quotation'));
    const form = screen.getByTestId('add-quotation-form');
    // The disabled "Attach file" affordance is present (Storage deferred), not a broken control.
    expect(within(form).getByTitle(/file upload coming soon/i)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: /add quotation/i })).toBeDisabled();
  });

  it('AC-PROC-004: the Add-quotation entry is hidden when canAdd is false', () => {
    renderSection({ canAdd: false });
    expect(screen.queryByTestId('add-quotation')).toBeNull();
  });

  // ── Add-quote submit (vendor + total → onAdd) ──────────────────────────────
  it('AC-PROC-004: a filled Add-quotation entry enables + submits the vendor, parsed total, and a received date', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSection({ quotations: [], onAdd });
    await userEvent.click(screen.getByTestId('add-quotation'));
    const form = screen.getByTestId('add-quotation-form');

    // Pick a vendor from the FK Combobox.
    await userEvent.click(within(form).getByRole('combobox', { name: /vendor/i }));
    await userEvent.click(await screen.findByRole('option', { name: /apex supply/i }));

    // Enter the quoted total (comma-formatted to assert parsing).
    await userEvent.type(within(form).getByLabelText(/quoted total/i), '2,710');

    const addBtn = within(form).getByRole('button', { name: /add quotation/i });
    await waitFor(() => expect(addBtn).toBeEnabled());
    await userEvent.click(addBtn);

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const arg = onAdd.mock.calls[0][0];
    expect(arg.vendorId).toBe('v1');
    expect(arg.totalAmount).toBe(2710);
    expect(arg.receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // ── Error routing — both mutations surface failures via onError ────────────
  it('AC-PROC-004: an add-quote failure is routed to onError (classified by the caller)', async () => {
    const boom = new Error('insert failed');
    const onAdd = vi.fn().mockRejectedValue(boom);
    const { onError } = renderSection({ quotations: [], onAdd });
    await userEvent.click(screen.getByTestId('add-quotation'));
    const form = screen.getByTestId('add-quotation-form');
    await userEvent.click(within(form).getByRole('combobox', { name: /vendor/i }));
    await userEvent.click(await screen.findByRole('option', { name: /apex supply/i }));
    await userEvent.type(within(form).getByLabelText(/quoted total/i), '500');
    await userEvent.click(within(form).getByRole('button', { name: /add quotation/i }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
  });

  it('AC-PROC-004: a select-quote failure is routed to onError', async () => {
    const boom = new Error('wrong stage');
    const onSelect = vi.fn().mockRejectedValue(boom);
    const { onError } = renderSection({ onSelect });
    await userEvent.click(screen.getByRole('button', { name: /select quote vq-2/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^select quote$/i }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
  });
});
