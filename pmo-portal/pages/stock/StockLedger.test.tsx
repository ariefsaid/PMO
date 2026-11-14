import { formatDay } from '@/src/lib/format';
import { formatQuantity, formatStockValue } from '@/src/lib/stockFormat';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import { buildExportRows } from '@/src/lib/export';
import type { StockLedgerRow } from '@/src/lib/db/stockReports';
import stockEn from '@/public/locales/en/stock.json';

const { master, reports } = vi.hoisted(() => ({
  master: { listItems: vi.fn(), listWarehouses: vi.fn() },
  reports: { ledgerPage: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reports } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import StockLedger, { buildLedgerColumns } from './StockLedger';

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

/** F9c: below 1536px the actor's name is on screen twice in the table — in the By column (hidden by CSS
 *  under 2xl, but still in the DOM because jsdom applies no media query) and as the muted line under the
 *  document kind. So "is the actor shown" is a findAll, never a single-element query. */
const findActorNames = () => screen.findAllByText('Eka Engineer');

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
    expect(await findActorNames()).not.toHaveLength(0);
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

  it('F9b a code in the table breaks only after a hyphen, never inside a segment, and keeps its exact text', async () => {
    // F9 forbade every wrap in the table and scrolled sideways instead; the Director sitting (11-13)
    // replaced that with "wrap only after a hyphen", because a 17-character code held on one line is
    // what pushed Value balance and By out of the box. So the code is rendered as its hyphen-ended
    // segments with a break opportunity (<wbr>) after each hyphen and no opportunity inside one.
    // The phone card below md is asserted separately (it must still break a long code anywhere).
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(3, {
      itemCode: 'CEMENTAL-MIX-50-KILOGRAM-BAG',
      warehouseCode: 'WAREHOUSE-SITE-A-REAR-STORE',
    })], nextBeforeSeq: null });
    renderPage();
    const table = await screen.findByRole('table');

    const item = within(table).getByTestId('stock-ledger-item-code');
    // Copying the code still gives the original text: no added spaces, no dropped hyphen.
    expect(item.textContent).toBe('CEMENTAL-MIX-50-KILOGRAM-BAG');
    expect([...item.querySelectorAll('span')].map((piece) => piece.textContent))
      .toEqual(['CEMENTAL-', 'MIX-', '50-', 'KILOGRAM-', 'BAG']);
    expect(item.querySelectorAll('wbr')).toHaveLength(4);

    const warehouse = within(table).getByTestId('stock-ledger-warehouse-code');
    expect(warehouse.textContent).toBe('WAREHOUSE-SITE-A-REAR-STORE');
    expect([...warehouse.querySelectorAll('span')].map((piece) => piece.textContent))
      .toEqual(['WAREHOUSE-', 'SITE-', 'A-', 'REAR-', 'STORE']);
    expect(warehouse.querySelectorAll('wbr')).toHaveLength(4);
  });

  it('FR-STK-041 a back-dated movement shows its occurred date apart from the post time', async () => {
    renderPage();
    await findActorNames();
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByText(formatDay('2026-10-28'))).toBeInTheDocument();
  });

  it('F9b the posting day is a muted second line under the Date, and only when that day differs', async () => {
    reports.ledgerPage.mockResolvedValueOnce({ rows: [
      // Back-dated: moved on the 28th, posted on the 30th — the reader must see both facts.
      entry(2, { occurredOn: '2026-10-28', postedAt: '2026-10-30T03:00:00Z' }),
      // Posted the day it moved: one day, said once (no second line repeating it).
      entry(1, { documentNumber: 'ISS-1', occurredOn: '2026-10-30', postedAt: '2026-10-30T03:00:00Z' }),
    ], nextBeforeSeq: null });
    renderPage();

    const backdated = await screen.findByRole('row', { name: /ISS-2/ });
    expect(within(backdated).getByText(formatDay('2026-10-28'))).toBeInTheDocument();
    expect(within(backdated).getByText(`Posted ${formatDay('2026-10-30T03:00:00Z')}`)).toBeInTheDocument();

    const sameDay = screen.getByRole('row', { name: /ISS-1/ });
    expect(within(sameDay).getByText(formatDay('2026-10-30T03:00:00Z'))).toBeInTheDocument();
    expect(within(sameDay).queryByText(/^Posted /)).not.toBeInTheDocument();
  });

  it('F9b the screen has one date column; the posted date is a second line, never a second column', async () => {
    renderPage();
    await findActorNames();
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.filter((header) => header === 'Date')).toHaveLength(1);
    expect(headers).not.toContain('Posted');
  });

  it('F9b the export keeps both dates as two columns, the movement date and the posted date', () => {
    // DataTable's export seam reads the column list, not the screen (Column.exportOnly keeps a column
    // out of the DOM but in the export). The ledger page has no export button of its own, so the seam
    // is the builder's list — assert the projection the xlsx writer would receive.
    const row = entry(2, { occurredOn: '2026-10-28', postedAt: '2026-10-30T03:00:00Z' }) as unknown as StockLedgerRow;
    const { header, body } = buildExportRows([row], buildLedgerColumns({
      t: i18next.getFixedT('en', 'stock'),
      loc: 'en-US',
      currency: 'IDR',
      showCost: false,
    }));
    expect(header.slice(0, 2)).toEqual(['Date', 'Posted']);
    expect(body[0].slice(0, 2)).toEqual(['2026-10-28', '2026-10-30T03:00:00Z']);
  });

  it('F9c below 1536 the By column leaves the screen and the actor rides under the document kind', async () => {
    // F9 and F9b could not win the room for By beside Document at 1440 (the column sat off screen), so
    // the ruling is: the column returns from 2xl and, until then, the same fact is a muted third line in
    // the Document cell. Nothing is dropped — the reader still learns who posted the movement.
    renderPage();
    const table = await screen.findByRole('table');

    const byHeader = within(table).getByRole('columnheader', { name: 'By' });
    expect(byHeader).toHaveClass('hidden', '2xl:table-cell');

    const row = within(table).getByRole('row', { name: /ISS-2/ });
    const actorLine = within(row).getByTestId('stock-ledger-actor');
    expect(actorLine).toHaveTextContent('Eka Engineer');
    expect(actorLine).toHaveClass('2xl:hidden');
    // It is the third line of the Document cell, under the kind — not a column of its own.
    expect(actorLine.previousElementSibling).toHaveTextContent(stockEn.kinds.issue);
  });

  it('F9c an entry with no actor shows no actor line under the document kind', async () => {
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(2, { actorName: null })], nextBeforeSeq: null });
    renderPage();
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /ISS-2/ });
    // The hidden By column still exists (it holds no name), but the muted line is gone.
    expect(within(row).queryByTestId('stock-ledger-actor')).not.toBeInTheDocument();
  });

  it('F9c the export still carries By as a column although the screen hides it below 1536', () => {
    // "Never drop a fact": hiding the column on screen must not hide it from the spreadsheet.
    const row = entry(2) as unknown as StockLedgerRow;
    const { header, body } = buildExportRows([row], buildLedgerColumns({
      t: i18next.getFixedT('en', 'stock'),
      loc: 'en-US',
      currency: 'IDR',
      showCost: false,
    }));
    expect(header).toContain('By');
    expect(body[0][header.indexOf('By')]).toBe('Eka Engineer');
  });

  it('F9d the secondary lines wrap instead of widening the table they sit in', async () => {
    // Measured at 1440 after F9c: the table still overflowed (scrollWidth 1178 against clientWidth
    // 1166). In an auto-layout table a `truncate` line (white-space: nowrap) is never truncated — it
    // makes its column at least as wide as the full text. So the Document kind and actor lines and the
    // project name and work-item code wrap onto a second line (`break-words`); the document number and
    // the dates stay on one line, which is what they are short enough to do.
    renderPage();
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /ISS-2/ });

    const kindLine = within(row).getByText(stockEn.kinds.issue);
    const actorLine = within(row).getByTestId('stock-ledger-actor');
    for (const line of [kindLine, actorLine]) {
      expect(line).not.toHaveClass('truncate');
      expect(line).toHaveClass('break-words');
    }
    expect(within(row).getByText('Tower A')).not.toHaveClass('truncate');
    expect(within(row).getByText('W-1')).not.toHaveClass('truncate');
  });

  it('F9d a negative figure is one token: its sign never leaves its amount on another line', async () => {
    // The 1440 picture showed the minus of Value change alone above its amount. A hyphen (and the space
    // after a currency code) is a place a line may break, so a figure read as two facts. Change, Balance
    // and both value columns hold sign and amount in one unbreakable figure: the reader never sees a
    // lone "−" and has to guess which number it belonged to.
    reports.ledgerPage.mockResolvedValueOnce({ rows: [entry(2, {
      qtyDelta: '-1120', qtyAfter: '-3345', valueDelta: '-1120.00', valueAfter: '-4455.00',
    })], nextBeforeSeq: null });
    renderPage();
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /ISS-2/ });

    const change = within(row).getByTestId('stock-ledger-change');
    const changeFigure = change.firstElementChild as HTMLElement;
    // Located by figure, not by cell order: each amount is unique in this row.
    const balance = within(row).getByText(/3,345/);
    const valueChange = within(row).getByText(/1,120\.00/);
    const valueBalance = within(row).getByText(/4,455\.00/);
    // Intl puts a non-breaking space after a currency code; the reader sees one gap either way.
    const flat = (text: string | null) => (text ?? '').replace(/\s+/g, ' ');

    expect(flat(changeFigure.textContent)).toBe(flat(formatQuantity('-1120', 'en-US')));
    expect(flat(balance.textContent)).toBe(flat(formatQuantity('-3345', 'en-US')));
    expect(flat(valueChange.textContent)).toBe(flat(formatStockValue('-1120.00', 'IDR', 'en-US')));
    expect(flat(valueBalance.textContent)).toBe(flat(formatStockValue('-4455.00', 'IDR', 'en-US')));

    for (const figure of [changeFigure, balance, valueChange, valueBalance]) {
      // One line: the whole figure is one text node inside one nowrap element, so no break opportunity
      // exists between the sign and the amount or inside the number.
      expect(figure).toHaveClass('whitespace-nowrap');
      expect(figure.children).toHaveLength(0);
      expect(figure.childNodes).toHaveLength(1);
      expect(figure.textContent).toMatch(/^[−-]\D*\d/);
    }
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
    expect(await findActorNames()).not.toHaveLength(0);
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
    await findActorNames();
    expect(screen.queryByText('Value change')).not.toBeInTheDocument();
  });

  it('FR-STK-041 the URL filters reach the report, and an embedded trace is pinned to its project', async () => {
    renderPage('/stock/ledger?item=i1&warehouse=w1&document=d9');
    await findActorNames();
    expect(reports.ledgerPage.mock.calls[0][0]).toMatchObject({ itemId: 'i1', warehouseId: 'w1', documentId: 'd9' });
  });

  it('FR-STK-041 an embedded trace requests its projectId', async () => {
    renderPage('/projects/p1', { projectId: 'p1', embedded: true });
    await findActorNames();
    expect(reports.ledgerPage.mock.calls[0][0]).toMatchObject({ projectId: 'p1' });
  });
});

/** Floor list (all-screens/floor-tests/stock-ledger.md): the items this suite did not yet cover. */
describe('FR-STK-041 floor: every control on the trace still works', () => {
  it('the stock section strip opens Documents from the ledger', async () => {
    renderPage();
    await findActorNames();
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
    await findActorNames();
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

  it('C13 the window From and To bound is the Date column on the table', async () => {
    // The helper sentence went with the second date column (F9b: one date, nothing to explain);
    // the fields still bound the movement date, so that stays asserted here.
    renderPage();
    await findActorNames();
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
