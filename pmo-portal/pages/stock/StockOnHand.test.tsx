import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import stockEn from '@/public/locales/en/stock.json';

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

const renderPage = (role: Role = 'Project Manager', viewAs: Role | null = null) => {
  realRole = role;
  effectiveRole = viewAs;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter><StockOnHand /></MemoryRouter></ToastProvider></QueryClientProvider>);
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listWarehouses.mockResolvedValue([{ id: 'w1', code: 'SITE-A', name: 'Site A', kind: 'site', archived_at: null }]);
  master.listKeepers.mockResolvedValue([]);
  reports.onHand.mockResolvedValue([row]);
  reorder.worklist.mockResolvedValue([]);
});

describe('StockOnHand (AC-STK-032 states, AC-STK-020 cost by data)', () => {
  it('AC-STK-032 loading, then the populated balance with its quantity and unit', async () => {
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(await screen.findByText('CEM')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
  });

  it('the warehouse column names the warehouse, its code secondary (like items)', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    const name = await within(table).findByText('Site A');
    expect(name.closest('td')).toHaveTextContent(/Site A\s*SITE-A/);
  });

  it('AC-STK-032 empty: no stock yet', async () => {
    reports.onHand.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No stock yet')).toBeInTheDocument();
  });

  it('AC-STK-032 error shows a retry, never a zero', async () => {
    reports.onHand.mockRejectedValueOnce(new AppError('boom'));
    renderPage();
    expect(await screen.findByText("Couldn't load stock")).toBeInTheDocument();
    reports.onHand.mockResolvedValue([row]);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('CEM')).toBeInTheDocument();
  });

  it('AC-STK-020 value columns follow the DATA: absent when the response has no value key, present when it does', async () => {
    const { unmount } = renderPage('Engineer');
    await screen.findByText('CEM');
    expect(screen.queryByText('Value')).not.toBeInTheDocument();
    expect(screen.queryByText('Average cost')).not.toBeInTheDocument();
    unmount();
    reports.onHand.mockResolvedValue([{ ...row, valueOnHand: '3500.00', avgCost: '50.0000' }]);
    renderPage('Project Manager');
    await screen.findByText('CEM');
    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.getByText('Average cost')).toBeInTheDocument();
    expect(screen.getByText(/3,500/)).toBeInTheDocument();
  });

  it('FR-STK-040 the "Below reorder level" filter keeps only balances on the reorder worklist', async () => {
    const other = { ...row, itemId: 'i2', itemCode: 'CAB', itemName: 'Cable 4mm' };
    reports.onHand.mockResolvedValue([row, other]);
    reorder.worklist.mockResolvedValue([{ itemId: 'i2', warehouseId: 'w1', itemCode: 'CAB' }]);
    renderPage();
    await screen.findByText('CEM');
    expect(screen.getByText('CAB')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Below reorder level'));
    expect(screen.getByText('CAB')).toBeInTheDocument();
    expect(screen.queryByText('CEM')).not.toBeInTheDocument();
  });

  it('FR-STK-040 with nothing below its level the filter says so instead of showing every balance', async () => {
    renderPage();
    await screen.findByText('CEM');
    await userEvent.click(screen.getByLabelText('Below reorder level'));
    expect(screen.queryByText('CEM')).not.toBeInTheDocument();
    expect(screen.getByText('Nothing matches')).toBeInTheDocument();
  });

  it('FR-STK-064 view-as is view-only: an Admin viewing as an Engineer sees no movement buttons', async () => {
    renderPage('Admin', 'Engineer');
    await screen.findByText('CEM');
    expect(screen.queryByRole('button', { name: 'Issue to project' })).not.toBeInTheDocument();
  });

  it('FR-STK-064 movement actions appear only for a keeper (Admin always); a non-keeper sees none', async () => {
    const { unmount } = renderPage('Engineer');
    await screen.findByText('CEM');
    expect(screen.queryByRole('button', { name: 'Issue to project' })).not.toBeInTheDocument();
    unmount();
    master.listKeepers.mockResolvedValue([{ warehouse_id: 'w1', user_id: 'me', org_id: 'org-1' }]);
    renderPage('Engineer');
    expect(await screen.findByRole('button', { name: 'Issue to project' })).toBeInTheDocument();
  });

  it('typing in search narrows the list by code or name', async () => {
    reports.onHand.mockResolvedValue([row, { ...row, itemId: 'i2', itemCode: 'CAB', itemName: 'Cable 4mm' }]);
    renderPage();
    await screen.findByText('CAB');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search items' }), 'cable');
    expect(screen.queryByText('CEM')).not.toBeInTheDocument();
    expect(screen.getByText('CAB')).toBeInTheDocument();
  });
});
