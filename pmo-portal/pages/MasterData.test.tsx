import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const DISCONNECTED = { ...CONN, status: 'disconnected', activated: false, connection: { ...CONN.connection, state: 'disconnected', last_ok_at: null, error_class: null } };

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }
function view(role: string, path = '/master-data/product') {
  return (
    <ImpersonationProvider realRole={role as never}>
      <MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/master-data/:kind" element={<MasterDataPage />} /></Routes></MemoryRouter>
    </ImpersonationProvider>
  );
}
function mount(role: string, path = '/master-data/product') { return render(view(role, path)); }
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

it('FR-ODC-111 choosing a directory tab opens that directory and drops the search', async () => {
  h.records.mockImplementation((input: { kind: string }) => input.kind === 'warehouse'
    ? page([row({ external_id: '10', name: 'Gudang Utama', code: 'GU' })])
    : page([]));
  mount('Admin');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sem' } });
  await userEvent.click(screen.getByRole('tab', { name: 'Warehouses and locations' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/master-data/warehouse');
  expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warehouse', page: 1 }), true);
  expect(screen.getByRole('group', { name: /Gudang Utama/ })).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('');
});

it('FR-ODC-111 Show inactive and deleted asks the directory for the inactive rows too', () => {
  mount('Admin');
  expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ kind: 'product', includeInactive: false }), true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show inactive and deleted' }));
  expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ kind: 'product', includeInactive: true, page: 1 }), true);
});

it('FR-ODC-111 Previous page goes back to the first page of the directory', () => {
  mount('Admin');
  const productPages = () => h.records.mock.calls
    .filter(([input, enabled]) => (input as { kind?: string }).kind === 'product' && enabled === true)
    .map(([input]) => (input as { page?: number }).page);
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.getByText('51–100 of 2,500')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(productPages().at(-1)).toBe(1);
  expect(screen.getByText('1–50 of 2,500')).toBeInTheDocument();
});

it('FR-ODC-111 a role refused a financial directory is taken back home', async () => {
  mount('Engineer', '/master-data/account');
  await userEvent.click(screen.getByRole('button', { name: 'Back to Dashboard' }));
  expect(screen.getByTestId('where').textContent).toBe('/');
});

it('FR-ODC-111 a list that fails to load offers Retry and asks for it again', async () => {
  const refetch = vi.fn();
  h.records.mockImplementation(() => ({ data: undefined, isPending: false, isError: true, isFetching: false, refetch }));
  mount('Admin');
  expect(screen.getByText('This list could not be loaded')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(refetch).toHaveBeenCalled();
});

it('FR-ODC-111 with Odoo not connected and nothing mirrored the banner is the whole state: no count, no table, no search', () => {
  h.conn.data = DISCONNECTED;
  h.records.mockImplementation(() => page([], 0));
  mount('Admin');
  expect(screen.getByTestId('odoo-connection-banner')).toHaveTextContent('Odoo is not connected');
  expect(screen.queryByTestId('list-page-count')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
  // The mirror read still runs, as on dev: a disconnect keeps the last-synced rows.
  expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ kind: 'product', page: 1 }), true);
});

it('FR-ODC-111 a connection that is not activated is not given a count or a table either, and says how to finish', () => {
  h.conn.data = { ...CONN, activated: false };
  h.records.mockImplementation(() => page([], 0));
  mount('Admin');
  expect(screen.getByTestId('odoo-connection-banner')).toHaveTextContent('Choose the Odoo company to finish connecting');
  expect(screen.queryByTestId('list-page-count')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
});

it('FR-ODC-111 a disconnected directory that still holds last-synced rows shows them with search and no count', () => {
  h.conn.data = DISCONNECTED;
  h.records.mockImplementation(() => page([row({ external_id: '1', name: 'Semen Tiga Roda', code: 'SM-1' })], 2500));
  mount('Admin');
  expect(screen.getByTestId('odoo-connection-banner')).toHaveTextContent('Odoo is not connected');
  expect(screen.queryByTestId('list-page-count')).not.toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Items' })).toBeInTheDocument();
  expect(screen.getByText('Semen Tiga Roda')).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toBeInTheDocument();
});

it('FR-ODC-111 the title carries no count until the first page has answered, then the number', () => {
  h.records.mockImplementation(() => ({ data: undefined, isPending: true, isError: false, isFetching: true, refetch: vi.fn() }));
  const { rerender } = mount('Admin');
  expect(screen.queryByTestId('list-page-count')).not.toBeInTheDocument();
  h.records.mockImplementation(() => page([row({ external_id: '1', name: 'Semen Tiga Roda', code: 'SM-1' })], 2500));
  rerender(view('Admin'));
  expect(screen.getByTestId('list-page-count')).toHaveTextContent('2500');
});

it('FR-ODC-111 the not-connected banner carries the Connect Odoo link to the Integrations page', () => {
  h.conn.data = DISCONNECTED;
  mount('Admin');
  const banner = screen.getByTestId('odoo-connection-banner');
  expect(within(banner).getByText('After connecting: items, units, warehouses, cost accounts, accounts, and taxes.')).toBeInTheDocument();
  const link = within(banner).getByRole('link', { name: 'Connect Odoo' });
  expect(link).toHaveAttribute('href', '/administration/integrations');
  expect(link).toHaveClass('touch-target');
});

it('FR-ODC-111 a disconnected single-page mirror keeps its row and hides the inconsistent count and pager', () => {
  h.conn.data = DISCONNECTED;
  h.records.mockImplementation(() => page([row({ external_id: '1', name: 'Capture mirrored item', code: 'CAP-001' })], 0));
  mount('Admin');

  expect(screen.getByRole('table', { name: 'Items' })).toBeInTheDocument();
  expect(screen.getByText('Capture mirrored item')).toBeInTheDocument();
  expect(screen.queryByTestId('list-page-count')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
});

it('FR-ODC-111 a connected directory offers no Connect Odoo link', () => {
  mount('Admin');
  expect(screen.queryByRole('link', { name: 'Connect Odoo' })).not.toBeInTheDocument();
});


