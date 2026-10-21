import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: vi.fn() }) }));
import BoqItemFormModal from '../BoqItemFormModal';
import ProgressAssessmentModal from '../ProgressAssessmentModal';
import WorkOrderLinesModal from '../WorkOrderLinesModal';
import type { ContractLineFacts } from '@/src/lib/progressBilling';
import type { WorkOrderLineRow } from '@/src/lib/db/workOrderAcceptances';

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

describe('AC-CQ-014 ProgressAssessmentModal lump-sum percent', () => {
  const line = (id: string, code: string, unit: string, basis: 'unit_rate' | 'lump_sum') =>
    ({ id, org_id: 'o', project_id: 'p', earning_basis: basis, line_no: null, import_key: null, item_code: code,
      description: `${code} work`, unit, quantity: basis === 'lump_sum' ? 1 : 10, rate: 1000, created_at: '' }) as BoqItemRow;
  const BOQ = [line('u1', 'SURVEY', 'km', 'unit_rate'), line('l1', 'MOBILISE', 'lot', 'lump_sum')];
  function renderModal(assessed: Record<string, number> = {}) {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ToastProvider><ProgressAssessmentModal boqItems={BOQ} assessedByBoqItem={assessed} defaultMonth="2026-10"
      onClose={vi.fn()} onSave={onSave} onError={vi.fn()} /></ToastProvider>);
    return { onSave, user: userEvent.setup() };
  }
  const submit = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Save progress' }));

  it('AC-CQ-014 a lump-sum line asks for percent and shows the stored fraction as percent', () => {
    renderModal({ l1: 0.4 });
    expect(screen.getByLabelText(/MOBILISE.*% done to date/)).toHaveValue('40');
    expect(screen.getByLabelText(/SURVEY.*done to date \(km\)/)).toHaveValue('');
  });

  it('AC-CQ-014 40.0 percent is sent as the 0.400 fraction and unit-rate lines keep quantities', async () => {
    const { onSave, user } = renderModal();
    await user.type(screen.getByLabelText(/MOBILISE/), '40.0');
    await user.type(screen.getByLabelText(/SURVEY —/), '2.5');
    await submit(user);
    expect(onSave).toHaveBeenCalledWith({
      month: '2026-10-01',
      quantities: [{ boqItemId: 'u1', quantityToDate: 2.5 }, { boqItemId: 'l1', quantityToDate: 0.4 }],
      note: null,
    });
  });

  it('AC-CQ-014 40.1 percent maps to 0.401 without float noise', async () => {
    const { onSave, user } = renderModal();
    await user.type(screen.getByLabelText(/MOBILISE/), '40.1');
    await submit(user);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      quantities: expect.arrayContaining([{ boqItemId: 'l1', quantityToDate: 0.401 }]),
    }));
  });

  it('AC-CQ-014 100 percent is sent as 1', async () => {
    const { onSave, user } = renderModal();
    await user.type(screen.getByLabelText(/MOBILISE/), '100');
    await submit(user);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      quantities: expect.arrayContaining([{ boqItemId: 'l1', quantityToDate: 1 }]),
    }));
  });

  it.each(['40.01', '100.1', '-1'])('AC-CQ-014 %s percent is refused', async (value) => {
    const { onSave, user } = renderModal();
    await user.type(screen.getByLabelText(/MOBILISE/), value);
    await submit(user);
    expect((await screen.findAllByText('Enter a percentage from 0 to 100 with at most 1 decimal place')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('AC-CQ-014 WorkOrderLinesModal allocation editor', () => {
  const line = (id: string, code: string, unit: string, quantity: number) =>
    ({ id, org_id: 'o', project_id: 'p', earning_basis: 'unit_rate', line_no: null, import_key: null, item_code: code,
      description: `${code} work`, unit, quantity, rate: 50000, created_at: '' }) as BoqItemRow;
  const BOQ = [line('b1', 'SURVEY', 'km', 1900), line('b2', 'STATION', 'unit', 5)];
  const facts = (id: string, balance: number): ContractLineFacts => ({
    boqItemId: id, earningBasis: 'unit_rate', lineNo: null, orderedQuantity: 0, acceptedQuantity: 0, closedFinal: 0,
    earnedQuantity: 0, contractBalance: balance, allocations: [],
  });
  const FACTS = [facts('b1', 900), facts('b2', 5)];
  const own: WorkOrderLineRow = { id: 'l1', org_id: 'o', work_order_id: 'wo-1', boq_item_id: 'b1', quantity: 1000, created_at: '' };
  const WO = { id: 'wo-1', wo_number: 'WO-001', title: 'Phase 1', status: 'Issued' };

  function renderModal(over: Partial<React.ComponentProps<typeof WorkOrderLinesModal>> = {}) {
    const fns = {
      onCreate: vi.fn().mockResolvedValue(undefined), onUpdate: vi.fn().mockResolvedValue(undefined),
      onDelete: vi.fn().mockResolvedValue(undefined), onError: vi.fn(), onClose: vi.fn(),
    };
    render(<ToastProvider><WorkOrderLinesModal workOrder={WO} boqItems={BOQ} contractLines={FACTS} allocations={[own]} canEdit
      {...fns} {...over} /></ToastProvider>);
    return { ...fns, user: userEvent.setup() };
  }

  it('AC-CQ-014 each line shows its contract balance and this order\'s quantity', () => {
    renderModal();
    expect(screen.getByLabelText(/SURVEY —/)).toHaveValue('1,000');
    expect(screen.getByLabelText(/STATION —/)).toHaveValue('');
    expect(screen.getByTestId('lines-balance-b1')).toHaveTextContent('900');
    expect(screen.getByTestId('lines-balance-b2')).toHaveTextContent('5');
  });

  it('AC-CQ-014 a new allocation is created one row at a time and an existing one is updated', async () => {
    const { onCreate, onUpdate, user } = renderModal();
    await user.type(screen.getByLabelText(/STATION —/), '2');
    await user.click(screen.getByRole('button', { name: 'Save STATION' }));
    expect(onCreate).toHaveBeenCalledWith('b2', 2);
    const survey = screen.getByLabelText(/SURVEY —/);
    await user.clear(survey);
    await user.type(survey, '950');
    await user.click(screen.getByRole('button', { name: 'Save SURVEY' }));
    expect(onUpdate).toHaveBeenCalledWith('l1', 950);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('AC-CQ-014 over-ordering is warned in words but still saves', async () => {
    const { onCreate, user } = renderModal();
    await user.type(screen.getByLabelText(/STATION —/), '6');
    expect(screen.getByText(/Over-ordered by 1 unit/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save STATION' }));
    expect(onCreate).toHaveBeenCalledWith('b2', 6);
  });

  it('AC-CQ-014 an Issued order\'s own allocation counts as available to itself', async () => {
    renderModal();
    const survey = screen.getByLabelText(/SURVEY —/);
    await userEvent.setup().clear(survey);
    await userEvent.setup().type(survey, '1,900');
    expect(screen.queryByText(/Over-ordered/)).not.toBeInTheDocument();
  });

  it.each(['0', '1.2345', ''])('AC-CQ-014 a quantity of "%s" is refused without a call', async (value) => {
    const { onCreate, onUpdate, user } = renderModal();
    const station = screen.getByLabelText(/STATION —/);
    if (value) await user.type(station, value);
    await user.click(screen.getByRole('button', { name: 'Save STATION' }));
    expect(await screen.findByText('Enter a quantity above 0 with at most 3 decimal places')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('AC-CQ-014 a refused save stays on the row with the typed value and the server wording', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('this work order is closed'));
    const { onError, user } = renderModal({ onCreate });
    await user.type(screen.getByLabelText(/STATION —/), '2');
    await user.click(screen.getByRole('button', { name: 'Save STATION' }));
    const rowError = (await screen.findAllByRole('alert')).find((node) => node.textContent?.includes('closed'));
    expect(rowError).toBeDefined();
    expect(screen.getByLabelText(/STATION —/)).toHaveValue('2');
    expect(onError).toHaveBeenCalled();
  });

  it('AC-CQ-014 removing an allocation asks first, then deletes that row only', async () => {
    const { onDelete, user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Remove SURVEY' }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove allocation' }));
    expect(onDelete).toHaveBeenCalledWith('l1');
  });

  it.each([
    ['without permission', { canEdit: false }],
    ['on a closed work order', { workOrder: { ...WO, status: 'Closed' } }],
  ])('AC-CQ-014 %s the editor is read-only', (_name, over) => {
    renderModal(over as never);
    expect(screen.getByTestId('lines-readonly-b1')).toHaveTextContent('1,000');
    expect(screen.queryByRole('button', { name: /^Save / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
  });
});
