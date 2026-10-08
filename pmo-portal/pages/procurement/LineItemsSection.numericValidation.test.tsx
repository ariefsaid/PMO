/**
 * AC-W3-NUM-002 — LineItemsSection: quantity and rate numeric validation.
 *
 * quantity AND rate are required and must parse to a number > 0.
 * Empty / non-numeric / ≤ 0 on either field → inline error on the offending
 * field AND Add (and edit-Save) is blocked (onAdd/onUpdate NOT called).
 * A valid line still adds as today.
 *
 * The inline errors live below the CellInput in the add-row / edit-row — we
 * assert the error text is present in the DOM (role="alert") and the callback
 * was not called.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { LineItemsSection } from './LineItemsSection';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const EN_LOCALE = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

const oneItem: ProcurementItemRow[] = [
  {
    id: 'it1',
    org_id: 'org-1',
    procurement_id: 'pr1',
    name: 'MIG welding wire',
    description: null,
    quantity: 24,
    rate: 86,
    amount: 2064,
    erp_docstatus: null,
    erp_line_amount: null,
    erp_modified: null,
  },
];

function renderSection(props: Partial<React.ComponentProps<typeof LineItemsSection>> = {}) {
  const onAdd = props.onAdd ?? vi.fn().mockResolvedValue(undefined);
  const onUpdate = props.onUpdate ?? vi.fn().mockResolvedValue(undefined);
  const onDelete = props.onDelete ?? vi.fn().mockResolvedValue(undefined);
  const onError = props.onError ?? vi.fn();
  render(
    <ToastProvider>
      <LineItemsSection
        items={props.items ?? []}
        editable={props.editable ?? true}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onError={onError}
        currency={props.currency ?? 'USD'}
      />
    </ToastProvider>,
  );
  return { onAdd, onUpdate, onDelete, onError };
}

beforeEach(() => {
  vi.clearAllMocks();
  setActiveLocale(EN_LOCALE);
});
afterEach(() => resetActiveLocale());

// ── AC-W3-NUM-002 ─────────────────────────────────────────────────────────────

describe('AC-W3-NUM-002 LineItemsSection — quantity/rate numeric validation', () => {
  // ── Add row: quantity validation ──────────────────────────────────────────

  it('AC-W3-NUM-002: non-numeric quantity ("abc") shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), 'abc');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '10');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));
    // An inline error must appear in this add row.
    expect(within(row).getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-002: zero quantity ("0") shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '0');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '10');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));
    expect(within(row).getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-002: negative quantity ("-1") shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '-1');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '10');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));
    expect(within(row).getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-002: empty quantity (only name + rate) shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    // quantity left blank
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '10');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));
    expect(within(row).getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  // ── Add row: rate validation ──────────────────────────────────────────────

  it('AC-W3-NUM-002: non-numeric rate ("xyz") shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '5');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), 'xyz');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));
    expect(within(row).getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-002: zero rate ("0") shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '5');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '0');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));
    expect(within(row).getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-002: empty rate (only name + qty) shows inline error and blocks onAdd', async () => {
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '5');
    // rate left blank
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));
    expect(within(row).getByRole('alert')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  // ── Add row: valid input (regression guard) ───────────────────────────────

  it('AC-W3-NUM-002: valid qty + rate → onAdd called with correct parsed numbers (regression)', async () => {
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Shielding gas');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '6');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '142.50');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));
    expect(within(row).getByLabelText(/new item quantity/i)).not.toHaveAttribute('aria-invalid', 'true');
    expect(within(row).getByLabelText(/new item unit price/i)).not.toHaveAttribute('aria-invalid', 'true');
    expect(onAdd).toHaveBeenCalledWith({ name: 'Shielding gas', quantity: 6, rate: 142.5 });
  });

  it('AC-PLC-009: rejects an en-US line-item rate with excess precision before adding', async () => {
    setActiveLocale(EN_LOCALE);
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '5');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '1.234');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));

    expect(within(row).getByRole('alert')).toHaveTextContent(/unit price|decimal/i);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: persists id-ID grouped line-item rate as 1234', async () => {
    setActiveLocale(ID_LOCALE);
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '5');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '1.234');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));

    expect(onAdd).toHaveBeenCalledWith({ name: 'Bolts', quantity: 5, rate: 1234 });
  });

  it.each(['0.005', '1.234'])(
    'AC-PLC-009: rejects an en-US line-item quantity %s with excess precision before adding',
    async (qtyRaw) => {
      setActiveLocale(EN_LOCALE);
      const { onAdd } = renderSection();
      const row = screen.getByTestId('line-item-add-row');
      await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
      await userEvent.type(within(row).getByLabelText(/new item quantity/i), qtyRaw);
      await userEvent.type(within(row).getByLabelText(/new item unit price/i), '10');
      await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));

      expect(within(row).getByRole('alert')).toHaveTextContent(/quantity/i);
      expect(onAdd).not.toHaveBeenCalled();
    },
  );

  it('AC-PLC-009: persists id-ID grouped line-item quantity 1.234 as 1234', async () => {
    setActiveLocale(ID_LOCALE);
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '1.234');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '5');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));

    expect(within(row).getByLabelText(/new item quantity/i)).not.toHaveAttribute('aria-invalid', 'true');
    expect(within(row).getByLabelText(/new item unit price/i)).not.toHaveAttribute('aria-invalid', 'true');
    expect(onAdd).toHaveBeenCalledWith({ name: 'Bolts', quantity: 1234, rate: 5 });
  });

  it('AC-PLC-009: rejects an en-US edit-row quantity with excess precision before saving', async () => {
    setActiveLocale(EN_LOCALE);
    const { onUpdate } = renderSection({ items: oneItem });
    await userEvent.click(screen.getByRole('button', { name: /edit mig welding wire/i }));
    const qty = screen.getByLabelText(/edit quantity for mig welding wire/i);
    await userEvent.clear(qty);
    await userEvent.type(qty, '0.005');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(within(qty.closest('tr')!).getByRole('alert')).toHaveTextContent(/quantity/i);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  // ── Edit row: Save gated on valid qty + rate ──────────────────────────────

  it('AC-W3-NUM-002: invalid quantity in edit-row blocks onUpdate', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <LineItemsSection
          items={oneItem}
          editable
          onAdd={vi.fn()}
          onUpdate={onUpdate}
          onDelete={vi.fn()}
          onError={vi.fn()}
          currency="USD"
        />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /edit mig welding wire/i }));
    const qty = screen.getByLabelText(/edit quantity for mig welding wire/i);
    await userEvent.clear(qty);
    await userEvent.type(qty, 'bad');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(within(qty.closest('tr')!).getByRole('alert')).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: an id-ID viewer re-saves an existing fractional line unchanged', async () => {
    setActiveLocale(ID_LOCALE);
    const { onUpdate } = renderSection({ items: [{ ...oneItem[0], quantity: 2.5, rate: 1234.5 }] });
    await userEvent.click(screen.getByRole('button', { name: /edit mig welding wire/i }));
    expect(screen.getByLabelText(/edit unit price for mig welding wire/i)).toHaveValue('1.234,5');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onUpdate).toHaveBeenCalledWith('it1', { name: 'MIG welding wire', quantity: 2.5, rate: 1234.5 });
  });

  it('AC-W3-NUM-002: invalid rate in edit-row blocks onUpdate', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <LineItemsSection
          items={oneItem}
          editable
          onAdd={vi.fn()}
          onUpdate={onUpdate}
          onDelete={vi.fn()}
          onError={vi.fn()}
          currency="USD"
        />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /edit mig welding wire/i }));
    const rate = screen.getByLabelText(/edit unit price for mig welding wire/i);
    await userEvent.clear(rate);
    await userEvent.type(rate, '0');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(within(rate.closest('tr')!).getByRole('alert')).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('#684 AC-PLC-010: LineItemsSection distinguishes a FORMAT mistake from a real precision loss', () => {
  it('under id-ID, English-style separators (1,234.56) report the SEPARATOR mistake, not "2 decimal places"', async () => {
    setActiveLocale(ID_LOCALE);
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '5');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '1,234.56');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));

    expect(await screen.findByText(/for example 1\.234,56/i)).toBeInTheDocument();
    expect(screen.queryByText(/no more than 2 decimal places/i)).not.toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('under en-US, id-ID-style separators (1.234,56) report the SEPARATOR mistake, not the precision message', async () => {
    setActiveLocale(EN_LOCALE);
    const { onAdd } = renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Bolts');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '5');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '1.234,56');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));

    expect(await screen.findByText(/for example 1,234\.56/i)).toBeInTheDocument();
    expect(screen.queryByText(/no more than 2 decimal places/i)).not.toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('#684 minor: live line total and unit-price placeholder follow the number convention', () => {
  it('shows "—" (not $0) while the rate cannot be parsed, even with a valid quantity', async () => {
    setActiveLocale(EN_LOCALE);
    renderSection();
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '5');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), 'abc');
    const totalCell = row.querySelector('td:nth-child(4)')!;
    expect(totalCell).toHaveTextContent('—');
    expect(totalCell).not.toHaveTextContent('$0');
  });

  it('the unit-price placeholder uses the id-ID decimal separator', () => {
    setActiveLocale(ID_LOCALE);
    renderSection();
    expect(screen.getByLabelText(/new item unit price/i)).toHaveAttribute('placeholder', '0,00');
  });

  it('the unit-price placeholder uses the en-US decimal separator', () => {
    setActiveLocale(EN_LOCALE);
    renderSection();
    expect(screen.getByLabelText(/new item unit price/i)).toHaveAttribute('placeholder', '0.00');
  });
});
