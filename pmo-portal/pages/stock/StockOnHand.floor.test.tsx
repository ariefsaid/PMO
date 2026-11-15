import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

/** Floor list (all-screens/floor-tests/stock-on-hand.md): each missing inventory control is driven to its outcome. */

const { master, reports, reorder } = vi.hoisted(() => ({
  master: { listWarehouses: vi.fn(), listKeepers: vi.fn() },
  reports: { onHand: vi.fn() },
  reorder: { worklist: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reports, reorder } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
let realRole: Role = 'Project Manager';
const effectiveRole: Role | null = null;
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: effectiveRole ?? realRole }) }));

import StockOnHand from './StockOnHand';

const row = { itemId: 'i1', itemCode: 'CEM', itemName: 'Cement 50kg', unitCode: 'bag', wholeOnly: true, warehouseId: 'w1', warehouseCode: 'SITE-A', warehouseName: 'Site A', warehouseKind: 'site', qtyOnHand: '70' };

/** The ledger, reduced to the item it was opened for. */
const LedgerPage: React.FC = () => {
  const location = useLocation();
  return <p>{`ledger for ${new URLSearchParams(location.search).get('item') ?? 'none'}`}</p>;
};

const NewMovementPage: React.FC = () => {
  const { kind } = useParams<{ kind: string }>();
  return <p>{`new movement: ${kind ?? 'none'}`}</p>;
};

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <output data-testid="location" data-search={location.search} />;
};

const renderRouted = () => {
  realRole = 'Admin';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/stock']}>
          <Routes>
            <Route path="/stock" element={<StockOnHand />} />
            <Route path="/stock/documents" element={<p>documents page</p>} />
            <Route path="/stock/ledger" element={<LedgerPage />} />
            <Route path="/stock/new/:kind" element={<NewMovementPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listWarehouses.mockResolvedValue([{ id: 'w1', code: 'SITE-A', name: 'Site A', kind: 'site', archived_at: null }]);
  master.listKeepers.mockResolvedValue([]);
  reports.onHand.mockResolvedValue([row]);
  reorder.worklist.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

describe('stock on hand floor controls', () => {
  it('floor: Documents section navigation opens the documents list', async () => {
    renderRouted();
    await screen.findByText('CEM');
    await userEvent.click(screen.getByRole('link', { name: 'Documents' }));
    expect(await screen.findByText('documents page')).toBeInTheDocument();
  });

  it('floor: warehouse selection filters balances and updates the URL', async () => {
    master.listWarehouses.mockResolvedValue([
      { id: 'w1', code: 'SITE-A', name: 'Site A', kind: 'site', archived_at: null },
      { id: 'w2', code: 'SITE-B', name: 'Site B', kind: 'site', archived_at: null },
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/stock']}>
            <LocationProbe />
            <Routes><Route path="/stock" element={<StockOnHand />} /></Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('CEM');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Warehouse' }), 'w2');
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?warehouse=w2');
    await waitFor(() => expect(reports.onHand.mock.calls.at(-1)?.[0]).toMatchObject({ warehouseId: 'w2' }));
  });

  it('floor: Show zero balances reveals zero rows and updates the URL', async () => {
    const zeroRow = { ...row, itemId: 'i2', itemCode: 'CAB', itemName: 'Cable 4mm', qtyOnHand: '0' };
    reports.onHand.mockImplementation((filters?: { includeZero?: boolean }) => Promise.resolve(filters?.includeZero ? [row, zeroRow] : [row]));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/stock']}>
            <LocationProbe />
            <Routes><Route path="/stock" element={<StockOnHand />} /></Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('CEM');
    expect(screen.queryByText('CAB')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show zero balances' }));
    expect(await screen.findByText('CAB')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?zero=1');
    await waitFor(() => expect(reports.onHand.mock.calls.at(-1)?.[0]).toMatchObject({ includeZero: true }));
  });

  it('floor: the item code opens the ledger for that item', async () => {
    renderRouted();
    await screen.findByText('CEM');
    await userEvent.click(screen.getByRole('link', { name: 'CEM' }));
    expect(await screen.findByText('ledger for i1')).toBeInTheDocument();
  });

  it('floor: Issue to project opens a new issue movement', async () => {
    renderRouted();
    await screen.findByText('CEM');
    await userEvent.click(screen.getByRole('button', { name: 'Issue to project' }));
    expect(await screen.findByText('new movement: issue')).toBeInTheDocument();
  });

  it.each([
    ['Receive', 'receive'],
    ['Transfer', 'transfer'],
    ['Return from project', 'return'],
    ['Stock count', 'count'],
    ['Adjustment', 'adjustment'],
  ])('floor: More menu %s opens its movement form', async (label, kind) => {
    renderRouted();
    await screen.findByText('CEM');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: label }));
    expect(await screen.findByText(`new movement: ${kind}`)).toBeInTheDocument();
  });
});
