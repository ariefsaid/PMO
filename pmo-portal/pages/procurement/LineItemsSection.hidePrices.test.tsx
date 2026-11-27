/** AC-009 (#2699) — line items without the line total column or the estimated total when the server hides prices. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { setPricesHidden } from '@/src/lib/priceReadPath';
import { LineItemsSection } from './LineItemsSection';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';

const items = [{ id: 'it1', org_id: 'o', procurement_id: 'p', name: 'MIG welding wire', description: null, quantity: 24, rate: null, amount: null,
  erp_docstatus: null, erp_line_amount: null, erp_modified: null }] as unknown as ProcurementItemRow[];
const renderSection = (over: Partial<React.ComponentProps<typeof LineItemsSection>> = {}) => render(<ToastProvider><LineItemsSection items={items} editable={false} onAdd={vi.fn().mockResolvedValue(undefined)} onUpdate={vi.fn()} onDelete={vi.fn()} onError={vi.fn()} currency="USD" {...over} /></ToastProvider>);
afterEach(() => act(() => setPricesHidden(false)));

describe('AC-009 line items without prices', () => {
  it('shows the Line total column and the estimated total while prices are visible', () => {
    renderSection({ items: [{ ...items[0], rate: 12, amount: 288 }] });
    expect(screen.getAllByText('Line total').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unit price').length).toBeGreaterThan(0);
  });
  it('drops the Line total column and the estimated total when the server hides prices', () => {
    act(() => setPricesHidden(true));
    renderSection();
    expect(screen.queryByText('Line total')).toBeNull();
    expect(screen.queryByText('Unit price')).toBeNull();
    expect(screen.queryByText('Estimated total')).toBeNull();
    expect(screen.getByText('MIG welding wire')).toBeInTheDocument();
  });

  it('leaves the single withheld-price notice to the record money block', () => {
    act(() => setPricesHidden(true));
    renderSection();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByText('Prices are hidden from requesters.')).toBeNull();
  });

  it('formats supplied prices as before', () => {
    renderSection({ items: [{ ...items[0], rate: 12, amount: 288 }] });
    expect(screen.getByText('$12')).toBeVisible();
    expect(screen.getAllByText('$288').length).toBeGreaterThan(0);
    expect(screen.queryByText('Prices are hidden from requesters.')).toBeNull();
  });

  it('DD-R1125-16 a requester whose prices are hidden adds an item and quantity without a price field', async () => {
    act(() => setPricesHidden(true));
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSection({ editable: true, onAdd });
    expect(screen.queryByLabelText('New item unit price')).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New item description'), 'Cable ties');
    await user.type(screen.getByLabelText('New item quantity'), '2');
    await user.click(screen.getByRole('button', { name: /add line item/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cable ties', quantity: 2, rate: null })));
  });
  it('a saved row hides price columns entirely while prices are hidden', () => {
    act(() => setPricesHidden(true));
    const priced = [{ ...items[0], rate: 12000 }] as unknown as ProcurementItemRow[];
    renderSection({ editable: true, items: priced });
    expect(screen.queryByRole('columnheader', { name: 'Unit price' })).toBeNull();
    expect(screen.queryByRole('cell', { name: 'Unknown' })).toBeNull();
    expect(screen.queryByText(/12[.,]000/)).toBeNull();
  });
});
