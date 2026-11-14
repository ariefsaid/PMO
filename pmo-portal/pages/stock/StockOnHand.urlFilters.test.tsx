import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

/**
 * R2 (ux/1110): the on-hand filters (warehouse, zero balances, search, below-reorder worklist)
 * live in the URL, so a filtered view survives the item-code drill to the ledger and Back,
 * or a refresh.
 */

const { master, reports, reorder } = vi.hoisted(() => ({
  master: { listWarehouses: vi.fn(), listKeepers: vi.fn() },
  reports: { onHand: vi.fn() },
  reorder: { worklist: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reports, reorder } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
let realRole: Role = 'Project Manager';
let effectiveRole: Role | null = null;
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: effectiveRole ?? realRole }) }));

import StockOnHand from './StockOnHand';

const row = { itemId: 'i1', itemCode: 'CEM', itemName: 'Cement 50kg', unitCode: 'bag', wholeOnly: true, warehouseId: 'w1', warehouseCode: 'SITE-A', warehouseName: 'Site A', warehouseKind: 'site', qtyOnHand: '70' };

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
};

const renderPage = (initialEntry = '/stock') => {
  realRole = 'Project Manager';
  effectiveRole = null;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LocationProbe />
          <StockOnHand />
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

describe('R2 — on-hand filters live in the URL', () => {
  it('a refresh of ?warehouse=w1&zero=1 reopens that warehouse with zero balances shown', async () => {
    renderPage('/stock?warehouse=w1&zero=1');
    // The warehouse options arrive with the first read; the select shows w1 once they exist.
    await screen.findByText('CEM');
    expect(screen.getByRole('combobox', { name: 'Warehouse' })).toHaveValue('w1');
    expect(screen.getByRole('checkbox', { name: 'Show zero balances' })).toBeChecked();
    await vi.waitFor(() => expect(reports.onHand.mock.calls.at(-1)?.[0]).toMatchObject({ warehouseId: 'w1', includeZero: true }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?warehouse=w1&zero=1');
  });

  it('ticking the below-reorder worklist writes it into the URL and loads the worklist', async () => {
    const user = userEvent.setup();
    renderPage('/stock');
    await screen.findByText('CEM');
    await user.click(screen.getByRole('checkbox', { name: 'Below reorder level' }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?belowReorder=1');
    expect(reorder.worklist).toHaveBeenCalled();
  });

  it('typing in the search box writes the query into the URL', async () => {
    const user = userEvent.setup();
    renderPage('/stock');
    await screen.findByText('CEM');
    await user.type(screen.getByLabelText('Search items'), 'cem');
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?q=cem');
  });
});

describe('floor: the balance filters and the item drill still work', () => {
  it('choosing a warehouse writes it into the URL and the balances read', async () => {
    master.listWarehouses.mockResolvedValue([
      { id: 'w1', code: 'SITE-A', name: 'Site A', kind: 'site', archived_at: null },
      { id: 'w2', code: 'SITE-B', name: 'Site B', kind: 'site', archived_at: null },
    ]);
    const user = userEvent.setup();
    renderPage('/stock');
    await screen.findByText('CEM');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Warehouse' }), 'w2');
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?warehouse=w2');
    await vi.waitFor(() => expect(reports.onHand.mock.calls.at(-1)?.[0]).toMatchObject({ warehouseId: 'w2' }));
  });

  it('ticking Show zero balances writes zero=1 and the zero balance arrives', async () => {
    const zeroRow = { ...row, itemId: 'i2', itemCode: 'CAB', itemName: 'Cable 4mm', qtyOnHand: '0' };
    reports.onHand.mockImplementation((f?: { includeZero?: boolean }) => Promise.resolve(f?.includeZero ? [row, zeroRow] : [row]));
    const user = userEvent.setup();
    renderPage('/stock');
    await screen.findByText('CEM');
    expect(screen.queryByText('CAB')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Show zero balances' }));
    expect(await screen.findByText('CAB')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?zero=1');
    await vi.waitFor(() => expect(reports.onHand.mock.calls.at(-1)?.[0]).toMatchObject({ includeZero: true }));
  });

  it('the item code opens the ledger for that item', async () => {
    renderPage('/stock');
    const link = await screen.findByRole('link', { name: 'CEM' });
    expect(link).toHaveAttribute('href', '/stock/ledger?item=i1');
  });

  it('the filter words toggle their box, so the small box is not the only target', async () => {
    const user = userEvent.setup();
    renderPage('/stock');
    await screen.findByText('CEM');
    await user.click(screen.getByText('Below reorder level'));
    expect(screen.getByRole('checkbox', { name: 'Below reorder level' })).toBeChecked();
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?belowReorder=1');
    await user.click(screen.getByText('Show zero balances'));
    expect(screen.getByRole('checkbox', { name: 'Show zero balances' })).toBeChecked();
  });
});
