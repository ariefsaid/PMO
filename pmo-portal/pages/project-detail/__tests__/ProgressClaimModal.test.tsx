import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import ProgressClaimModal, { type ProgressClaimModalProps } from '../ProgressClaimModal';

const line = (id: string, code: string, description: string, unit: string, workOrderId: string | null) =>
  ({ id, org_id: 'o', project_id: 'p', work_order_id: workOrderId, item_code: code, description, unit, quantity: 10, rate: 50000, created_at: '' }) as BoqItemRow;
const BOQ = [line('b1', 'SURVEY', 'Route survey', 'km', null), line('b2', 'STATION', 'Station build', 'unit', 'wo-1')];
const WOS = [
  { id: 'wo-1', title: 'Phase 1', wo_number: 'WO-001', status: 'Issued' },
  { id: 'wo-2', title: 'Not yet issued', wo_number: null, status: 'Draft' },
] as WorkOrderRow[];

function renderModal(overrides: Partial<ProgressClaimModalProps> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><ProgressClaimModal boqItems={BOQ} workOrders={WOS} contractNet={1_000_000} currencySymbolPrefix="Rp"
    hasDownPayment={false} claimedByBoqItem={{ b1: 4 }} assessedByBoqItem={{ b1: 6 }} assessmentMonth="2026-09-01"
    onClose={vi.fn()} onSave={onSave} onError={vi.fn()} {...overrides} /></ToastProvider>);
  return { onSave, user: userEvent.setup() };
}
const optionTexts = (label: RegExp) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.textContent);

describe('ProgressClaimModal', () => {
  it('AC-PB-009 a down payment sends the exact amount and percentage, with the proportional percentage as help', async () => {
    const { onSave, user } = renderModal();
    await user.selectOptions(screen.getByLabelText(/Claim type/), 'down_payment');
    await user.type(screen.getByLabelText(/Down payment amount/), '200000');
    expect(screen.getByText('Proportional to the contract: 20%')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Recovered from each claim/), '20');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect(onSave).toHaveBeenCalledWith({ kind: 'down_payment', workOrderId: null, downPaymentAmount: 200000, recoveryPct: 20 });
  });

  it('AC-PB-009 a 0% recovery is refused', async () => {
    const { onSave, user } = renderModal();
    await user.selectOptions(screen.getByLabelText(/Claim type/), 'down_payment');
    await user.type(screen.getByLabelText(/Down payment amount/), '200000');
    await user.type(screen.getByLabelText(/Recovered from each claim/), '0');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect((await screen.findAllByText('Enter a percentage above 0 and at most 100, with at most 3 decimal places')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("AC-PB-009 only the chosen scope's lines are offered, and only billable work orders are scopes", async () => {
    const { user } = renderModal();
    expect(optionTexts(/Bills/)).toEqual(['Lines with no work order', 'WO-001 — Phase 1']);
    expect(screen.getByLabelText(/SURVEY/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/STATION/)).toBeNull();
    await user.selectOptions(screen.getByLabelText(/Bills/), 'wo-1');
    expect(screen.getByLabelText(/STATION/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/SURVEY/)).toBeNull();
  });

  it('AC-PB-009 starting from the latest assessment fills assessed less claimed', async () => {
    const { onSave, user } = renderModal();
    await user.click(screen.getByRole('button', { name: /Start from the .* assessment/ }));
    expect(screen.getByLabelText(/SURVEY/)).toHaveValue('2');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect(onSave).toHaveBeenCalledWith({ kind: 'progress', workOrderId: null, lines: [{ boqItemId: 'b1', quantity: 2 }], recoverRemaining: false });
  });

  it('AC-PB-009 at least one quantity, each with at most 3 decimals, is required', async () => {
    const { onSave, user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect((await screen.findAllByText('Enter a quantity for at least one line')).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText(/SURVEY/), '1.2345');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect((await screen.findAllByText('Each quantity must be above 0 with at most 3 decimal places')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('AC-PB-009 recover the rest is sent when ticked', async () => {
    const { onSave, user } = renderModal({ hasDownPayment: true });
    await user.type(screen.getByLabelText(/SURVEY/), '3');
    await user.click(screen.getByLabelText('Recover the rest of the down payment with this claim'));
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect(onSave).toHaveBeenCalledWith({ kind: 'progress', workOrderId: null, lines: [{ boqItemId: 'b1', quantity: 3 }], recoverRemaining: true });
  });

  it('AC-PB-009 a project with a live down payment is not offered a second one', () => {
    renderModal({ hasDownPayment: true });
    expect(optionTexts(/Claim type/)).toEqual(['Progress — quantities against the bill of quantities']);
  });
});
