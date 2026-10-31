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

const { documents, reports, master } = vi.hoisted(() => ({
  documents: { get: vi.fn(), cancel: vi.fn(), post: vi.fn() },
  reports: { ledgerAll: vi.fn() },
  master: { listKeepers: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { documents, reports, master } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
let role: Role = 'Engineer';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: role, effectiveRole: role }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import StockDocumentDetail from './StockDocumentDetail';

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'd1', number: 'ISS-1', kind: 'issue', status: 'Posted', warehouse_id: 'w1', to_warehouse_id: null, project_id: 'p1', procurement_id: null, reason: null, note: 'for slab', occurred_on: '2026-10-30',
  created_by: 'me', created_at: '2026-10-30T03:00:00Z', posted_by: 'me', posted_at: '2026-10-30T03:00:00Z', cancelled_at: null,
  warehouse: { code: 'SITE-A', name: 'Site A' }, to_warehouse: null, project: { name: 'Tower A' }, author: { full_name: 'Eka Engineer' },
  lines: [{ id: 'l1', line_no: 1, item_id: 'i1', quantity: '30', counted_quantity: null, expected_quantity: null, direction: null, boq_item_id: 'b1', source_line_id: null, item: { code: 'CEM', name: 'Cement 50kg', unit: { code: 'bag', whole_only: true } } }],
  ...over,
});
const entry = { seq: 5, id: 'e5', documentId: 'd1', documentNumber: 'ISS-1', documentStatus: 'Posted', kind: 'issue', postedAt: 't', occurredOn: '2026-10-30', postedBy: 'me', actorName: 'Eka', itemId: 'i1', itemCode: 'CEM', itemName: 'Cement', unitCode: 'bag', warehouseId: 'w1', warehouseCode: 'SITE-A', projectId: 'p1', projectName: 'Tower A', boqItemId: null, boqItemCode: null, qtyDelta: '-30', qtyAfter: '70' };

const renderPage = (r: Role = 'Engineer') => {
  role = r;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={['/stock/documents/d1']}>
      <Routes><Route path="/stock/documents/:documentId" element={<StockDocumentDetail />} /><Route path="/stock/documents" element={<p>list page</p>} /></Routes>
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
  master.listKeepers.mockResolvedValue([]);
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
});
