import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
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

/** The movement form's own route, reduced to the kind it opened for. */
const NewMovementPage: React.FC = () => {
  const { kind } = useParams<{ kind: string }>();
  return <p>{`new movement: ${kind ?? ''}`}</p>;
};

/** The page inside the stock route table, so a control that navigates can be observed. */
const renderRouted = (role: Role = 'Admin') => {
  realRole = role;
  effectiveRole = null;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/stock']}>
          <Routes>
            <Route path="/stock" element={<StockOnHand />} />
            <Route path="/stock/documents" element={<p>documents page</p>} />
            <Route path="/stock/ledger" element={<p>ledger page</p>} />
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

describe('C18 — the balance list is ordered for scanning', () => {
  it('orders by item, then warehouse, so one item sits with all its stores instead of three lookups by eye', async () => {
    const siteB = { ...row, warehouseId: 'w2', warehouseCode: 'SITE-B', warehouseName: 'Site B' };
    const cable = { ...row, itemId: 'i2', itemCode: 'CAB', itemName: 'Cable 4mm' };
    // The RPC's own warehouse-then-item order, exactly what a reader is given today.
    reports.onHand.mockResolvedValue([row, cable, siteB]);
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('link').map((link) => link.textContent)).toEqual(['CAB', 'CEM', 'CEM']);
  });
});

describe('StockOnHand (AC-STK-032 states, AC-STK-020 cost by data)', () => {
  it('AC-STK-032 loading, then the populated balance with its quantity and unit', async () => {
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(await screen.findByText('CEM')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
  });

  it('the warehouse column says the name once, and the code only when two warehouses share a name', async () => {
    const { unmount } = renderPage();
    const name = await within(await screen.findByRole('table')).findByText('Site A');
    expect(name.closest('td')).toHaveTextContent(/^Site A$/);
    unmount();
    reports.onHand.mockResolvedValue([row, { ...row, itemId: 'i2', itemCode: 'CAB', warehouseId: 'w2', warehouseCode: 'SITE-B' }]);
    renderPage();
    const cells = (await screen.findAllByText(/Site A/)).map((el) => el.closest('td')?.textContent);
    expect(cells).toEqual(expect.arrayContaining([expect.stringContaining('SITE-A'), expect.stringContaining('SITE-B')]));
  });

  it('a compact figure line carries the counts and the total of the Value column', async () => {
    reports.onHand.mockResolvedValue([{ ...row, valueOnHand: '3500.00' }, { ...row, itemId: 'i2', itemCode: 'CAB', valueOnHand: '500.50' }]);
    renderPage();
    await screen.findByText('CEM');
    const line = screen.getByText('Items').closest('p')!;
    expect(line).toHaveTextContent(/2\s*Items/);
    expect(line).toHaveTextContent(/4,000/);
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
    expect(screen.queryByRole('columnheader', { name: 'Value' })).not.toBeInTheDocument();
    expect(screen.queryByText('Average cost')).not.toBeInTheDocument();
    unmount();
    reports.onHand.mockResolvedValue([{ ...row, valueOnHand: '3500.00', avgCost: '50.0000' }]);
    renderPage('Project Manager');
    await screen.findByText('CEM');
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect(screen.getByText('Average cost')).toBeInTheDocument();
    expect(screen.getAllByText(/3,500/).length).toBeGreaterThan(0);
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

  it('FR-STK-040 the filter also lists a never-stocked pair on the worklist, at 0, so both screens agree', async () => {
    reorder.worklist.mockResolvedValue([{ itemId: 'i9', itemCode: 'NEW', itemName: 'Never stocked', unitCode: 'm', warehouseId: 'w1', warehouseCode: 'SITE-A', qtyOnHand: '0', reorderLevel: '10', reorderQuantity: null }]);
    renderPage();
    await screen.findByText('CEM');
    await userEvent.click(screen.getByLabelText('Below reorder level'));
    expect(await screen.findByText('NEW')).toBeInTheDocument();
    expect(screen.queryByText('CEM')).not.toBeInTheDocument();
  });

  it('the worklist is not fetched while the filter is off', async () => {
    renderPage();
    await screen.findByText('CEM');
    expect(reorder.worklist).not.toHaveBeenCalled();
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

/** Judge rows on /stock (all-screens/judging/stock-on-hand.md): the count noun and the phone card. */
describe('C13/C18 the balance list says what it counts, at both widths', () => {
  const twoRows = () => [row, { ...row, itemId: 'i2', itemCode: 'CAB', itemName: 'Cable 4mm' }];

  it('the count beside the title says what it counts', async () => {
    reports.onHand.mockResolvedValue(twoRows());
    renderPage();
    await screen.findByText('CEM');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/2 balances/);
  });

  it('a search that narrows the list says how many of how many, with the noun', async () => {
    reports.onHand.mockResolvedValue(twoRows());
    renderPage();
    await screen.findByText('CAB');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search items' }), 'cable');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Showing 1 of 2 balances/);
  });

  it('at phone width all four filters stay and each balance card keeps every fact', async () => {
    reports.onHand.mockResolvedValue([{ ...row, valueOnHand: '3500.00', avgCost: '50.0000' }]);
    vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
      matches: false, media, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    renderPage();
    const cards = await screen.findByTestId('dt-card-branch');
    expect(screen.getByRole('checkbox', { name: 'Below reorder level' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show zero balances' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Warehouse' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search items')).toBeInTheDocument();

    const card = within(cards).getAllByRole('listitem')[0];
    expect(card).toHaveTextContent('CEM');
    expect(card).toHaveTextContent('Cement 50kg');
    expect(card).toHaveTextContent('Site A');
    expect(card).toHaveTextContent('70 bag');
    expect(card).toHaveTextContent(/3,500/);
  });
});

/** Floor list (all-screens/floor-tests/stock-on-hand.md): the items this suite did not yet cover. */
describe('AC-STK-032 floor: every control on the balance list still works', () => {
  it('the stock section strip opens Documents from On hand', async () => {
    renderRouted();
    await screen.findByText('CEM');
    await userEvent.click(screen.getByRole('link', { name: 'Documents' }));
    expect(await screen.findByText('documents page')).toBeInTheDocument();
  });

  it('Issue to project starts an issue movement', async () => {
    renderRouted();
    await screen.findByText('CEM');
    await userEvent.click(await screen.findByRole('button', { name: 'Issue to project' }));
    expect(await screen.findByText('new movement: issue')).toBeInTheDocument();
  });

  it('each movement in the More menu opens its own new-movement route', async () => {
    const movements = [
      ['Receive', 'receive'],
      ['Transfer', 'transfer'],
      ['Return from project', 'return'],
      ['Stock count', 'count'],
      ['Adjustment', 'adjustment'],
    ] as const;
    for (const [label, kind] of movements) {
      const view = renderRouted();
      await screen.findByText('CEM');
      await userEvent.click(screen.getByRole('button', { name: 'More' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: label }));
      expect(await screen.findByText(`new movement: ${kind}`)).toBeInTheDocument();
      view.unmount();
    }
  });
});
