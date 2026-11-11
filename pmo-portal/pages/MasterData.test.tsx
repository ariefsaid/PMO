import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({
  records: vi.fn(),
  summary: vi.fn(),
  conn: { data: undefined as unknown },
}));
vi.mock('@/src/hooks/useOdoo', () => ({
  useMasterRecords: (input: unknown, enabled?: boolean) => h.records(input, enabled),
  useMasterSummary: (kind: string, enabled?: boolean) => h.summary(kind, enabled),
  useOdooConnection: () => h.conn,
  useOdooSetup: () => ({ mutateAsync: vi.fn(), isPending: false }),   // the default-warehouse control on the warehouses tab
}));

import MasterDataPage from './MasterData';
import { KIND_SPECS } from '@/src/lib/adapterSeam/odoo/kinds';

const row = (over: Record<string, unknown>) => ({ id: String(over.external_id), code: null, parent_external_id: null, active: true, tombstoned_at: null, attrs: {}, as_of: '2026-11-01T08:00:00Z', ...over });
const page = (rows: unknown[], total = rows.length) => ({ data: { rows, total }, isPending: false, isError: false, isFetching: false, refetch: vi.fn() });
const CONN = { status: 'active', activated: true, capabilities: { missing: [] }, connection: { state: 'healthy', failures: 0, last_ok_at: null, last_checked_at: new Date().toISOString(), error_class: null, missing: [] }, config: {} };

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }
function mount(role: string, path = '/master-data/product') {
  return render(
    <ImpersonationProvider realRole={role as never}>
      <MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/master-data/:kind" element={<MasterDataPage />} /></Routes></MemoryRouter>
    </ImpersonationProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  h.conn.data = CONN;
  h.summary.mockReturnValue({ data: { inactive: 3, tombstoned: 2, asOf: '2026-11-01T08:00:00Z' } });
  h.records.mockImplementation(() => page([row({ external_id: '1', name: 'Semen Tiga Roda', code: 'SM-1', attrs: { uom_id: '5', purchasable: true, sellable: false } })], 2500));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('FR-ODC-111 Admin, Executive and Finance see accounts and taxes tabs; others see only the operational four', () => {
  for (const [role, expected] of [['Admin', 6], ['Executive', 6], ['Finance', 6], ['Project Manager', 4], ['Engineer', 4]] as const) {
    const { unmount } = mount(role);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toHaveLength(expected);
    expect(tabs.some((t) => /Accounts$|^Accounts/.test(t ?? '') && !/Cost/.test(t ?? ''))).toBe(expected === 6);
    expect(tabs.some((t) => /Taxes/.test(t ?? ''))).toBe(expected === 6);
    unmount();
  }
});

it('FR-ODC-111 a role without the financial directory is refused on a direct link to accounts', () => {
  mount('Engineer', '/master-data/account');
  expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
  expect(h.records).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'account' }), true);
});

it('FR-ODC-111 the pager reads "1–50 of 2,500" and Next asks for page 2', () => {
  mount('Admin');
  expect(screen.getByText('1–50 of 2,500')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.getByText('51–100 of 2,500')).toBeInTheDocument();
  expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ kind: 'product', page: 2, pageSize: 50 }), true);
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
});

it('FR-ODC-111 search is applied 300 ms after the last keystroke and returns to page 1', () => {
  vi.useFakeTimers();
  mount('Admin');
  const box = screen.getByRole('searchbox');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  fireEvent.change(box, { target: { value: 'sem' } });
  act(() => { vi.advanceTimersByTime(299); });
  expect(h.records).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'sem' }), true);
  act(() => { vi.advanceTimersByTime(2); });
  expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ search: 'sem', page: 1 }), true);
});

it('FR-ODC-111 the header shows inactive and deleted counts and an "as of" from the newest sync', () => {
  mount('Admin');
  expect(screen.getByText(/3 inactive/)).toBeInTheDocument();
  expect(screen.getByText(/2 deleted in Odoo/)).toBeInTheDocument();
  expect(screen.getByText(/As of/)).toBeInTheDocument();
});

it('FR-ODC-111 a kind whose Odoo app is missing is disabled with the reason, and nothing is requested for it', () => {
  h.conn.data = { ...CONN, capabilities: { missing: [KIND_SPECS.warehouse.model, `${KIND_SPECS.location.model}:read`] } };
  mount('Admin', '/master-data/warehouse');
  expect(screen.getByText(/Odoo is missing an app this list needs/)).toBeInTheDocument();
  expect(screen.getByText(new RegExp(KIND_SPECS.warehouse.model.replace('.', '\\.')))).toBeInTheDocument();
  expect(h.records).not.toHaveBeenCalledWith(expect.anything(), true);
});

it('FR-ODC-111 warehouses list their locations beneath them with usage', () => {
  h.records.mockImplementation((input: { kind: string }) => input.kind === 'warehouse'
    ? page([row({ external_id: '10', name: 'Gudang Utama', code: 'GU' }), row({ external_id: '11', name: 'Gudang Proyek', code: 'GP' })])
    : page([row({ external_id: '100', name: 'GU/Stock', attrs: { usage: 'internal', warehouse_id: '10' } }), row({ external_id: '101', name: 'GP/Stock', attrs: { usage: 'transit', warehouse_id: '11' } })]));
  mount('Admin', '/master-data/warehouse');
  const gu = screen.getByRole('group', { name: /Gudang Utama/ });
  expect(within(gu).getByText('GU/Stock')).toBeInTheDocument();
  expect(within(gu).getByText('internal')).toBeInTheDocument();
  expect(within(gu).queryByText('GP/Stock')).not.toBeInTheDocument();
});

it('FR-ODC-111 inactive and deleted rows carry their own pill', () => {
  h.records.mockImplementation(() => page([row({ external_id: '1', name: 'Lama', active: false }), row({ external_id: '2', name: 'Hilang', tombstoned_at: '2026-10-30T00:00:00Z' })]));
  mount('Admin');
  expect(screen.getByText('Inactive')).toBeInTheDocument();
  expect(screen.getByText('Deleted in Odoo')).toBeInTheDocument();
});

it('FR-ODC-111 an unknown kind in the URL falls back to items', () => {
  mount('Admin', '/master-data/nonsense');
  expect(screen.getByTestId('where')).toHaveTextContent('/master-data/product');
});

it('FR-ODC-111 units and locations are read for the visible rows only, never a fixed cap', () => {
  mount('Admin');
  expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ kind: 'uom', externalIds: ['5'] }), true);
  cleanup();
  h.records.mockImplementation((input: { kind: string }) => input.kind === 'warehouse' ? page([row({ external_id: '10', name: 'Gudang Utama' })]) : page([]));
  mount('Admin', '/master-data/warehouse');
  expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ kind: 'location', warehouseIds: ['10'] }), true);
});

it('FR-ODC-111 when Odoo has more locations than one read returns, the page says so', () => {
  h.records.mockImplementation((input: { kind: string }) => input.kind === 'warehouse'
    ? page([row({ external_id: '10', name: 'Gudang Utama' })])
    : page([row({ external_id: '100', name: 'GU/Stock', attrs: { usage: 'internal', warehouse_id: '10' } })], 1500));
  mount('Admin', '/master-data/warehouse');
  expect(screen.getByText(/Some locations are not shown/)).toBeInTheDocument();
});

it('FR-ODC-111 search sits in the tab row, and the page has no separate filter box', () => {
  mount('Admin');
  const search = screen.getByRole('searchbox');
  expect(search.closest('[role="tabpanel"]')).toBeNull();
  expect(screen.queryByTestId('list-page-toolbar')).not.toBeInTheDocument();
});
