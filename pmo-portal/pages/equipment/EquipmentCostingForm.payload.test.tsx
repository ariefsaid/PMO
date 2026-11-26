import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { resetActiveLocale, setActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';
import type { EquipmentAssetRow, EquipmentCostingRow } from '@/src/lib/db/equipment';
import { EquipmentCostingForm } from './EquipmentCostingForm';

const h = vi.hoisted(() => ({
  preview: { mutateAsync: vi.fn(), isPending: false },
  save: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/hooks/useEquipment', () => ({ usePreviewCosting: () => h.preview, useSaveCosting: () => h.save }));

const asset = { id: 'a1', code: 'EX-200', name: 'Excavator 200', default_unit: 'hours', org_id: 'o1' } as unknown as EquipmentAssetRow;
const existing = {
  setting_key: 'k1', version: 4, basis: 'hire_rate', work_rate: 120, standby_rate: 40, rate_unit: 'days',
  match_account: '', match_account_group: '', match_cost_center: '', match_party_type: '', match_party: '',
  effective_from: '2026-01-01', effective_to: null, count_standby: false, is_current: true, voided: false,
} as unknown as EquipmentCostingRow;

const mount = (current?: EquipmentCostingRow, onClose = vi.fn()) => {
  render(
    <ToastProvider>
      <EquipmentCostingForm asset={asset} current={current} projectName={(id) => `Project ${id}`} money={(n) => `Rp ${n}`} onClose={onClose} />
    </ToastProvider>,
  );
  return onClose;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 18, 12) });
  h.preview.mutateAsync.mockReset().mockResolvedValue([]);
  h.save.mutateAsync.mockReset().mockResolvedValue({ setting_key: 'k', version: 1, changed: true });
});
afterEach(() => vi.useRealTimers());

describe('#2544 EquipmentCostingForm payloads', () => {
  it('#2544 a hire-rate costing saves the typed rates and unit, effective from the start of this month, and closes', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    const onClose = mount();
    await user.click(screen.getByRole('radio', { name: 'Hire rate' }));
    await user.type(screen.getByLabelText(/Work rate per unit/), '150,5');
    await user.type(screen.getByLabelText(/Standby rate per unit/), '60');
    await user.selectOptions(screen.getByLabelText('Rate per'), 'days');
    await user.click(screen.getByRole('button', { name: 'Save costing' }));
    expect(h.save.mutateAsync).toHaveBeenCalledWith({
      asset_id: 'a1', basis: 'hire_rate', effective_from: '2026-11-01', effective_to: null,
      work_rate: 150.5, standby_rate: 60, rate_unit: 'days',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('#1126 the effective-from month starts on the organisation\'s month, not the browser\'s', async () => {
    vi.setSystemTime(new Date('2026-11-30T18:00:00Z'));
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    setActiveOrgTimezone('Asia/Jakarta');
    const user = userEvent.setup({ advanceTimers: () => {} });
    try {
      mount();
      await user.click(screen.getByRole('radio', { name: 'Hire rate' }));
      await user.type(screen.getByLabelText(/Work rate per unit/), '100');
      await user.click(screen.getByRole('button', { name: 'Save costing' }));
      expect(h.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ effective_from: '2026-12-01' }));
    } finally {
      resetActiveLocale();
    }
  });

  it('#2544 save stays disabled until a hire rate above zero is entered', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mount();
    await user.click(screen.getByRole('radio', { name: 'Hire rate' }));
    expect(screen.getByRole('button', { name: 'Save costing' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Work rate per unit/), '0');
    expect(screen.getByRole('button', { name: 'Save costing' })).toBeDisabled();
    await user.clear(screen.getByLabelText(/Work rate per unit/));
    await user.type(screen.getByLabelText(/Work rate per unit/), '10');
    expect(screen.getByRole('button', { name: 'Save costing' })).toBeEnabled();
  });

  it('#2544 an actual-cost costing saves the trimmed ledger account, blank optional fields as null, the driver and usage unit', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mount();
    expect(screen.getByRole('radio', { name: 'Actual cost by usage' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save costing' })).toBeDisabled(); // needs an account or group
    await user.type(screen.getByLabelText('Ledger account'), '  5100 Plant costs ');
    await user.type(screen.getByLabelText('Cost centre (optional)'), 'CC-7');
    await user.selectOptions(screen.getByLabelText('Count usage in'), 'days');
    await user.click(screen.getByLabelText('Count standby toward the share', { selector: 'input[type="checkbox"], [role="checkbox"]' }));
    await user.click(screen.getByRole('button', { name: 'Save costing' }));
    expect(h.save.mutateAsync).toHaveBeenCalledWith({
      asset_id: 'a1', basis: 'actual_cost', effective_from: '2026-11-01', effective_to: null,
      driver: 'units', count_standby: true, rate_unit: 'days', account: '5100 Plant costs',
      cost_center: 'CC-7', party_type: null, party: null,
    });
  });

  it('#2544 sharing by fuel sends the driver without a usage unit', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mount();
    await user.type(screen.getByLabelText('Account group (instead of one account)'), 'Plant');
    await user.selectOptions(screen.getByLabelText('Share by'), 'fuel');
    expect(screen.queryByLabelText('Count usage in')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save costing' }));
    const sent = h.save.mutateAsync.mock.calls[0][0];
    expect(sent).toMatchObject({ basis: 'actual_cost', driver: 'fuel', account_group: 'Plant' });
    expect(sent).not.toHaveProperty('rate_unit');
    expect(sent).not.toHaveProperty('account');
  });

  it('#2544 changing an existing costing carries its setting key and the version it expects', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mount(existing);
    expect(screen.getByRole('radio', { name: 'Hire rate' })).toBeChecked();
    expect(screen.getByLabelText(/Work rate per unit/)).toHaveValue('120');
    await user.clear(screen.getByLabelText(/Work rate per unit/));
    await user.type(screen.getByLabelText(/Work rate per unit/), '135');
    await user.click(screen.getByRole('button', { name: 'Save costing' }));
    expect(h.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      setting_key: 'k1', expected_version: 4, asset_id: 'a1', basis: 'hire_rate', work_rate: 135, standby_rate: 40, rate_unit: 'days',
    }));
  });

  it('#2544 choosing None saves with no rates or accounts', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mount();
    await user.click(screen.getByRole('radio', { name: 'None' }));
    await user.click(screen.getByRole('button', { name: 'Save costing' }));
    expect(h.save.mutateAsync).toHaveBeenCalledWith({ asset_id: 'a1', basis: 'none', effective_from: '2026-11-01', effective_to: null });
  });

  it('#2544 Preview sends the same draft Save would, and lists each month with its project, amount, driver total and entries', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    h.preview.mutateAsync.mockResolvedValue([
      { month: '2026-11-01', project_id: 'p1', category: 'Equipment', amount: 1500, driver_total: 12.5, entry_count: 3 },
      { month: '2026-11-01', project_id: null, category: null, amount: null, driver_total: null, entry_count: 0 },
    ]);
    mount();
    await user.click(screen.getByRole('radio', { name: 'Hire rate' }));
    await user.type(screen.getByLabelText(/Work rate per unit/), '100');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(h.preview.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'a1', basis: 'hire_rate', work_rate: 100 }));
    const table = await screen.findByRole('table', { name: 'Preview of allocations' });
    const [, allocated, unallocated] = within(table).getAllByRole('row');
    expect(allocated).toHaveTextContent('Project p1');
    expect(allocated).toHaveTextContent('Rp 1500');
    expect(allocated).toHaveTextContent('12.5');
    expect(allocated).toHaveTextContent('3');
    expect(unallocated).toHaveTextContent('Unallocated: no approved usage this month');
    expect(unallocated).toHaveTextContent('—');
  });

  it('#2544 a refused save keeps the form open, shows the error and does not close', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    h.save.mutateAsync.mockRejectedValue(Object.assign(new Error('Version conflict'), { code: '40001' }));
    const onClose = mount();
    await user.click(screen.getByRole('radio', { name: 'None' }));
    await user.click(screen.getByRole('button', { name: 'Save costing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId('entity-modal-save-error')).toHaveTextContent('Version conflict');
  });
});
