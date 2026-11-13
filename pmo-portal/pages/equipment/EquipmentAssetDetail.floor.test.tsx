import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const h = vi.hoisted(() => ({
  role: 'Finance' as string, viewAs: null as string | null,
  assets: null as unknown, costing: null as unknown, allocations: null as unknown, totals: null as unknown,
  preview: vi.fn(), save: vi.fn(), end: vi.fn(), fetchAssetPage: vi.fn(),
  costingArgs: [] as unknown[],
}));
/** The asset register is paged: a record resolves inside the pages loaded so far. */
const assetPages = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  data: { pages: [{ rows, truncated: over.hasNextPage === true }] },
  total: rows.length, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false,
  fetchNextPage: h.fetchAssetPage, refetch: vi.fn(), ...over,
});
vi.mock('@/src/hooks/useEquipment', () => ({
  useEquipmentAssetPages: () => h.assets,
  useEquipmentCosting: (history?: boolean) => { h.costingArgs.push(history); return h.costing; },
  useEquipmentAllocations: () => h.allocations,
  useEquipmentUsageTotals: () => h.totals,
  usePreviewCosting: () => ({ mutateAsync: h.preview, isPending: false }),
  useSaveCosting: () => ({ mutateAsync: h.save, isPending: false }),
  useEndCosting: () => ({ mutateAsync: h.end, isPending: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: 'pj1', name: 'EQU P1', short_name: null, currency: 'IDR' }, { id: 'pj2', name: 'EQU P2', short_name: null, currency: 'IDR' }] }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: (h.viewAs ?? h.role) as Role }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import EquipmentAssetDetail from './EquipmentAssetDetail';

const setting = (over: Record<string, unknown> = {}) => ({
  id: 's1', setting_key: 'sk1', version: 2, asset_id: 'a1', asset_code: 'EQU-1', asset_name: 'Loader 1', basis: 'actual_cost', is_current: true, voided: false,
  effective_from: '2026-10-01', effective_to: null, window_to: null, driver: 'units', count_standby: false, work_rate: null, standby_rate: null, rate_unit: null,
  match_account: 'Depreciation', match_account_group: null, match_cost_center: 'CC-1', match_party: null, match_party_type: null, charge_category: 'Equipment',
  specificity: 2, created_at: '', created_by: '', ...over,
});
const alloc = (over: Record<string, unknown> = {}) => ({
  asset_id: 'a1', asset_code: 'EQU-1', project_id: 'pj1', project_name: 'EQU P1', month: '2026-10-01', basis: 'actual_cost', setting_key: 'sk1', version: 2,
  status: 'allocated', reason: null, driver: 'units', work_units: null, standby_units: null, work_rate: null, standby_rate: null, pool: 800, driver_value: 6,
  driver_total: 8, share: 0.75, amount: 600, category: 'Equipment', line_count: 2, entry_count: 3, unit: 'hours', ...over,
});
const OTHER_ASSET = { id: 'a-other', code: 'EQU-9', name: 'Grader 9', default_unit: 'hours', external_ref: null, external_tier: null, archived_at: null };
const page = () => {
  const tree = () => (
    <MemoryRouter initialEntries={['/equipment/assets/a1']}><ToastProvider>
      <Routes>
        <Route path="/equipment/assets/:assetId" element={<EquipmentAssetDetail />} />
        <Route path="/equipment/assets" element={<p>Assets list</p>} />
      </Routes>
    </ToastProvider></MemoryRouter>
  );
  const view = render(tree());
  return { rerender: () => view.rerender(tree()) };
};
const openForm = async () => {
  const user = userEvent.setup();
  page();
  await user.click(screen.getByRole('button', { name: 'Change costing' }));
  return { user, dialog: await screen.findByRole('dialog') };
};
const chooseActualCost = async (dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(dialog).getByRole('radio', { name: 'Actual cost by usage' }));
  const account = within(dialog).getByRole('textbox', { name: 'Ledger account' });
  await user.clear(account);
  await user.type(account, 'Depreciation');
};

describe('EquipmentAssetDetail — floor (floor-tests/equipment-asset-record.md)', () => {
  beforeEach(() => {
    h.role = 'Finance';
    h.viewAs = null;
    h.costingArgs = [];
    h.assets = assetPages([{ id: 'a1', code: 'EQU-1', name: 'Loader 1', default_unit: 'hours', external_ref: 'AST-1', external_tier: 'erp', archived_at: null }]);
    h.costing = ok([setting()]);
    h.allocations = ok({ rows: [alloc()], truncated: false });
    h.totals = ok({ rows: [{ asset_id: 'a1', project_id: 'pj1', project_name: 'EQU P1', month: '2026-10-01', work_units: 6, standby_units: 0, fuel_litres: 0, trips: 0, unit: 'hours', entry_count: 3, submitted_count: 1, asset_code: 'EQU-1', asset_name: 'Loader 1' }], truncated: false });
    h.preview = vi.fn().mockResolvedValue([{ project_id: 'pj1', month: '2026-10-01', category: 'Equipment', basis: 'actual_cost', amount: 600, driver_total: 8, entry_count: 3 }]);
    h.save = vi.fn().mockResolvedValue({ setting_key: 'sk1', version: 3, changed: true });
    h.end = vi.fn().mockResolvedValue(undefined);
  });

  it('floor: Back to assets from the not-found state opens the assets register', async () => {
    h.assets = assetPages([OTHER_ASSET]);
    const user = userEvent.setup();
    page();
    expect(screen.getByText('This asset was not found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to assets' }));
    expect(screen.getByText('Assets list')).toBeInTheDocument();
  });

  it('floor: the asset read Retry shows the asset header after refetch', async () => {
    const view = page();
    h.assets = { ...assetPages([]), data: undefined, isPending: false, isError: true, refetch: vi.fn(async () => {
      h.assets = assetPages([{ id: 'a1', code: 'EQU-1', name: 'Loader 1', default_unit: 'hours', external_ref: 'AST-1', external_tier: 'erp', archived_at: null }]);
      view.rerender();
    }) };
    view.rerender();
    const alert = screen.getByText("Couldn't load equipment assets").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Loader 1')).toBeInTheDocument();
  });

  it('floor: the usage totals Retry shows the usage table after refetch', async () => {
    const view = page();
    h.totals = { data: undefined, isPending: false, isError: true, refetch: vi.fn(async () => {
      h.totals = ok({ rows: [{ asset_id: 'a1', project_id: 'pj1', project_name: 'EQU P1', month: '2026-10-01', work_units: 6, standby_units: 0, fuel_litres: 0, trips: 0, unit: 'hours', entry_count: 3, submitted_count: 1, asset_code: 'EQU-1', asset_name: 'Loader 1' }], truncated: false });
      view.rerender();
    }) };
    view.rerender();
    const usage = screen.getByRole('region', { name: 'Usage' });
    const alert = within(usage).getByText("Couldn't load usage totals").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await within(usage).findByRole('row', { name: /EQU P1/ })).toBeInTheDocument();
  });

  it('floor: the costing setting Retry shows the setting after refetch', async () => {
    const view = page();
    h.costing = { data: undefined, isPending: false, isError: true, refetch: vi.fn(async () => { h.costing = ok([setting()]); view.rerender(); }) };
    view.rerender();
    const costing = screen.getByRole('region', { name: 'Costing' });
    const alert = within(costing).getByText("Couldn't load the costing setting").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await within(costing).findByText('Actual cost by usage')).toBeInTheDocument();
  });

  it('floor: End costing opens a confirmation that names its effect', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'End costing' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('From today the asset has no costing. Earlier months keep their amounts.');
    expect(h.end).not.toHaveBeenCalled();
  });

  it('floor: confirming End costing sends the current setting key and version', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'End costing' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'End costing' }));
    await waitFor(() => expect(h.end).toHaveBeenCalledTimes(1));
    expect(h.end).toHaveBeenCalledWith(expect.objectContaining({ settingKey: 'sk1', expectedVersion: 2 }));
  });

  it('floor: choosing the None basis saves a draft with no costing inputs', async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole('radio', { name: 'None' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save costing' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    const draft = h.save.mock.calls[0][0] as Record<string, unknown>;
    expect(draft.basis).toBe('none');
    expect(draft.driver).toBeUndefined();
    expect(draft.account).toBeUndefined();
  });

  it('floor: choosing the Hire rate basis shows the rate fields and previews hire_rate', async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole('radio', { name: 'Hire rate' }));
    const workRate = within(dialog).getByRole('textbox', { name: 'Work rate per unit' });
    expect(workRate).toBeInTheDocument();
    await user.type(workRate, '250000');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ basis: 'hire_rate', work_rate: 250000 }));
  });

  it('floor: a typed work rate reaches the preview draft', async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole('radio', { name: 'Hire rate' }));
    const workRate = within(dialog).getByRole('textbox', { name: 'Work rate per unit' });
    await user.type(workRate, '250000');
    expect(within(dialog).getByRole('button', { name: 'Preview' })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ work_rate: 250000 }));
  });

  it('floor: a typed standby rate reaches the preview draft', async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole('radio', { name: 'Hire rate' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Work rate per unit' }), '250000');
    await user.type(within(dialog).getByRole('textbox', { name: /Standby rate per unit/ }), '40000');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ standby_rate: 40000 }));
  });

  it('floor: choosing days in the Rate per select is used by the preview draft', async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole('radio', { name: 'Hire rate' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Work rate per unit' }), '250000');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Rate per' }), 'days');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ basis: 'hire_rate', rate_unit: 'days' }));
  });

  it('floor: a typed account group reaches the preview draft', async () => {
    const { user, dialog } = await openForm();
    await chooseActualCost(dialog, user);
    await user.type(within(dialog).getByRole('textbox', { name: /Account group/ }), 'Fixed Assets');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ account_group: 'Fixed Assets' }));
  });

  it('floor: a typed cost centre reaches the preview draft', async () => {
    const { user, dialog } = await openForm();
    await chooseActualCost(dialog, user);
    const costCentre = within(dialog).getByRole('textbox', { name: /Cost centre/ });
    await user.clear(costCentre);
    await user.type(costCentre, 'CC-9');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ cost_center: 'CC-9' }));
  });

  it('floor: a typed party type reaches the preview draft', async () => {
    const { user, dialog } = await openForm();
    await chooseActualCost(dialog, user);
    await user.type(within(dialog).getByRole('textbox', { name: /Party type/ }), 'Vendor');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ party_type: 'Vendor' }));
  });

  it('floor: a typed party reaches the preview draft', async () => {
    const { user, dialog } = await openForm();
    await chooseActualCost(dialog, user);
    await user.type(within(dialog).getByRole('textbox', { name: /^Party \(optional\)$/ }), 'PT-1');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ party: 'PT-1' }));
  });

  it('floor: choosing Fuel litres in Share by uses the fuel driver', async () => {
    const { user, dialog } = await openForm();
    await chooseActualCost(dialog, user);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Share by' }), 'fuel');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ driver: 'fuel' }));
  });

  it('floor: choosing days in Count usage in is used by the preview draft', async () => {
    const { user, dialog } = await openForm();
    await chooseActualCost(dialog, user);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Count usage in' }), 'days');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ driver: 'units', rate_unit: 'days' }));
  });

  it('floor: counting standby toward the share sets count_standby on the preview draft', async () => {
    const { user, dialog } = await openForm();
    await chooseActualCost(dialog, user);
    await user.click(within(dialog).getByRole('checkbox', { name: 'Count standby toward the share' }));
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ count_standby: true }));
  });

  it('floor: the Effective from date is used by the preview draft', async () => {
    const { user, dialog } = await openForm();
    await chooseActualCost(dialog, user);
    fireEvent.change(within(dialog).getByLabelText(/Effective from/), { target: { value: '2026-09-01' } });
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ effective_from: '2026-09-01' }));
  });

  it('floor: the Effective to date reaches the saved draft', async () => {
    const { user, dialog } = await openForm();
    await chooseActualCost(dialog, user);
    fireEvent.change(within(dialog).getByLabelText(/Effective to/), { target: { value: '2026-12-31' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save costing' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ effective_to: '2026-12-31' }));
  });

  it('floor: cancelling a dirty draft asks first; Keep editing keeps it, Discard closes', async () => {
    const { user, dialog } = await openForm();
    const account = within(dialog).getByRole('textbox', { name: 'Ledger account' });
    await user.clear(account);
    await user.type(account, 'Fuel hire');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const discard = await screen.findByRole('alertdialog', { name: 'Discard your changes?' });
    await user.click(within(discard).getByRole('button', { name: 'Keep editing' }));
    expect(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Ledger account' })).toHaveValue('Fuel hire');
    expect(h.save).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
