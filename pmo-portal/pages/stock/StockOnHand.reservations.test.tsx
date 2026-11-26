import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { tableCell } from '@/src/test/tableCell';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({
  master: { listWarehouses: vi.fn(), listKeepers: vi.fn() },
  reports: { onHand: vi.fn() },
  reorder: { worklist: vi.fn() },
  state: { on: false, figs: [] as unknown[] },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master: h.master, reports: h.reports, reorder: h.reorder } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/hooks/useStockReservations', async (orig) => ({
  ...(await orig<typeof import('@/src/hooks/useStockReservations')>()),
  useReservationsEnabled: () => h.state.on,
  useFreeReserved: () => ({ data: h.state.figs }),
}));
let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import StockOnHand from './StockOnHand';

const row = { itemId: 'i1', itemCode: 'CEM', itemName: 'Cement 50kg', unitCode: 'bag', wholeOnly: true, warehouseId: 'w1', warehouseCode: 'SITE-A', warehouseName: 'Site A', warehouseKind: 'site', qtyOnHand: '70' };
const figure = {
  itemId: 'i1', warehouseId: 'w1', qtyOnHand: '70', reservedQty: '20', freeQty: '50', shortBy: '0',
  reservations: [{ reservationId: 'r1', workOrderId: 'wo1', workOrderNumber: 'WO-0001', workOrderTitle: 'Slab pour', remainingQty: '20', expiresOn: null }],
};

const renderPage = (role: Role) => {
  realRole = role;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter><StockOnHand /></MemoryRouter></ToastProvider></QueryClientProvider>);
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  h.state.on = true;
  h.state.figs = [figure];
  h.master.listWarehouses.mockResolvedValue([{ id: 'w1', code: 'SITE-A', name: 'Site A', kind: 'site', archived_at: null }]);
  h.master.listKeepers.mockResolvedValue([]);
  h.reports.onHand.mockResolvedValue([row]);
  h.reorder.worklist.mockResolvedValue([]);
});

const ON_HAND = 'Stock';
/** Free and reserved are two figures in their own columns (one figure per cell). */
const expectFreeReserved = async (free: string, reserved: string) => {
  await screen.findByRole('table');
  expect(tableCell(ON_HAND, 'CEM', 'Free')).toHaveTextContent(new RegExp(`^${free} bag$`));
  expect(tableCell(ON_HAND, 'CEM', 'Reserved')).toHaveTextContent(new RegExp(`^${reserved} bag`));
};

describe('AC-RSV-017 stock reads x free + y reserved', () => {
  it('AC-RSV-017 shows free and reserved, with the reserving work order one tap away', async () => {
    renderPage('Engineer');
    await expectFreeReserved('50', '20');
    expect(screen.queryByRole('link', { name: /Slab pour/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Show work order' })[0]);
    expect(screen.getAllByRole('link', { name: 'WO-0001 - Slab pour' })[0]).toHaveAttribute('href', '/work-orders/wo1');
  });

  it('W9 the reserve dialog says how much is free before the quantity is typed', async () => {
    renderPage('Project Manager');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reserve' }))[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('50 bag free here')).toBeInTheDocument();
  });

  it('AC-RSV-003 says so when on hand is below what is reserved, never a negative figure', async () => {
    h.state.figs = [{ ...figure, qtyOnHand: '10', reservedQty: '20', freeQty: '0', shortBy: '10' }];
    renderPage('Engineer');
    await expectFreeReserved('0', '20');
    expect(screen.getAllByText('Reserved, short by 10').length).toBeGreaterThan(0);
  });

  it('AC-RSV-017 shows nothing new while reservations are off', async () => {
    h.state.on = false;
    renderPage('Admin');
    await screen.findByRole('table');
    expect(screen.queryByText(/reserved/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reserve' })).not.toBeInTheDocument();
  });

  it('AC-RSV-005 offers Reserve to a planner but not to an Engineer who keeps nothing here', async () => {
    const planner = renderPage('Project Manager');
    expect((await screen.findAllByRole('button', { name: 'Reserve' })).length).toBeGreaterThan(0);
    planner.unmount();
    renderPage('Engineer');
    await expectFreeReserved('50', '20');
    expect(screen.queryByRole('button', { name: 'Reserve' })).not.toBeInTheDocument();
  });
});
