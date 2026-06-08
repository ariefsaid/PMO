import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { LineItemsSection } from './LineItemsSection';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';

const items: ProcurementItemRow[] = [
  {
    id: 'it1',
    org_id: 'org-1',
    procurement_id: 'pr1',
    name: 'MIG welding wire',
    description: null,
    quantity: 24,
    rate: 86,
    amount: 2064,
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
        items={props.items ?? items}
        editable={props.editable ?? true}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onError={onError}
      />
    </ToastProvider>,
  );
  return { onAdd, onUpdate, onDelete, onError };
}

beforeEach(() => vi.clearAllMocks());

describe('AC-PROC-003 LineItemsSection (editable line-items table)', () => {
  it('AC-PROC-003: renders rows with a derived line total + footer total (tabular)', () => {
    renderSection();
    expect(screen.getByText('MIG welding wire')).toBeInTheDocument();
    // Line total + footer total both render the formatted amount (USD, no fraction digits).
    expect(screen.getAllByText(/\$2,064/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Estimated total')).toBeInTheDocument();
  });

  it('AC-PROC-003: empty state teaches when there are no items (editable)', () => {
    renderSection({ items: [] });
    expect(screen.getByText(/No line items yet/i)).toBeInTheDocument();
  });

  it('AC-PROC-003: the inline add-row creates an item with parsed qty × rate', async () => {
    const { onAdd } = renderSection({ items: [] });
    const row = screen.getByTestId('line-item-add-row');
    await userEvent.type(within(row).getByLabelText(/new item description/i), 'Shielding gas');
    await userEvent.type(within(row).getByLabelText(/new item quantity/i), '6');
    await userEvent.type(within(row).getByLabelText(/new item unit price/i), '142.50');
    await userEvent.click(within(row).getByRole('button', { name: /add line item/i }));
    expect(onAdd).toHaveBeenCalledWith({ name: 'Shielding gas', quantity: 6, rate: 142.5 });
  });

  it('AC-PROC-003: Add is disabled until a description is entered', () => {
    renderSection({ items: [] });
    const row = screen.getByTestId('line-item-add-row');
    expect(within(row).getByRole('button', { name: /add line item/i })).toBeDisabled();
  });

  it('AC-PROC-003: Edit flips the row to inputs and Save delegates the patch', async () => {
    const { onUpdate } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: /edit mig welding wire/i }));
    const qty = screen.getByLabelText(/edit quantity for mig welding wire/i);
    await userEvent.clear(qty);
    await userEvent.type(qty, '30');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onUpdate).toHaveBeenCalledWith('it1', { name: 'MIG welding wire', quantity: 30, rate: 86 });
  });

  it('AC-PROC-003: Remove opens a destructive confirm, then delegates the delete', async () => {
    const { onDelete } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: /remove mig welding wire/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /remove item/i }));
    expect(onDelete).toHaveBeenCalledWith('it1');
  });

  it('AC-PROC-003: read-only mode shows static rows with NO add/edit/delete chrome', () => {
    renderSection({ editable: false });
    expect(screen.getByText('MIG welding wire')).toBeInTheDocument();
    expect(screen.queryByTestId('line-item-add-row')).toBeNull();
    expect(screen.queryByRole('button', { name: /edit mig welding wire/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove mig welding wire/i })).toBeNull();
  });
});
