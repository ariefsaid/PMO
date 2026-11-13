import { formatDay } from '@/src/lib/format';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
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

const renderPage = (path = '/stock/ledger', props: { projectId?: string; embedded?: boolean } = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/stock/documents" element={<p>documents page</p>} />
            <Route path="/stock/documents/:documentId" element={<p>document page</p>} />
            <Route path="*" element={<StockLedger {...props} />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listItems.mockResolvedValue([{ id: 'i1', code: 'CEM', name: 'Cement 50kg', archived_at: null }]);
  master.listWarehouses.mockResolvedValue([{ id: 'w1', code: 'SITE-A', name: 'Site A', archived_at: null }]);
  reports.ledgerPage.mockResolvedValue({ rows: [entry(2)], nextBeforeSeq: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('StockLedger (FR-STK-041, AC-STK-032)', () => {
  it('AC-STK-001 shows the actor, project, work item and running balance of an issue', async () => {
    renderPage();
    expect(await screen.findByText('Eka Engineer')).toBeInTheDocument();
    expect(screen.getByText('Tower A')).toBeInTheDocument();
    expect(screen.getByText('W-1')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
  });

  it('FR-STK-041 keeps long movement identity and quantity readable in the phone card', async () => {
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(3, {
      documentNumber: 'ISS-2026-VERY-LONG-REFERENCE',
      itemCode: 'CEMENTAL-MIX-50-KILOGRAM-BAG',
      warehouseCode: 'WAREHOUSE-SITE-A-REAR-STORE',
      qtyDelta: '500',
      unitCode: 'metric tons',
    })], nextBeforeSeq: null });
    vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    renderPage();

    const cards = await screen.findByTestId('dt-card-branch');
    expect(within(cards).getByText('ISS-2026-VERY-LONG-REFERENCE')).toBeVisible();
    expect(within(cards).getByTestId('stock-ledger-warehouse-code')).toHaveClass('break-all');
    const change = within(cards).getByTestId('stock-ledger-change');
    expect(change).toHaveClass('min-w-0', 'break-words');
    expect(change).toHaveTextContent('+500 metric tons');
  });

  it('F9 a code is never broken mid-code in the table: the row scrolls sideways instead', async () => {
    // A code has no spaces to break at, so the only thing that can break it is a CSS wrapping class.
    // This pins the two cells the picture showed snapped over three lines; the phone card below md is
    // asserted separately (it must still break a long code rather than push it out of the card).
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(3, {
      itemCode: 'CEMENTAL-MIX-50-KILOGRAM-BAG',
      warehouseCode: 'WAREHOUSE-SITE-A-REAR-STORE',
    })], nextBeforeSeq: null });
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByTestId('stock-ledger-warehouse-code')).toHaveClass('md:whitespace-nowrap');
    expect(within(table).getByText('CEMENTAL-MIX-50-KILOGRAM-BAG')).toHaveClass('md:whitespace-nowrap');
  });

  it('FR-STK-041 a back-dated movement shows its occurred date apart from the post time', async () => {
    renderPage();
    await screen.findByText('Eka Engineer');
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByText(formatDay('2026-10-28'))).toBeInTheDocument();
  });

  it('AC-STK-032 loading, empty, error with retry', async () => {
    reports.ledgerPage.mockResolvedValueOnce({ rows: [], nextBeforeSeq: null });
    const { unmount } = renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(await screen.findByText('Nothing posted yet')).toBeInTheDocument();
    unmount();
    reports.ledgerPage.mockRejectedValueOnce(new AppError('boom'));
    renderPage();
    expect(await screen.findByText("Couldn't load stock")).toBeInTheDocument();
    reports.ledgerPage.mockResolvedValue({ rows: [entry(2)], nextBeforeSeq: null });
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Eka Engineer')).toBeInTheDocument();
  });

  it('FR-STK-041 Load more follows the cursor and appends older entries', async () => {
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(9)], nextBeforeSeq: 9 });
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(8, { documentNumber: 'ISS-8' })], nextBeforeSeq: null });
    renderPage();
    await screen.findByText('ISS-9');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('ISS-8')).toBeInTheDocument();
    expect(reports.ledgerPage.mock.calls[1][0]).toMatchObject({ beforeSeq: 9 });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('C8 StockLedger.tsx:108 labels loaded rows as partial and uses the same total at the end', async () => {
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(9)], nextBeforeSeq: 9 });
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(8, { documentNumber: 'ISS-8' })], nextBeforeSeq: null });
    renderPage();
    await screen.findByText('ISS-9');

    expect(screen.getByText('1 loaded, more available')).toBeInTheDocument();
    expect(screen.queryByText('Ledger 1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('ISS-8')).toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();
    expect(screen.getByTestId('list-page-count')).toHaveTextContent('2');
  });

  it('AC-STK-020 value columns appear only when the server sent value keys', async () => {
    renderPage();
    await screen.findByText('Eka Engineer');
    expect(screen.queryByText('Value change')).not.toBeInTheDocument();
  });

  it('FR-STK-041 the URL filters reach the report, and an embedded trace is pinned to its project', async () => {
    renderPage('/stock/ledger?item=i1&warehouse=w1&document=d9');
    await screen.findByText('Eka Engineer');
    expect(reports.ledgerPage.mock.calls[0][0]).toMatchObject({ itemId: 'i1', warehouseId: 'w1', documentId: 'd9' });
  });

  it('FR-STK-041 an embedded trace requests its projectId', async () => {
    renderPage('/projects/p1', { projectId: 'p1', embedded: true });
    await screen.findByText('Eka Engineer');
    expect(reports.ledgerPage.mock.calls[0][0]).toMatchObject({ projectId: 'p1' });
  });
});

/** Floor list (all-screens/floor-tests/stock-ledger.md): the items this suite did not yet cover. */
describe('FR-STK-041 floor: every control on the trace still works', () => {
  it('the stock section strip opens Documents from the ledger', async () => {
    renderPage();
    await screen.findByText('Eka Engineer');
    await userEvent.click(screen.getByRole('link', { name: 'Documents' }));
    expect(await screen.findByText('documents page')).toBeInTheDocument();
  });

  it('choosing an item and then a warehouse narrows the trace and the URL', async () => {
    master.listItems.mockResolvedValue([
      { id: 'i1', code: 'CEM', name: 'Cement 50kg', archived_at: null },
      { id: 'i2', code: 'CAB', name: 'Cable 4mm', archived_at: null },
    ]);
    master.listWarehouses.mockResolvedValue([
      { id: 'w1', code: 'SITE-A', name: 'Site A', archived_at: null },
      { id: 'w2', code: 'SITE-B', name: 'Site B', archived_at: null },
    ]);
    renderPage();
    await screen.findByText('Eka Engineer');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), 'i2');
    await vi.waitFor(() => expect(reports.ledgerPage.mock.calls.at(-1)?.[0]).toMatchObject({ itemId: 'i2' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Warehouse' }), 'w2');
    await vi.waitFor(() => expect(reports.ledgerPage.mock.calls.at(-1)?.[0]).toMatchObject({ itemId: 'i2', warehouseId: 'w2' }));
  });

  it('From and To set the window the trace reads, and entries outside it leave the table', async () => {
    reports.ledgerPage.mockImplementation((f?: { from?: string; to?: string }) => Promise.resolve(
      f?.from || f?.to
        ? { rows: [entry(2)], nextBeforeSeq: null }
        : { rows: [entry(2), entry(1, { id: 'e1', documentNumber: 'ISS-1' })], nextBeforeSeq: null },
    ));
    renderPage();
    await screen.findByText('ISS-1');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    await vi.waitFor(() => expect(reports.ledgerPage.mock.calls.at(-1)?.[0]).toMatchObject({ from: '2026-10-01' }));
    expect(screen.queryByText('ISS-1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } });
    await vi.waitFor(() => expect(reports.ledgerPage.mock.calls.at(-1)?.[0]).toMatchObject({ from: '2026-10-01', to: '2026-10-31' }));
  });

  it('the document number opens that stock document record', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('link', { name: 'ISS-2' }));
    expect(await screen.findByText('document page')).toBeInTheDocument();
  });

  it('C13 the From and To fields say which date they bound, and the date they bound is on the table', async () => {
    renderPage();
    await screen.findByText('Eka Engineer');
    expect(screen.getByText('From and To filter the movement date (the Date column), not when the entry was posted.')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
  });

  it('C13 a cost-rank role always sees the value columns, never a ledger with no money', async () => {
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(2, { valueDelta: '-1500000.00', valueAfter: '3500000.00' })], nextBeforeSeq: null });
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Value change' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Value balance' })).toBeInTheDocument();
  });

  it('C1 a failed next page says so, and its Retry follows the cursor again', async () => {
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(9)], nextBeforeSeq: 9 });
    reports.ledgerPage.mockRejectedValueOnce(new AppError('boom'));
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(8, { documentNumber: 'ISS-8' })], nextBeforeSeq: null });
    renderPage();
    await screen.findByText('ISS-9');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText("Couldn't load more entries")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('ISS-8')).toBeInTheDocument();
    expect(reports.ledgerPage.mock.calls[2][0]).toMatchObject({ beforeSeq: 9 });
  });
});
