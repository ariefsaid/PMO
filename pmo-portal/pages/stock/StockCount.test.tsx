import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

const { master, documents, reports } = vi.hoisted(() => ({
  master: { listUnits: vi.fn(), listItems: vi.fn(), listWarehouses: vi.fn(), listKeepers: vi.fn() },
  documents: { create: vi.fn(), saveDraft: vi.fn(), post: vi.fn(), get: vi.fn() },
  reports: { onHand: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, documents, reports } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
let realRole: Role = 'Engineer';
let effectiveRole: Role = 'Engineer';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole }) }));

import StockCount from './StockCount';

const unit = { id: 'u1', code: 'bag', name: 'Bag', whole_only: true, archived_at: null };
const metre = { id: 'u2', code: 'm', name: 'Metre', whole_only: false, archived_at: null };
const cem = { id: 'i1', code: 'CEM', name: 'Cement 50kg', unit_id: 'u1', archived_at: null };
const cab = { id: 'i2', code: 'CAB', name: 'Cable 4mm', unit_id: 'u2', archived_at: null };
const wh = (id: string, code: string) => ({ id, code, name: `${code} store`, kind: 'site', project_id: null, archived_at: null });
const onHand = (itemId: string, code: string, qty: string) => ({
  itemId, itemCode: code, itemName: code, unitCode: 'm', wholeOnly: false, warehouseId: 'w1', warehouseCode: 'SITE-A', warehouseName: 'Site A', warehouseKind: 'site', qtyOnHand: qty,
});
const draft = (over: Record<string, unknown> = {}) => ({
  id: 'd1', number: 'CNT-1', kind: 'count', status: 'Draft', warehouse_id: 'w1', to_warehouse_id: null, project_id: null, procurement_id: null, reason: null, note: null,
  occurred_on: '2026-10-30', created_by: 'me', created_at: 't', posted_by: null, posted_at: null, cancelled_at: null,
  warehouse: { code: 'SITE-A', name: 'Site A' }, to_warehouse: null, project: null, author: { full_name: 'Me' },
  lines: [{ id: 'l1', line_no: 1, item_id: 'i2', quantity: null, counted_quantity: '92', expected_quantity: null, direction: null, boq_item_id: null, source_line_id: null, item: { code: 'CAB', name: 'Cable 4mm', unit: { code: 'm', whole_only: false } } }],
  ...over,
});

const renderAt = (path: string, role: Role = 'Engineer', viewingAs: Role = role) => {
  realRole = role; effectiveRole = viewingAs;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/stock/new/:kind" element={<StockCount />} />
            <Route path="/stock/documents/:documentId/edit" element={<StockCount />} />
            <Route path="/stock/documents/:documentId" element={<p>document page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

async function pickItem(search: string, option: RegExp, n = '') {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(`^Item${n}`) }));
  await userEvent.type(screen.getByRole('searchbox'), search);
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listUnits.mockResolvedValue([unit, metre]);
  master.listItems.mockResolvedValue([cem, cab]);
  master.listWarehouses.mockResolvedValue([wh('w1', 'SITE-A'), wh('w2', 'SITE-B')]);
  master.listKeepers.mockResolvedValue([{ warehouse_id: 'w1', user_id: 'me', org_id: 'org-1' }]);
  reports.onHand.mockResolvedValue([onHand('i2', 'CAB', '100')]);
  documents.create.mockResolvedValue('doc-1');
  documents.saveDraft.mockResolvedValue(undefined);
  documents.post.mockResolvedValue(undefined);
  documents.get.mockResolvedValue(draft());
});

describe('StockCount', () => {
  it('FR-STK-025 the count sheet shows the system quantity next to each counted quantity and the variance preview', async () => {
    const { container } = renderAt('/stock/new/count');
    await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
    await pickItem('cab', /CAB - Cable 4mm/);
    await userEvent.type(screen.getByLabelText(/^Counted/), '92');
    expect(await screen.findByTestId('system-1')).toHaveTextContent('100');
    expect(screen.getByTestId('variance-1')).toHaveTextContent('-8');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FR-STK-025 "Fill from stock on hand" lists every item the warehouse holds', async () => {
    reports.onHand.mockResolvedValue([onHand('i1', 'CEM', '40'), onHand('i2', 'CAB', '100')]);
    renderAt('/stock/new/count');
    await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
    await userEvent.click(await screen.findByRole('button', { name: 'Fill from stock on hand' }));
    expect(screen.getByTestId('system-1')).toHaveTextContent('40');
    expect(screen.getByTestId('system-2')).toHaveTextContent('100');
  });

  it('FR-STK-062 the author sees "Another person must post this" and no Post button when there is a variance', async () => {
    renderAt('/stock/new/count');
    await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
    await pickItem('cab', /CAB - Cable 4mm/);
    await userEvent.type(screen.getByLabelText(/^Counted/), '92');
    expect(await screen.findByText(/Another person must post this/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post count' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(documents.create).toHaveBeenCalledTimes(1));
    expect(documents.create.mock.calls[0][0]).toEqual({ kind: 'count', warehouseId: 'w1', lines: [{ itemId: 'i2', countedQuantity: '92' }] });
    expect(documents.create.mock.calls[0][1]).toMatchObject({ post: false });
    expect(await screen.findByText('document page')).toBeInTheDocument();
  });

  it('FR-STK-062 a count with no variance may be posted by its author', async () => {
    renderAt('/stock/new/count');
    await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
    await pickItem('cab', /CAB - Cable 4mm/);
    await userEvent.type(screen.getByLabelText(/^Counted/), '100');
    await userEvent.click(await screen.findByRole('button', { name: 'Post count' }));
    await waitFor(() => expect(documents.create).toHaveBeenCalledTimes(1));
    expect(documents.create.mock.calls[0][1]).toMatchObject({ post: true });
  });

  it('FR-STK-025 finding stock where the system holds none asks for a unit cost before sending', async () => {
    renderAt('/stock/new/count', 'Project Manager');
    await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
    await pickItem('cem', /CEM - Cement 50kg/);
    await userEvent.type(screen.getByLabelText(/^Counted/), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Enter the unit cost: the system holds none of this item.')).toBeInTheDocument();
    expect(documents.create).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/^Unit cost/), '40');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(documents.create).toHaveBeenCalled());
    expect(documents.create.mock.calls[0][0].lines).toEqual([{ itemId: 'i1', countedQuantity: '5', unitCost: '40' }]);
  });

  it('a Draft can be saved, reopened and edited, then posted (save first, then post)', async () => {
    renderAt('/stock/documents/d1/edit');
    const counted = await screen.findByLabelText(/^Counted/);
    expect(counted).toHaveValue('92');
    expect(await screen.findByRole('combobox', { name: /^Item/ })).toHaveTextContent('CAB - Cable 4mm'); // the reopened line names its item
    await userEvent.clear(counted);
    await userEvent.type(counted, '100');
    await userEvent.click(await screen.findByRole('button', { name: 'Post count' }));
    await waitFor(() => expect(documents.post).toHaveBeenCalledWith('d1'));
    expect(documents.saveDraft).toHaveBeenCalledWith('d1', { kind: 'count', warehouseId: 'w1', lines: [{ itemId: 'i2', countedQuantity: '100' }] });
    expect(documents.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(documents.post.mock.invocationCallOrder[0]);
    expect(await screen.findByText('document page')).toBeInTheDocument();
  });

  it('FR-STK-024 an adjustment needs a reason and sends the direction; its author can only save it', async () => {
    renderAt('/stock/new/adjustment');
    await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
    await pickItem('cab', /CAB - Cable 4mm/);
    await userEvent.selectOptions(screen.getByLabelText(/^Direction/), 'out');
    await userEvent.type(screen.getByLabelText(/^Quantity/), '2');
    expect(screen.getByText(/Another person must post this/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Post/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Say why the stock changed.')).toBeInTheDocument();
    expect(documents.create).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/^Reason/), 'damaged');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(documents.create).toHaveBeenCalled());
    expect(documents.create.mock.calls[0][0]).toEqual({ kind: 'adjustment', warehouseId: 'w1', reason: 'damaged', lines: [{ itemId: 'i2', quantity: '2', direction: 'out' }] });
  });

  it('AC-STK-032 loading, then populated', async () => {
    renderAt('/stock/new/count');
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Warehouse/)).toBeInTheDocument();
  });

  it('AC-STK-032 empty: no warehouse you keep', async () => {
    master.listKeepers.mockResolvedValue([]);
    renderAt('/stock/new/count');
    expect(await screen.findByText('You keep no warehouse')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });

  it('AC-STK-032 error shows a retry, never a fabricated zero', async () => {
    reports.onHand.mockRejectedValueOnce(new Error('boom'));
    renderAt('/stock/new/count');
    await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
    await pickItem('cab', /CAB - Cable 4mm/);
    expect(await screen.findByText("Couldn't load the quantities on hand")).toBeInTheDocument();
    expect(screen.queryByTestId('system-1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByTestId('system-1')).toHaveTextContent('100');
  });

  it('FR-STK-064 a view-as session keeps the page read-only', async () => {
    renderAt('/stock/new/count', 'Admin', 'Engineer');
    await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });
});
