import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: vi.fn() }) }));
import BoqItemFormModal from '../BoqItemFormModal';

/**
 * AC-CQ-014 — the contract-quantity dialogs (ADR-0090): BoQ line basis, percent assessment, allocation,
 * claim pre-fill and BAST preparation. Synthetic data only.
 */
describe('AC-CQ-014 BoqItemFormModal earning basis', () => {
  function renderForm(item: BoqItemRow | null = null) {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ToastProvider><BoqItemFormModal item={item} currencySymbolPrefix="Rp" onClose={vi.fn()} onSave={onSave} onError={vi.fn()} /></ToastProvider>);
    return { onSave, user: userEvent.setup() };
  }
  const base = async (user: ReturnType<typeof userEvent.setup>, unit: string) => {
    await user.type(screen.getByLabelText(/ERP item/), 'LINE-1');
    await user.type(screen.getByLabelText(/Description/), 'Synthetic line');
    await user.type(screen.getByLabelText(/^Unit/), unit);
    await user.type(screen.getByLabelText(/Rate/), '50000');
  };
  const basis = () => screen.getByLabelText(/Earned by/) as HTMLSelectElement;

  it('AC-CQ-014 a unit-priced unit defaults to unit rate and sends its quantity', async () => {
    const { onSave, user } = renderForm();
    await base(user, 'km');
    await user.type(screen.getByLabelText(/^Quantity/), '1900');
    expect(basis().value).toBe('unit_rate');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ unit: 'km', quantity: 1900, earningBasis: 'unit_rate', lineNo: null }));
  });

  it('AC-CQ-014 a lot unit defaults to lump sum, hides the quantity and sends exactly 1', async () => {
    const { onSave, user } = renderForm();
    await base(user, 'Lot');
    expect(basis().value).toBe('lump_sum');
    expect(screen.queryByLabelText(/^Quantity/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ unit: 'Lot', quantity: 1, earningBasis: 'lump_sum' }));
  });

  it('AC-CQ-014 an explicit basis choice survives later unit edits', async () => {
    const { onSave, user } = renderForm();
    await base(user, 'lot');
    await user.selectOptions(basis(), 'unit_rate');
    expect(screen.getByLabelText(/^Quantity/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Unit/), 's');
    expect(basis().value).toBe('unit_rate');
    await user.type(screen.getByLabelText(/^Quantity/), '3');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ earningBasis: 'unit_rate', quantity: 3 }));
  });

  it('AC-CQ-014 the optional line number is sent as a whole number and edit keeps the stored basis', async () => {
    const { onSave, user } = renderForm({
      id: 'b1', org_id: 'o', project_id: 'p', earning_basis: 'lump_sum', line_no: 7, import_key: null, item_code: 'SITE',
      description: 'Site works', unit: 'item', quantity: 1, rate: 1000, created_at: '',
    } as BoqItemRow);
    expect(basis().value).toBe('lump_sum');
    expect(screen.getByLabelText(/Line no/)).toHaveValue('7');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ earningBasis: 'lump_sum', quantity: 1, lineNo: 7 }));
  });

  it('AC-CQ-014 a non-integer line number is refused', async () => {
    const { onSave, user } = renderForm();
    await base(user, 'km');
    await user.type(screen.getByLabelText(/^Quantity/), '1');
    await user.type(screen.getByLabelText(/Line no/), '1.5');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect((await screen.findAllByText('Enter a whole line number, or leave it blank')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });
});
