import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const h = vi.hoisted(() => ({
  role: 'Finance' as string, viewAs: null as string | null,
  assets: null as unknown, costing: null as unknown, allocations: null as unknown, totals: null as unknown,
  preview: vi.fn(), save: vi.fn(), end: vi.fn(),
  costingArgs: [] as unknown[],
}));
vi.mock('@/src/hooks/useEquipment', () => ({
  useEquipmentAssets: () => h.assets,
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
const renderPage = () => render(
  <MemoryRouter initialEntries={['/equipment/assets/a1']}><ToastProvider>
    <Routes><Route path="/equipment/assets/:assetId" element={<EquipmentAssetDetail />} /></Routes>
  </ToastProvider></MemoryRouter>,
);

describe('/equipment/assets/:assetId (AC-EQU-001 FE reference, FR-EQU-044/071)', () => {
  beforeEach(() => {
    h.role = 'Finance';
    h.viewAs = null;
    h.costingArgs = [];
    h.assets = ok({ rows: [{ id: 'a1', code: 'EQU-1', name: 'Loader 1', default_unit: 'hours', external_ref: 'AST-1', external_tier: 'erp', archived_at: null }], truncated: false });
    h.costing = ok([setting()]);
    h.allocations = ok({ rows: [alloc()], truncated: false });
    h.totals = ok({ rows: [{ asset_id: 'a1', project_id: 'pj1', project_name: 'EQU P1', month: '2026-10-01', work_units: 6, standby_units: 0, fuel_litres: 0, trips: 0, unit: 'hours', entry_count: 3, submitted_count: 1, asset_code: 'EQU-1', asset_name: 'Loader 1' }], truncated: false });
    h.preview = vi.fn().mockResolvedValue([{ project_id: 'pj1', month: '2026-10-01', category: 'Equipment', basis: 'actual_cost', amount: 600, driver_total: 8, entry_count: 3 }]);
    h.save = vi.fn().mockResolvedValue({ setting_key: 'sk1', version: 3, changed: true });
    h.end = vi.fn().mockResolvedValue(undefined);
  });

  it('shows unrecorded usage and hire rates as unknown', async () => {
    h.costing = ok([setting({ basis: 'hire_rate', work_rate: null, rate_unit: 'hours' })]);
    h.allocations = ok({ rows: [alloc({ basis: 'hire_rate', work_units: null, work_rate: null })], truncated: false });
    h.totals = ok({ rows: [{ asset_id: 'a1', project_id: 'pj1', month: '2026-10-01', work_units: null, standby_units: null, fuel_litres: null, trips: null, submitted_count: null, unit: 'hours' }], truncated: false });
    renderPage();
    expect(screen.getByRole('region', { name: 'Usage' })).toHaveTextContent('—');
    expect(screen.getByRole('region', { name: 'Costing' })).toHaveTextContent('—');
    await userEvent.setup().click(screen.getByRole('button', { name: /how this was calculated/i }));
    expect(screen.getByRole('group', { name: /calculation/i })).toHaveTextContent('—');
  });

  it('AC-EQU-001 the drill-down shows pool, driver, share and version for an actual-cost row', async () => {
    const user = userEvent.setup();
    renderPage();
    const row = within(screen.getByRole('region', { name: 'Allocations' })).getByRole('row', { name: /EQU P1/ });
    expect(within(row).getByText(/600/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: /how this was calculated/i }));
    const detail = await screen.findByRole('group', { name: /calculation/i });
    expect(detail).toHaveTextContent(/Pool/);
    expect(detail).toHaveTextContent(/800/);
    expect(detail).toHaveTextContent(/units/);
    expect(detail).toHaveTextContent(/6 of 8/);
    expect(detail).toHaveTextContent(/75%/);
    expect(detail).toHaveTextContent(/Version 2/);
    expect(detail).toHaveTextContent(/Entries: 3/);
  });

  it('AC-EQU-001 a hire-rate row shows units, rate and the version it used', async () => {
    h.allocations = ok({ rows: [alloc({ basis: 'hire_rate', pool: null, driver: null, driver_value: null, driver_total: null, share: null, work_units: 6, work_rate: 100, standby_units: 2, standby_rate: 40, amount: 680, version: 1 })], truncated: false });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /how this was calculated/i }));
    const detail = await screen.findByRole('group', { name: /calculation/i });
    expect(detail).toHaveTextContent(/Work 6 hours/);
    expect(detail).toHaveTextContent(/100/);
    expect(detail).toHaveTextContent(/Standby 2 hours/);
    expect(detail).toHaveTextContent(/Version 1/);
  });

  it('AC-EQU-001 an unallocated pool is shown with its reason and no project amount', () => {
    h.allocations = ok({ rows: [alloc({ project_id: null, project_name: null, status: 'unallocated', reason: 'no_approved_usage', amount: null, share: null, driver_value: null })], truncated: false });
    renderPage();
    expect(screen.getByText('Unallocated: no approved usage this month')).toBeInTheDocument();
  });

  it('AC-EQU-043 a usage-only row says no costing is set and shows no amount', () => {
    h.allocations = ok({ rows: [alloc({ basis: 'none', status: 'usage_only', amount: null, pool: null, share: null, work_units: 6 })], truncated: false });
    renderPage();
    const row = within(screen.getByRole('region', { name: 'Allocations' })).getByRole('row', { name: /EQU P1/ });
    expect(within(row).getByText('Usage recorded; no costing set')).toBeInTheDocument();
    expect(within(row).queryByText(/600/)).toBeNull();
  });

  it('AC-EQU-017 the current costing setting and its history toggle', async () => {
    const user = userEvent.setup();
    renderPage();
    const card = screen.getByRole('region', { name: 'Costing' });
    expect(within(card).getByText('Actual cost by usage')).toBeInTheDocument();
    expect(within(card).getByText(/Depreciation/)).toBeInTheDocument();
    expect(within(card).getByText(/CC-1/)).toBeInTheDocument();
    await user.click(within(card).getByRole('switch', { name: 'Show history' }));
    expect(h.costingArgs).toContain(true);
  });

  it('AC-EQU-017 a PM sees the costing and allocations but no Change costing', () => {
    h.role = 'Project Manager';
    renderPage();
    expect(screen.getByRole('region', { name: 'Costing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change costing' })).toBeNull();
  });

  it('AC-EQU-017 Finance viewing as another role cannot change costing', () => {
    h.viewAs = 'Project Manager';
    renderPage();
    expect(screen.queryByRole('button', { name: 'Change costing' })).toBeNull();
  });

  it('AC-EQU-017 an Engineer sees usage totals but neither costing nor allocations', () => {
    h.role = 'Engineer';
    renderPage();
    expect(screen.getByRole('region', { name: 'Usage' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Costing' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Allocations' })).toBeNull();
  });

  it('AC-EQU-070 preview rows render before save, and Save sends the same draft', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Change costing' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Actual cost by usage' }));
    await user.clear(within(dialog).getByRole('textbox', { name: /Ledger account$/ }));
    await user.type(within(dialog).getByRole('textbox', { name: /Ledger account$/ }), 'Depreciation');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    const draftSent = h.preview.mock.calls[0][0];
    expect(draftSent).toMatchObject({ asset_id: 'a1', basis: 'actual_cost', driver: 'units', rate_unit: 'hours', account: 'Depreciation', setting_key: 'sk1', expected_version: 2 });
    const table = await within(dialog).findByRole('table', { name: /preview/i });
    expect(within(table).getByText('EQU P1')).toBeInTheDocument();
    expect(within(table).getByText(/600/)).toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Save costing' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(draftSent));
  });

  it('AC-EQU-070 a preview with an unallocated pool names the reason', async () => {
    h.preview = vi.fn().mockResolvedValue([{ project_id: null, month: '2026-10-01', category: null, basis: 'actual_cost', amount: null, driver_total: null, entry_count: 0 }]);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Change costing' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(await within(dialog).findByText('Unallocated: no approved usage this month')).toBeInTheDocument();
  });

  it('AC-EQU-017 a refused preview shows the refusal copy in the form', async () => {
    h.preview = vi.fn().mockRejectedValue(Object.assign(new Error('this asset already has a current setting over those dates'), { code: '22023' }));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Change costing' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(await within(dialog).findByText(/already has a current setting/)).toBeInTheDocument();
  });

  it('AC-EQU-017 loading and error states for allocations', async () => {
    h.allocations = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const a = renderPage(); a.unmount();
    h.allocations = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: /retry/i }));
    expect((h.allocations as { refetch: unknown }).refetch).toHaveBeenCalled();
  });
});
