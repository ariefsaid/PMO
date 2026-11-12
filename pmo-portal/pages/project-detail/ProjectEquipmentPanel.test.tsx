import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';

const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const h = vi.hoisted(() => ({ role: 'Project Manager' as string, totals: null as unknown, allocations: null as unknown, allocArgs: [] as unknown[] }));
vi.mock('@/src/hooks/useEquipment', () => ({
  useEquipmentUsageTotals: () => h.totals,
  useEquipmentAllocations: (q: unknown) => { h.allocArgs.push(q); return h.allocations; },
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));

import { ProjectEquipmentPanel } from './ProjectEquipmentPanel';

const total = (over: Record<string, unknown> = {}) => ({
  asset_id: 'a1', asset_code: 'EQU-1', asset_name: 'Loader 1', project_id: 'p1', project_name: 'Project North', month: '2026-10-01',
  work_units: 6, standby_units: 2, fuel_litres: 0, trips: 0, unit: 'hours', entry_count: 3, submitted_count: 1, ...over,
});
const alloc = (over: Record<string, unknown> = {}) => ({
  asset_id: 'a1', asset_code: 'EQU-1', project_id: 'p1', project_name: 'Project North', month: '2026-10-01', basis: 'actual_cost', status: 'allocated',
  amount: 600, version: 2, unit: 'hours', ...over,
});
const renderPanel = (charge?: string | null) => render(<MemoryRouter><ProjectEquipmentPanel projectId="p1" currency="IDR" equipmentChargeTotal={charge} /></MemoryRouter>);

describe('ProjectEquipmentPanel (FR-EQU-071, FR-EQU-051)', () => {
  beforeEach(() => {
    h.role = 'Project Manager';
    h.allocArgs = [];
    h.totals = ok({ rows: [total(), total({ month: '2026-09-01', work_units: 4, standby_units: 0, submitted_count: 0 })], truncated: false });
    h.allocations = ok({ rows: [alloc(), alloc({ month: '2026-09-01', amount: 100 })], truncated: false });
  });

  it('marks a sum with unrecorded usage rather than presenting a complete total', () => {
    h.totals = ok({ rows: [total(), total({ work_units: null, standby_units: null, submitted_count: null })], truncated: false });
    renderPanel();
    const row = within(screen.getByTestId('project-equipment-panel')).getByRole('row', { name: /Loader 1/ });
    expect(row).toHaveTextContent(/not recorded/);
  });

  it('AC-EQU-017 a PM sees both hours and the allocated amount per asset', () => {
    renderPanel();
    const panel = screen.getByTestId('project-equipment-panel');
    const row = within(panel).getByRole('row', { name: /Loader 1/ });
    expect(within(row).getByText(/10 hours/)).toBeInTheDocument(); // 6 + 4 work
    expect(within(row).getByText(/700/)).toBeInTheDocument();       // 600 + 100 allocated
    expect(within(row).getByText('Actual cost by usage')).toBeInTheDocument();
    expect(within(row).getByText('1')).toBeInTheDocument();         // waiting approval
  });

  it('AC-EQU-017 equipment unit labels use singular and plural forms', () => {
    h.totals = ok({ rows: [
      total({ asset_id: 'a1', asset_code: 'EQU-1', asset_name: 'Truck 1', unit: 'days', work_units: 1, standby_units: 0 }),
      total({ asset_id: 'a2', asset_code: 'EQU-2', asset_name: 'Truck 2', unit: 'days', work_units: 2, standby_units: 0 }),
    ], truncated: false });
    h.allocations = ok({ rows: [], truncated: false });

    renderPanel();

    const panel = screen.getByTestId('project-equipment-panel');
    expect(within(panel).getByText('1 day')).toBeInTheDocument();
    expect(within(panel).getByText('2 days')).toBeInTheDocument();
  });

  it('AC-EQU-017 an Engineer sees hours but no amounts, and never asks for allocations', () => {
    h.role = 'Engineer';
    h.allocations = ok({ rows: [], truncated: false });
    renderPanel();
    const panel = screen.getByTestId('project-equipment-panel');
    expect(within(panel).getByText(/10 hours/)).toBeInTheDocument();
    expect(within(panel).queryByRole('columnheader', { name: 'Allocated' })).toBeNull();
    expect(h.allocArgs.every((a) => (a as { from: string }).from === '')).toBe(true);
  });

  it('AC-EQU-017 the internal-charge line appears only when the charge is non-zero', () => {
    const a = renderPanel('0.00');
    expect(screen.queryByText(/internal equipment charges/)).toBeNull();
    a.unmount();
    const b = renderPanel(undefined);
    expect(screen.queryByText(/internal equipment charges/)).toBeNull();
    b.unmount();
    renderPanel('1250.00');
    expect(screen.getByText(/Includes .*1,250.* internal equipment charges \(hire rates\), not ledger cost/)).toBeInTheDocument();
  });

  it('AC-EQU-017 a project with no equipment usage renders nothing', () => {
    h.totals = ok({ rows: [], truncated: false });
    h.allocations = ok({ rows: [], truncated: false });
    renderPanel();
    expect(screen.queryByTestId('project-equipment-panel')).toBeNull();
  });

  it('AC-EQU-017 loading shows status text and an error offers retry', () => {
    h.totals = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const a = renderPanel();
    expect(screen.getByRole('status')).toHaveTextContent(/Loading equipment/);
    a.unmount();
    h.totals = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderPanel();
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't load equipment/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('AC-EQU-017 an unallocated month and a usage-only month are labelled, never shown as an amount', () => {
    h.allocations = ok({ rows: [alloc({ status: 'usage_only', basis: 'none', amount: null }), alloc({ status: 'unallocated', project_id: null, amount: null })], truncated: false });
    renderPanel();
    const row = within(screen.getByTestId('project-equipment-panel')).getByRole('row', { name: /Loader 1/ });
    expect(within(row).getByText('Usage recorded; no costing set')).toBeInTheDocument();
  });
});
