/**
 * Floor tests for the master-data directories (floor-wave2).
 *
 * Four controls nothing drove end-to-end: the directory tabs, Show inactive and deleted,
 * Previous page, and the restricted-directory Back action. Each asserts the OUTCOME — the route
 * that opens, the read the grid issues, the home route that appears. Harness mirrors
 * `pages/MasterData.test.tsx`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  useOdooSetup: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import MasterDataPage from './MasterData';

const row = (over: Record<string, unknown>) => ({
  id: String(over.external_id), code: null, parent_external_id: null, active: true, tombstoned_at: null, attrs: {}, as_of: '2026-11-01T08:00:00Z', ...over,
});
const page = (rows: unknown[], total = rows.length) => ({ data: { rows, total }, isPending: false, isError: false, isFetching: false, refetch: vi.fn() });
const CONN = {
  status: 'active', activated: true, capabilities: { missing: [] },
  connection: { state: 'healthy', failures: 0, last_ok_at: null, last_checked_at: new Date().toISOString(), error_class: null, missing: [] },
  config: {},
};

const Where: React.FC = () => {
  const location = useLocation();
  return <div data-testid="where" data-pathname={location.pathname} />;
};

const mount = (role: string, path = '/master-data/product') =>
  render(
    <ImpersonationProvider realRole={role as never}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/master-data/:kind" element={<MasterDataPage />} />
          <Route path="*" element={<div data-testid="landed" />} />
        </Routes>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

const pathname = () => screen.getByTestId('where').dataset.pathname;
/** The last read issued for that directory (the page also reads units/locations alongside). */
const lastReadOf = (kind: string) =>
  h.records.mock.calls.filter(([input]) => (input as { kind?: string }).kind === kind).at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  h.conn.data = CONN;
  h.summary.mockReturnValue({ data: { inactive: 3, tombstoned: 2, asOf: '2026-11-01T08:00:00Z' } });
  h.records.mockImplementation((input: { kind?: string }) =>
    page([row({ external_id: input.kind === 'warehouse' ? 'w1' : '1', name: input.kind === 'warehouse' ? 'Main Warehouse' : 'Semen Tiga Roda', code: input.kind === 'warehouse' ? 'WH' : 'SM-1' })], 2500));
});
afterEach(() => { cleanup(); });

describe('Master data floor — directories', () => {
  it('floor: the Warehouses and locations tab opens that directory and reads warehouse rows', async () => {
    mount('Admin');
    expect(lastReadOf('product')).toBeDefined();

    await userEvent.click(screen.getByRole('tab', { name: /Warehouses and locations/ }));

    expect(pathname()).toBe('/master-data/warehouse');
    expect(lastReadOf('warehouse')).toMatchObject({ kind: 'warehouse' });
    expect(await screen.findByText('Main Warehouse')).toBeInTheDocument();
  });

  it('floor: Show inactive and deleted asks for the rows Odoo hides', async () => {
    mount('Admin');
    expect(lastReadOf('product')).toMatchObject({ includeInactive: false });

    await userEvent.click(screen.getByRole('checkbox', { name: /Show inactive and deleted/i }));

    expect(lastReadOf('product')).toMatchObject({ includeInactive: true, page: 1 });
  });
});

describe('Master data floor — pager', () => {
  it('floor: Previous page returns to page one and asks for its rows', async () => {
    mount('Admin');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('51–100 of 2,500')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));

    expect(screen.getByText('1–50 of 2,500')).toBeInTheDocument();
    expect(lastReadOf('product')).toMatchObject({ page: 1 });
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });
});

describe('Master data floor — recoveries', () => {
  it('floor: a restricted directory’s Back action returns home', async () => {
    mount('Engineer', '/master-data/account');
    await userEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(pathname()).toBe('/');
  });
});
