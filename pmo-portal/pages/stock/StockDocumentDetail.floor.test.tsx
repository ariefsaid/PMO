import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import stockEn from '@/public/locales/en/stock.json';

/** Floor list (all-screens/floor-tests/stock-document-record.md): exercise its missing record controls. */

const { documents, reports, master } = vi.hoisted(() => ({
  documents: { get: vi.fn(), cancel: vi.fn(), post: vi.fn(), costs: vi.fn() },
  reports: { ledgerAll: vi.fn(), onHand: vi.fn() },
  master: { listKeepers: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { documents, reports, master, consumption: { report: vi.fn() } } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
let role: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: role, effectiveRole: role }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import StockDocumentDetail from './StockDocumentDetail';

const LedgerPage: React.FC = () => {
  const location = useLocation();
  return <p>{`ledger for ${new URLSearchParams(location.search).get('document') ?? 'none'}`}</p>;
};

const EditPage: React.FC = () => {
  const { documentId } = useParams<{ documentId: string }>();
  return <p>{`edit ${documentId ?? 'none'}`}</p>;
};

const ProjectPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  return <p>{`project ${projectId ?? 'none'}`}</p>;
};

const countDraft = () => ({
  id: 'd1', number: 'CNT-1', kind: 'count', status: 'Draft', revision: 2, warehouse_id: 'w1', to_warehouse_id: null, project_id: null,
  procurement_id: null, reason: null, note: null, occurred_on: '2026-10-30',
  created_by: 'me', created_at: '2026-10-30T03:00:00Z', posted_by: null, posted_at: null, cancelled_at: null,
  warehouse: { code: 'SITE-A', name: 'Site A' }, to_warehouse: null, project: null, author: { full_name: 'Eka Engineer' },
  lines: [{ id: 'l1', line_no: 1, item_id: 'i2', quantity: null, counted_quantity: '92', expected_quantity: null, direction: null, boq_item_id: null, source_line_id: null, item: { code: 'CAB', name: 'Cable 4mm', unit: { code: 'm', whole_only: false } } }],
});

const renderPage = (activeRole: Role = 'Project Manager') => {
  role = activeRole;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/stock/documents/d1']}>
          <Routes>
            <Route path="/stock/documents/:documentId" element={<StockDocumentDetail />} />
            <Route path="/stock/documents/:documentId/edit" element={<EditPage />} />
            <Route path="/stock/documents" element={<p>list page</p>} />
            <Route path="/stock/ledger" element={<LedgerPage />} />
            <Route path="/projects/:projectId" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  documents.get.mockResolvedValue(countDraft());
  documents.costs.mockResolvedValue([]);
  documents.cancel.mockResolvedValue(undefined);
  documents.post.mockResolvedValue(undefined);
  reports.ledgerAll.mockResolvedValue([]);
  reports.onHand.mockResolvedValue([]);
  // The author of the write-off draft is its keeper, so their Edit draft action is available.
  master.listKeepers.mockResolvedValue([{ warehouse_id: 'w1', user_id: 'me', org_id: 'org-1' }]);
});

describe('stock document record floor controls', () => {
  it('floor: Ledger section navigation opens the stock ledger', async () => {
    renderPage();
    await screen.findByText('CNT-1');
    await userEvent.click(screen.getByRole('link', { name: 'Ledger' }));
    expect(await screen.findByText('ledger for none')).toBeInTheDocument();
  });

  it('floor: primary Edit draft reopens the write-off draft for its author', async () => {
    renderPage('Admin');
    await screen.findByText('CNT-1');
    await userEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    expect(await screen.findByText('edit d1')).toBeInTheDocument();
  });

  it('floor: project link opens the linked project record', async () => {
    documents.get.mockResolvedValue({ ...countDraft(), project_id: 'p1', project: { name: 'Tower A' } });
    renderPage();
    await screen.findByText('CNT-1');
    await userEvent.click(screen.getByRole('link', { name: 'Tower A' }));
    expect(await screen.findByText('project p1')).toBeInTheDocument();
  });

  it('floor: stock entries Retry recovers entries and keeps the document record', async () => {
    reports.ledgerAll.mockRejectedValueOnce(new AppError('boom'));
    renderPage();
    expect(await screen.findByText("Couldn't load stock")).toBeInTheDocument();
    reports.ledgerAll.mockResolvedValue([{
      seq: 1, id: 'e1', documentId: 'd1', documentNumber: 'CNT-1', documentStatus: 'Posted', kind: 'count', postedAt: 't', occurredOn: '2026-10-30', postedBy: 'me', actorName: 'Eka', itemId: 'i2', itemCode: 'CAB', itemName: 'Cable 4mm', unitCode: 'm', warehouseId: 'w1', warehouseCode: 'SITE-A', projectId: null, projectName: null, boqItemId: null, boqItemCode: null, qtyDelta: '2', qtyAfter: '92',
    }]);
    const section = screen.getByRole('heading', { name: 'Stock entries' }).closest('section') as HTMLElement;
    await userEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    expect(await within(section).findByText('SITE-A')).toBeInTheDocument();
    expect(screen.getByText('CNT-1')).toBeInTheDocument();
    expect(reports.ledgerAll).toHaveBeenCalledTimes(2);
    expect(documents.get).toHaveBeenCalledTimes(1);
  });

  it('floor: Open in the ledger filters entries to this document', async () => {
    documents.get.mockResolvedValue({
      ...countDraft(), status: 'Posted', posted_by: 'me', posted_at: '2026-10-30T04:00:00Z',
    });
    renderPage();
    await screen.findByText('CNT-1');
    await userEvent.click(await screen.findByRole('link', { name: 'Open in the ledger' }));
    expect(await screen.findByText('ledger for d1')).toBeInTheDocument();
  });

  it('floor: page Retry recovers the document after a failed read', async () => {
    documents.get.mockRejectedValueOnce(new AppError('boom'));
    renderPage();
    expect(await screen.findByText("Couldn't load stock")).toBeInTheDocument();
    documents.get.mockResolvedValue(countDraft());
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('CNT-1')).toBeInTheDocument();
  });

  it('floor: not-found Back to documents returns to the documents list', async () => {
    documents.get.mockResolvedValue(null);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Back to documents' }));
    expect(await screen.findByText('list page')).toBeInTheDocument();
  });
});
