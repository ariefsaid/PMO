import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderLineRow } from '@/src/lib/db/workOrderAcceptances';
import type { AllocationFacts, ContractLineFacts } from '@/src/lib/progressBilling';
import ProgressClaimModal, { type ProgressClaimModalProps } from '../ProgressClaimModal';

const line = (id: string, code: string, description: string, unit: string) =>
  ({ id, org_id: 'o', project_id: 'p', earning_basis: 'unit_rate', line_no: null, import_key: null, item_code: code, description, unit, quantity: 10, rate: 50000, created_at: '' }) as BoqItemRow;
const BOQ = [line('b1', 'SURVEY', 'Route survey', 'km'), line('b2', 'STATION', 'Station build', 'unit')];
const alloc = (id: string, woId: string, boqId: string, quantity: number): WorkOrderLineRow =>
  ({ id, org_id: 'o', work_order_id: woId, boq_item_id: boqId, quantity, created_at: '' });
// b2 is ordered on WO-001; b1 is on no work order.
const ALLOCATIONS = [alloc('al1', 'wo-1', 'b2', 5)];
const allocFacts = (woId: string, boqItemId: string, quantity: number, claimedQuantity: number, acceptedQuantity: number | null): AllocationFacts =>
  ({ workOrderId: woId, boqItemId, quantity, claimedQuantity, acceptedQuantity, final: false });
const lineFacts = (boqItemId: string, allocations: AllocationFacts[]): ContractLineFacts =>
  ({ boqItemId, earningBasis: 'unit_rate', lineNo: null, orderedQuantity: 0, acceptedQuantity: 0, closedFinal: 0, earnedQuantity: 0, contractBalance: 0, allocations });
const FACTS = [lineFacts('b1', []), lineFacts('b2', [allocFacts('wo-1', 'b2', 5, 0, null)])];
const WOS = [
  { id: 'wo-1', title: 'Phase 1', wo_number: 'WO-001', status: 'Issued' },
  { id: 'wo-2', title: 'Not yet issued', wo_number: null, status: 'Draft' },
] as WorkOrderRow[];

function renderModal(overrides: Partial<ProgressClaimModalProps> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><ProgressClaimModal boqItems={BOQ} workOrders={WOS} contractNet={1_000_000} currencySymbolPrefix="Rp"
    allocations={ALLOCATIONS} contractLines={FACTS}
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

describe('ProgressClaimModal contract-quantity pre-fill', () => {
  // Synthetic 1,900 line: WO-001 orders 1,000, WO-002 has 50 claimed. All quantities invented.
  const BIG = [{ ...line('b1', 'SURVEY', 'Route survey', 'km'), quantity: 1900 } as BoqItemRow];
  const ORDERS = [alloc('al1', 'wo-1', 'b1', 1000), alloc('al2', 'wo-2', 'b1', 500)];
  const WO2 = [
    { id: 'wo-1', title: 'Phase 1', wo_number: 'WO-001', status: 'Issued' },
    { id: 'wo-2', title: 'Phase 2', wo_number: 'WO-002', status: 'Issued' },
  ] as WorkOrderRow[];
  const facts = (accepted: number | null) => [lineFacts('b1', [allocFacts('wo-1', 'b1', 1000, 100, accepted), allocFacts('wo-2', 'b1', 500, 50, null)])];
  const open = async (over: Partial<ProgressClaimModalProps>) => {
    const r = renderModal({ boqItems: BIG, workOrders: WO2, allocations: ORDERS, claimedByBoqItem: { b1: 150 }, assessedByBoqItem: { b1: 1050 }, ...over });
    await r.user.selectOptions(screen.getByLabelText(/Bills/), 'wo-1');
    return r;
  };

  it('AC-CQ-013 without a BAST the suggestion is min(assessed − all claimed, ordered − claimed on this order)', async () => {
    const { user } = await open({ contractLines: facts(null) });
    await user.click(screen.getByRole('button', { name: /Start from the .* assessment/ }));
    expect(screen.getByLabelText(/SURVEY/)).toHaveValue('900');
  });

  it('AC-CQ-013 with a confirmed BAST the suggestion is accepted − claimed on this order, whatever other orders claimed', async () => {
    const { onSave, user } = await open({ contractLines: facts(997) });
    await user.click(screen.getByRole('button', { name: 'Start from the accepted BAST quantities' }));
    expect(screen.getByLabelText(/SURVEY/)).toHaveValue('897');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect(onSave).toHaveBeenCalledWith({ kind: 'progress', workOrderId: 'wo-1', lines: [{ boqItemId: 'b1', quantity: 897 }], recoverRemaining: false });
  });

  it('AC-CQ-013 a BAST of zero is a BAST: nothing is suggested, not the assessment fallback', async () => {
    await open({ contractLines: facts(0) });
    expect(screen.queryByRole('button', { name: /Start from/ })).not.toBeInTheDocument();
  });

  it('AC-CQ-013 non-positive suggestions are omitted and a pre-fill stays editable', async () => {
    const { onSave, user } = await open({ contractLines: facts(100) }); // accepted 100 − claimed 100 = 0
    expect(screen.queryByRole('button', { name: /Start from/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/SURVEY/), '12.5');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ boqItemId: 'b1', quantity: 12.5 }] }));
  });

  it('AC-CQ-013 the no-work-order scope offers only lines that no work order ever allocated', () => {
    renderModal({ boqItems: BIG, workOrders: WO2, allocations: ORDERS, contractLines: facts(null) });
    expect(screen.getByText('No bill of quantities lines in this scope.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/SURVEY/)).toBeNull();
  });
});

describe('AC-CQ-014 ProgressClaimModal lump-sum percent (DD-CQ-1)', () => {
  const LUMP = { ...line('l1', 'MOBILISE', 'Mobilisation', 'lot'), earning_basis: 'lump_sum', quantity: 1 } as BoqItemRow;
  const FACTS_L = [{ ...lineFacts('l1', [allocFacts('wo-1', 'l1', 1, 0, null)]), earningBasis: 'lump_sum' as const }];
  const setup = () => renderModal({
    boqItems: [LUMP, BOQ[0]], allocations: [alloc('al9', 'wo-1', 'l1', 1)], contractLines: FACTS_L,
    claimedByBoqItem: {}, assessedByBoqItem: { l1: 0.4 },
  });

  it('AC-CQ-014 the pre-filled fraction 0.4 shows as 40 percent', async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText(/Bills/), 'wo-1');
    expect(screen.getByLabelText(/MOBILISE.*%/)).toHaveValue('');
    await user.click(screen.getByRole('button', { name: /Start from the .* assessment/ }));
    expect(screen.getByLabelText(/MOBILISE.*%/)).toHaveValue('40');
  });

  it('AC-CQ-014 typing 40 sends the 0.4 fraction', async () => {
    const { onSave, user } = setup();
    await user.selectOptions(screen.getByLabelText(/Bills/), 'wo-1');
    await user.type(screen.getByLabelText(/MOBILISE.*%/), '40');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect(onSave).toHaveBeenCalledWith({ kind: 'progress', workOrderId: 'wo-1', lines: [{ boqItemId: 'l1', quantity: 0.4 }], recoverRemaining: false });
  });

  it.each(['100.1', '40.01', '0'])('AC-CQ-014 %s percent is refused with an inline error', async (value) => {
    const { onSave, user } = setup();
    await user.selectOptions(screen.getByLabelText(/Bills/), 'wo-1');
    await user.type(screen.getByLabelText(/MOBILISE.*%/), value);
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect((await screen.findAllByText('Enter a percentage above 0 and up to 100 with at most 1 decimal place')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });
});
