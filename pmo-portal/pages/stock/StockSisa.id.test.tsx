import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';
import stockId from '@/public/locales/id/stock.json';

const { master, reports, reorder } = vi.hoisted(() => ({
  master: { listWarehouses: vi.fn(), listKeepers: vi.fn(), listItems: vi.fn() },
  reports: { onHand: vi.fn(), ledgerPage: vi.fn() },
  reorder: { worklist: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reports, reorder } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }) }));

import StockOnHand from './StockOnHand';
import StockLedger from './StockLedger';

const row = { itemId: 'i1', itemCode: 'CEM', itemName: 'Cement 50kg', unitCode: 'bag', wholeOnly: true, warehouseId: 'w1', warehouseCode: 'SITE-A', warehouseName: 'Site A', warehouseKind: 'site', qtyOnHand: '70' };
const entry = { seq: 2, id: 'e2', documentId: 'd1', documentNumber: 'ISS-2', documentStatus: 'Posted', kind: 'issue', postedAt: '2026-10-30T03:00:00Z', occurredOn: '2026-10-28', postedBy: 'u1', actorName: 'Eka Engineer', itemId: 'i1', itemCode: 'CEM', itemName: 'Cement 50kg', unitCode: 'bag', warehouseId: 'w1', warehouseCode: 'SITE-A', projectId: 'p1', projectName: 'Tower A', boqItemId: 'b1', boqItemCode: 'W-1', qtyDelta: '-30', qtyAfter: '70' };

const mount = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter>{ui}</MemoryRouter></ToastProvider></QueryClientProvider>);
};

beforeAll(async () => {
  i18next.addResourceBundle('en', 'stock', stockEn, true, true);
  i18next.addResourceBundle('id', 'stock', stockId, true, true);
  await i18next.changeLanguage('id');
});
afterAll(async () => { await i18next.changeLanguage('en'); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listWarehouses.mockResolvedValue([{ id: 'w1', code: 'SITE-A', name: 'Site A', kind: 'site', archived_at: null }]);
  master.listKeepers.mockResolvedValue([]);
  master.listItems.mockResolvedValue([{ id: 'i1', code: 'CEM', name: 'Cement 50kg', archived_at: null }]);
  reports.onHand.mockResolvedValue([row]);
  reports.ledgerPage.mockResolvedValue({ rows: [entry], nextBeforeSeq: null });
  reorder.worklist.mockResolvedValue([]);
});

describe('#2451: a stock quantity left is "sisa" in Bahasa, never "saldo"', () => {
  it('the Stock balances view says no "saldo" and shows the sisa count', async () => {
    const { container } = mount(<StockOnHand />);
    await screen.findByText('Cement 50kg');
    expect(container.textContent ?? '').not.toMatch(/saldo/i);
    expect(container.textContent ?? '').toMatch(/sisa/i);
  });

  it('the stock ledger says no "saldo" in its running quantity or value columns', async () => {
    const { container } = mount(<StockLedger />);
    await waitFor(() => expect(screen.getAllByText('Cement 50kg').length).toBeGreaterThan(0));
    expect(container.textContent ?? '').not.toMatch(/saldo/i);
    expect(container.textContent ?? '').toMatch(/sisa/i);
  });

  it('no stock catalogue string in Bahasa calls a quantity "saldo"', () => {
    expect(JSON.stringify(stockId)).not.toMatch(/saldo/i);
  });
});
