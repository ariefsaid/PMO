import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: vi.fn() }) }));
import BoqItemFormModal from '../BoqItemFormModal';

const WO = { id: 'wo-1', title: 'Phase 1', wo_number: 'WO-001', status: 'Issued' } as WorkOrderRow;

function renderForm(item: BoqItemRow | null = null) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><BoqItemFormModal item={item} workOrders={[WO]} currencySymbolPrefix="Rp" onClose={vi.fn()} onSave={onSave} onError={vi.fn()} /></ToastProvider>);
  return { onSave, user: userEvent.setup() };
}

async function fill(user: ReturnType<typeof userEvent.setup>, quantity: string, rate: string) {
  await user.type(screen.getByLabelText(/ERP item/), 'SURVEY');
  await user.type(screen.getByLabelText(/Description/), 'Route survey');
  await user.type(screen.getByLabelText(/Unit/), 'km');
  await user.type(screen.getByLabelText(/^Quantity/), quantity);
  await user.type(screen.getByLabelText(/Rate/), rate);
}

describe('BoqItemFormModal', () => {
  it('AC-PB-015 a valid line sends the exact input', async () => {
    const { onSave, user } = renderForm();
    await fill(user, '10', '50000');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onSave).toHaveBeenCalledWith({ itemCode: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50000, workOrderId: null });
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

  it("AC-PB-015 the work order choice is this project's work orders plus none, and is sent", async () => {
    const { onSave, user } = renderForm();
    const select = screen.getByLabelText(/Work order/);
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(['None — the whole contract', 'WO-001 — Phase 1']);
    await fill(user, '10', '50000');
    await user.selectOptions(select, 'wo-1');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ workOrderId: 'wo-1' }));
  });

  it('AC-PB-015 editing seeds the stored line', () => {
    renderForm({ id: 'b1', org_id: 'o', project_id: 'p', work_order_id: null, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50000, created_at: '' } as BoqItemRow);
    expect(screen.getByLabelText(/Description/)).toHaveValue('Route survey');
    expect(screen.getAllByText('Edit bill of quantities line').length).toBeGreaterThan(0);
  });
});
