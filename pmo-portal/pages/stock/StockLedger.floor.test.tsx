import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

const { master, reports } = vi.hoisted(() => ({
  master: { listItems: vi.fn(), listWarehouses: vi.fn() },
  reports: { ledgerPage: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reports } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import StockLedger from './StockLedger';

const entry = (seq: number, over: Record<string, unknown> = {}) => ({
  seq, id: `e${seq}`, documentId: 'd1', documentNumber: `ISS-${seq}`, documentStatus: 'Posted', kind: 'issue', postedAt: '2026-10-30T03:00:00Z', occurredOn: '2026-10-28', postedBy: 'u1', actorName: 'Eka Engineer',
  itemId: 'i1', itemCode: 'CEM', itemName: 'Cement 50kg', unitCode: 'bag', warehouseId: 'w1', warehouseCode: 'SITE-A', projectId: 'p1', projectName: 'Tower A', boqItemId: 'b1', boqItemCode: 'W-1',
  qtyDelta: '-30', qtyAfter: '70', ...over,
});

function CurrentUrlFilters() {
  const location = useLocation();
  return <output aria-label="Current URL filters">{location.search}</output>;
}

const renderPage = (path = '/stock/ledger') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/stock/documents" element={<p>documents page</p>} />
            <Route path="/stock/documents/:documentId" element={<p>document page</p>} />
            <Route path="*" element={<><StockLedger /><CurrentUrlFilters /></>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

const findActorNames = () => screen.findAllByText('Eka Engineer');

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listItems.mockResolvedValue([{ id: 'i1', code: 'CEM', name: 'Cement 50kg', archived_at: null }]);
  master.listWarehouses.mockResolvedValue([{ id: 'w1', code: 'SITE-A', name: 'Site A', archived_at: null }]);
  reports.ledgerPage.mockResolvedValue({ rows: [entry(2)], nextBeforeSeq: null });
});

describe('StockLedger floor controls', () => {
  it('floor: Documents navigation opens the stock document list', async () => {
    renderPage();
    await findActorNames();
    await userEvent.click(screen.getByRole('link', { name: 'Documents' }));
    expect(await screen.findByText('documents page')).toBeInTheDocument();
  });

  it('floor: Item selection filters the trace and updates its URL', async () => {
    master.listItems.mockResolvedValue([
      { id: 'i1', code: 'CEM', name: 'Cement 50kg', archived_at: null },
      { id: 'i2', code: 'CAB', name: 'Cable 4mm', archived_at: null },
    ]);
    reports.ledgerPage.mockImplementation((filters?: { itemId?: string }) => Promise.resolve({
      rows: filters?.itemId === 'i2'
        ? [entry(3, { documentNumber: 'ISS-3', itemId: 'i2', itemCode: 'CAB', itemName: 'Cable 4mm' })]
        : [entry(2)],
      nextBeforeSeq: null,
    }));
    renderPage();
    await findActorNames();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), 'i2');
    await vi.waitFor(() => expect(reports.ledgerPage.mock.calls.at(-1)?.[0]).toMatchObject({ itemId: 'i2' }));
    expect(screen.getByLabelText('Current URL filters')).toHaveTextContent('item=i2');
    const table = screen.getByRole('table');
    expect(within(table).getByText('ISS-3')).toBeVisible();
    expect(within(table).queryByText('ISS-2')).not.toBeInTheDocument();
  });

  it('floor: Warehouse selection filters the trace and updates its URL', async () => {
    master.listWarehouses.mockResolvedValue([
      { id: 'w1', code: 'SITE-A', name: 'Site A', archived_at: null },
      { id: 'w2', code: 'SITE-B', name: 'Site B', archived_at: null },
    ]);
    reports.ledgerPage.mockImplementation((filters?: { warehouseId?: string }) => Promise.resolve({
      rows: filters?.warehouseId === 'w2'
        ? [entry(3, { documentNumber: 'ISS-3', warehouseId: 'w2', warehouseCode: 'SITE-B' })]
        : [entry(2)],
      nextBeforeSeq: null,
    }));
    renderPage();
    await findActorNames();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Warehouse' }), 'w2');
    await vi.waitFor(() => expect(reports.ledgerPage.mock.calls.at(-1)?.[0]).toMatchObject({ warehouseId: 'w2' }));
    expect(screen.getByLabelText('Current URL filters')).toHaveTextContent('warehouse=w2');
    const table = screen.getByRole('table');
    expect(within(table).getByText('ISS-3')).toBeVisible();
    expect(within(table).queryByText('ISS-2')).not.toBeInTheDocument();
  });

  it('floor: From date excludes earlier movements from the trace query', async () => {
    reports.ledgerPage.mockImplementation((filters?: { from?: string }) => Promise.resolve({
      rows: filters?.from
        ? [entry(2)]
        : [entry(2), entry(1, { id: 'e1', documentNumber: 'ISS-1', occurredOn: '2026-09-28' })],
      nextBeforeSeq: null,
    }));
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('ISS-1')).toBeVisible();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    await vi.waitFor(() => expect(reports.ledgerPage.mock.calls.at(-1)?.[0]).toMatchObject({ from: '2026-10-01' }));
    expect(screen.getByLabelText('Current URL filters')).toHaveTextContent('from=2026-10-01');
    expect(within(table).queryByText('ISS-1')).not.toBeInTheDocument();
  });

  it('floor: To date excludes later movements from the trace query', async () => {
    reports.ledgerPage.mockImplementation((filters?: { to?: string }) => Promise.resolve({
      rows: filters?.to
        ? [entry(1, { id: 'e1', documentNumber: 'ISS-1', occurredOn: '2026-09-28' })]
        : [entry(2), entry(1, { id: 'e1', documentNumber: 'ISS-1', occurredOn: '2026-09-28' })],
      nextBeforeSeq: null,
    }));
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('ISS-2')).toBeVisible();
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });
    await vi.waitFor(() => expect(reports.ledgerPage.mock.calls.at(-1)?.[0]).toMatchObject({ to: '2026-10-01' }));
    expect(screen.getByLabelText('Current URL filters')).toHaveTextContent('to=2026-10-01');
    expect(within(table).queryByText('ISS-2')).not.toBeInTheDocument();
  });

  it('floor: Document number opens the corresponding stock document record', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('link', { name: 'ISS-2' }));
    expect(await screen.findByText('document page')).toBeInTheDocument();
  });
});
