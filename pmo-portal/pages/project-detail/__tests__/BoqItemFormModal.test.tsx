import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
const catalogue = vi.hoisted(() => ({ listItems: vi.fn(), listRates: vi.fn(), listVariants: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { rateCatalogue: catalogue } }));
const erp = vi.hoisted(() => ({ connected: false }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: erp.connected, loadOptions: vi.fn() }) }));
import BoqItemFormModal from '../BoqItemFormModal';

function renderForm(item: BoqItemRow | null = null) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><BoqItemFormModal item={item} currencySymbolPrefix="Rp" onClose={vi.fn()} onSave={onSave} onError={vi.fn()} /></ToastProvider>);
  return { onSave, user: userEvent.setup() };
}

async function fill(user: ReturnType<typeof userEvent.setup>, quantity: string, rate: string) {
  await user.type(screen.getByLabelText(/Item code/), 'SURVEY');
  await user.type(screen.getByLabelText(/Description/), 'Route survey');
  await user.type(screen.getByLabelText(/Unit/), 'km');
  await user.type(screen.getByLabelText(/^Quantity/), quantity);
  await user.type(screen.getByLabelText(/Rate/), rate);
}

describe('BoqItemFormModal', () => {
  it('fix-billing item 5: picking a catalogue rate arrives filled, the label follows the accounting connection, and an existing line is offered first', async () => {
    catalogue.listItems.mockResolvedValue([{ id: 'i', item_code: 'W1', description: 'Weld joint', unit: 'pcs' }]);
    catalogue.listVariants.mockResolvedValue([{ id: 'v', name: 'Remote', is_default: true }]);
    catalogue.listRates.mockResolvedValue([{ item_id: 'i', variant_id: 'v', rate: 120, effective_from: '2026-01-01' }]);
    const onEditExisting = vi.fn();
    const existing = { id: 'b1', item_code: 'W1', catalogue_item_id: 'i', description: 'Weld joint', unit: 'pcs' } as unknown as BoqItemRow;
    render(<ToastProvider><BoqItemFormModal item={null} existingLines={[existing]} onEditExisting={onEditExisting} currencySymbolPrefix="$" projectId="p" today="2026-02-01" currency="USD" onClose={vi.fn()} onSave={vi.fn()} onError={vi.fn()} /></ToastProvider>);
    const user = userEvent.setup();
    expect(screen.queryByLabelText(/ERP item/)).not.toBeInTheDocument();
    await user.click(await screen.findByRole('combobox', { name: 'Catalogue item' }));
    await user.click(await screen.findByText(/W1/));
    expect(await screen.findByLabelText(/Item code/)).toHaveValue('W1');
    expect(screen.getByLabelText(/Description/)).toHaveValue('Weld joint');
    expect(screen.getByLabelText(/Unit/)).toHaveValue('pcs');
    await user.click(await screen.findByRole('button', { name: 'Edit that line' }));
    expect(onEditExisting).toHaveBeenCalledWith(existing);
  });

  it('fix-billing item 5: with an accounting system connected the item field is the accounting item', () => {
    erp.connected = true;
    try {
      renderForm();
      expect(screen.getByText('ERP item')).toBeInTheDocument();
    } finally { erp.connected = false; }
  });

  it('explains an unpriced rate beside the rate field and retries the lookup', async () => {
    catalogue.listItems.mockResolvedValue([{ id: 'i', item_code: 'W1', description: 'Weld' }]);
    catalogue.listVariants.mockResolvedValue([{ id: 'v', name: 'Remote', is_default: true }]);
    catalogue.listRates.mockResolvedValueOnce([]).mockResolvedValue([{ item_id: 'i', variant_id: 'v', rate: 120, effective_from: '2026-01-01' }]);
    render(<ToastProvider><BoqItemFormModal item={null} currencySymbolPrefix="$" projectId="p" today="2026-02-01" currency="USD" onClose={vi.fn()} onSave={vi.fn()} onError={vi.fn()} /></ToastProvider>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Catalogue item' }));
    await user.click(await screen.findByText(/W1/));
    const status = await screen.findByText(/No rate for this location on this date/);
    expect(status.parentElement?.parentElement).toContainElement(screen.getByLabelText(/Rate \(excl/));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText(/Rate \(excl/)).toHaveValue('120');
  });

  it('AC-PB-015 a valid line sends the exact input', async () => {
    const { onSave, user } = renderForm();
    await fill(user, '10', '50000');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onSave).toHaveBeenCalledWith({ itemCode: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50000, earningBasis: 'unit_rate', lineNo: null });
  });

  it('AC-PB-015 a quantity with 4 decimals is refused', async () => {
    const { onSave, user } = renderForm();
    await fill(user, '1.2345', '50000');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect((await screen.findAllByText('Enter a quantity above 0 with at most 3 decimal places')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('AC-PB-015 a negative rate is refused', async () => {
    const { onSave, user } = renderForm();
    await fill(user, '10', '-1');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect((await screen.findAllByText('Enter a rate of 0 or more with at most 2 decimal places')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('AC-PB-015 a line is no longer tied to one work order: there is no work order picker', () => {
    renderForm();
    expect(screen.queryByLabelText(/Work order/)).not.toBeInTheDocument();
  });

  it('AC-PB-015 editing seeds the stored line', () => {
    renderForm({ id: 'b1', org_id: 'o', project_id: 'p', earning_basis: 'unit_rate', line_no: null, import_key: null, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50000, created_at: '' } as BoqItemRow);
    expect(screen.getByLabelText(/Description/)).toHaveValue('Route survey');
    expect(screen.getAllByText('Edit bill of quantities line').length).toBeGreaterThan(0);
  });
});
