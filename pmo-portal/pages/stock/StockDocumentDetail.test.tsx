import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import stockEn from '@/public/locales/en/stock.json';

const { documents, reports, master, consumption } = vi.hoisted(() => ({
  documents: { get: vi.fn(), cancel: vi.fn(), post: vi.fn(), costs: vi.fn() },
  reports: { ledgerAll: vi.fn(), onHand: vi.fn() },
  master: { listKeepers: vi.fn() },
  consumption: { report: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { documents, reports, master, consumption } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
let role: Role = 'Engineer';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: role, effectiveRole: role }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import StockDocumentDetail from './StockDocumentDetail';

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'd1', number: 'ISS-1', kind: 'issue', status: 'Posted', revision: 4, warehouse_id: 'w1', to_warehouse_id: null, project_id: 'p1', procurement_id: null, reason: null, note: 'for slab', occurred_on: '2026-10-30',
  created_by: 'me', created_at: '2026-10-30T03:00:00Z', posted_by: 'me', posted_at: '2026-10-30T03:00:00Z', cancelled_at: null,
  warehouse: { code: 'SITE-A', name: 'Site A' }, to_warehouse: null, project: { name: 'Tower A' }, author: { full_name: 'Eka Engineer' },
  lines: [{ id: 'l1', line_no: 1, item_id: 'i1', quantity: '30', counted_quantity: null, expected_quantity: null, direction: null, boq_item_id: 'b1', source_line_id: null, item: { code: 'CEM', name: 'Cement 50kg', unit: { code: 'bag', whole_only: true } } }],
  ...over,
});
const entry = { seq: 5, id: 'e5', documentId: 'd1', documentNumber: 'ISS-1', documentStatus: 'Posted', kind: 'issue', postedAt: 't', occurredOn: '2026-10-30', postedBy: 'me', actorName: 'Eka', itemId: 'i1', itemCode: 'CEM', itemName: 'Cement', unitCode: 'bag', warehouseId: 'w1', warehouseCode: 'SITE-A', projectId: 'p1', projectName: 'Tower A', boqItemId: null, boqItemCode: null, qtyDelta: '-30', qtyAfter: '70' };

const countDraft = (over: Record<string, unknown> = {}) => detail({
  number: 'CNT-1', kind: 'count', status: 'Draft', project_id: null, project: null, posted_by: null, posted_at: null,
  lines: [{ id: 'l1', line_no: 1, item_id: 'i2', quantity: null, counted_quantity: '92', expected_quantity: null, direction: null, boq_item_id: null, source_line_id: null, item: { code: 'CAB', name: 'Cable 4mm', unit: { code: 'm', whole_only: false } } }],
  ...over,
});
const renderPage = (r: Role = 'Engineer') => {
  role = r;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={['/stock/documents/d1']}>
      <Routes><Route path="/stock/documents/:documentId" element={<StockDocumentDetail />} /><Route path="/stock/documents" element={<p>list page</p>} /><Route path="/stock/documents/:documentId/edit" element={<p>edit page</p>} /></Routes>
    </MemoryRouter></ToastProvider></QueryClientProvider>,
  );
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  documents.get.mockResolvedValue(detail());
  documents.cancel.mockResolvedValue(undefined);
  documents.post.mockResolvedValue(undefined);
  reports.ledgerAll.mockResolvedValue([entry]);
  reports.onHand.mockResolvedValue([]);
  documents.costs.mockResolvedValue([]);
  master.listKeepers.mockResolvedValue([]);
  consumption.report.mockResolvedValue({ from: 'a', to: 'b', months: [], allowances: [], unplanned: [] });
});

describe('StockDocumentDetail (AC-STK-032)', () => {
  it('AC-STK-032 loading, then the header, the lines and the ledger entries it posted', async () => {
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(await screen.findByText('ISS-1')).toBeInTheDocument();
    expect(screen.getByText('Tower A')).toBeInTheDocument();
    expect((await screen.findAllByText('CEM')).length).toBeGreaterThanOrEqual(2);
    expect(reports.ledgerAll).toHaveBeenCalledWith({ documentId: 'd1' });
  });

  it('AC-STK-032 error with retry, and a not-found state for a missing or foreign document', async () => {
    documents.get.mockRejectedValueOnce(new AppError('boom'));
    const { unmount } = renderPage();
    expect(await screen.findByText("Couldn't load stock")).toBeInTheDocument();
    unmount();
    documents.get.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('Document not found')).toBeInTheDocument();
  });

  it('AC-STK-020 entry value is hidden when the entries carry no value key', async () => {
    renderPage();
    await screen.findByText('ISS-1');
    expect(screen.queryByText('Value')).not.toBeInTheDocument();
  });

  it('AC-STK-033 a posted document has no cancel action; a Draft shows Cancel draft to its author only', async () => {
    const { unmount } = renderPage();
    await screen.findByText('ISS-1');
    expect(screen.queryByRole('button', { name: 'Cancel draft' })).not.toBeInTheDocument();
    unmount();
    documents.get.mockResolvedValue(detail({ status: 'Draft', created_by: 'someone-else' }));
    const second = renderPage('Engineer');
    await screen.findByText('ISS-1');
    expect(screen.queryByRole('button', { name: 'Cancel draft' })).not.toBeInTheDocument();
    second.unmount();
    documents.get.mockResolvedValue(detail({ status: 'Draft', created_by: 'me' }));
    renderPage('Engineer');
    expect(await screen.findByRole('button', { name: 'Cancel draft' })).toBeInTheDocument();
  });

  it('cancelling a draft asks first, then calls cancel once', async () => {
    documents.get.mockResolvedValue(detail({ status: 'Draft', created_by: 'me' }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel draft' }));
    expect(documents.cancel).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel draft' }));
    await waitFor(() => expect(documents.cancel).toHaveBeenCalledWith('d1'));
  });

  it('FR-STK-062 the author of a draft count sees "Another person must post this", can reopen it, and has no Post', async () => {
    master.listKeepers.mockResolvedValue([{ warehouse_id: 'w1', user_id: 'me', org_id: 'org-1' }]);
    documents.get.mockResolvedValue(countDraft());
    renderPage('Project Manager');
    expect(await screen.findByText(/Another person must post this/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    expect(await screen.findByText('edit page')).toBeInTheDocument();
  });

  it('FR-STK-062 a Project Manager who did not author it sees Post and no Edit', async () => {
    documents.get.mockResolvedValue(countDraft({ created_by: 'someone-else' }));
    renderPage('Project Manager');
    await userEvent.click(await screen.findByRole('button', { name: 'Post' }));
    await waitFor(() => expect(documents.post).toHaveBeenCalledWith('d1', 4));   // the revision on screen
    expect(screen.queryByRole('button', { name: 'Edit draft' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Another person must post this/)).not.toBeInTheDocument();
  });

  it('FR-STK-025 a posted count shows the counted quantity, the system quantity it stamped and the difference', async () => {
    documents.get.mockResolvedValue(countDraft({ status: 'Posted', lines: [{ ...countDraft().lines[0], expected_quantity: '100' }] }));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Lines' });
    expect(within(table).getByText('System at posting')).toBeInTheDocument();
    expect(within(table).getByText('100')).toBeInTheDocument();
    expect(within(table).getByText('-8')).toBeInTheDocument();
  });

  const onHandRow = (over: Record<string, unknown> = {}) => ({ itemId: 'i2', itemCode: 'CAB', itemName: 'Cable 4mm', unitCode: 'm', wholeOnly: false, warehouseId: 'w1', warehouseCode: 'SITE-A', warehouseName: 'Site A', warehouseKind: 'site', qtyOnHand: '100', ...over });

  it('FR-STK-062 the approver of a Draft count sees the live system quantity and the difference they approve', async () => {
    documents.get.mockResolvedValue(countDraft({ created_by: 'someone-else' }));
    reports.onHand.mockResolvedValue([onHandRow({ valueOnHand: '6000.00', avgCost: '60.0000' })]);
    renderPage('Project Manager');
    const table = await screen.findByRole('table', { name: 'Lines' });
    expect(reports.onHand).toHaveBeenCalledWith({ warehouseId: 'w1', includeZero: true });
    expect(within(table).getByText('System now')).toBeInTheDocument();
    expect(await within(table).findByText('100')).toBeInTheDocument();
    expect(within(table).getByText('-8')).toBeInTheDocument();
    expect(within(table).getByText(/^−\D*480\.00$/)).toBeInTheDocument();     // 8 out at the moving average (rank >= 20)
  });

  it('FR-STK-063 below rank 20 the count approver view shows quantities, never a value', async () => {
    documents.get.mockResolvedValue(countDraft({ created_by: 'someone-else' }));
    reports.onHand.mockResolvedValue([onHandRow()]);                       // the server omitted the cost keys
    renderPage('Engineer');
    const table = await screen.findByRole('table', { name: 'Lines' });
    expect(await within(table).findByText('-8')).toBeInTheDocument();
    expect(within(table).queryByText('Value')).not.toBeInTheDocument();
  });

  const adjDraft = () => detail({
    number: 'ADJ-1', kind: 'adjustment', status: 'Draft', created_by: 'someone-else', reason: 'found in the yard', project_id: null, project: null, posted_by: null, posted_at: null,
    lines: [{ id: 'l1', line_no: 1, item_id: 'i2', quantity: '10', counted_quantity: null, expected_quantity: null, direction: 'in', boq_item_id: null, source_line_id: null, item: { code: 'CAB', name: 'Cable 4mm', unit: { code: 'm', whole_only: false } } }],
  });
  it('FR-STK-063 the approver (rank >= 20) sees an adjust-in line\'s unit cost and the value it adds', async () => {
    documents.get.mockResolvedValue(adjDraft());
    documents.costs.mockResolvedValue([{ lineId: 'l1', hasCost: true, unitCost: '1000000.0000' }]);
    renderPage('Project Manager');
    const table = await screen.findByRole('table', { name: 'Lines' });
    expect(await within(table).findByText(/^\D*1,000,000\.00$/)).toBeInTheDocument();
    expect(within(table).getByText(/^\D*10,000,000\.00$/)).toBeInTheDocument();
  });

  it('FR-STK-062 a draft changed since it was opened is refused, and the page reloads the new version', async () => {
    documents.get.mockResolvedValue(countDraft({ created_by: 'someone-else' }));
    documents.post.mockRejectedValueOnce(new AppError('STK_STALE: this draft changed since you opened it; review it again', 'P0001'));
    renderPage('Project Manager');
    await userEvent.click(await screen.findByRole('button', { name: 'Post' }));
    expect((await screen.findAllByText(/changed since you opened it/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(documents.get.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('OQ-STK-7 a posted issue that takes its work item over the allowance says so on the confirmation, as a flag, not a block', async () => {
    const row = { boqItemId: 'b1', boqItemCode: 'W-1', boqDescription: 'Slab', itemId: 'i1', itemCode: 'CEM', itemName: 'Cement 50kg', unitCode: 'bag', id: 'a1', plannedQuantity: '60', netToDate: '64', variance: '4' };
    consumption.report.mockResolvedValue({ from: '2026-10-30', to: '2026-10-30', months: [], unplanned: [], allowances: [{ ...row, overAllowance: true }] });
    renderPage();
    expect(await screen.findByText(/Over allowance: W-1 has now used 64 of 60 bag planned/)).toBeInTheDocument();
    expect(consumption.report).toHaveBeenCalledWith('p1', '2026-10-30', '2026-10-30');
  });

  it('OQ-STK-7 no notice when the work item is within its allowance, or the document is not a posted issue', async () => {
    const row = { boqItemId: 'b1', boqItemCode: 'W-1', boqDescription: 'Slab', itemId: 'i1', itemCode: 'CEM', itemName: 'Cement 50kg', unitCode: 'bag', id: 'a1', plannedQuantity: '60', netToDate: '30', variance: '-30' };
    consumption.report.mockResolvedValue({ from: 'a', to: 'b', months: [], unplanned: [], allowances: [{ ...row, overAllowance: false }] });
    const a = renderPage();
    await screen.findAllByText('ISS-1');
    await waitFor(() => expect(consumption.report).toHaveBeenCalled());
    expect(screen.queryByText(/Over allowance/)).not.toBeInTheDocument();
    a.unmount();
    consumption.report.mockClear();
    documents.get.mockResolvedValue(detail({ status: 'Draft', posted_by: null, posted_at: null }));
    renderPage();
    await screen.findAllByText('ISS-1');
    expect(consumption.report).not.toHaveBeenCalled();
  });
});
