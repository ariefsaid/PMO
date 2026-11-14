import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

/** Floor list (all-screens/floor-tests/stock-documents.md): drive the number link and row activation. */

const { documents } = vi.hoisted(() => ({ documents: { list: vi.fn(), count: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { documents } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }) }));

import StockDocuments from './StockDocuments';

const listed = (id: string, number: string) => ({
  id, number, kind: 'issue', status: 'Posted', occurred_on: '2026-10-30', created_at: '2026-10-30T03:00:00Z',
  revision: 1, warehouse_id: 'w1', to_warehouse_id: null, project_id: 'p1',
  warehouse: { code: 'SITE-A', name: 'Site A' }, to_warehouse: null, project: { name: 'Tower A' }, author: { full_name: 'Eka Engineer' },
});

/** The record, reduced to the id the route opened for. */
const DocumentPage: React.FC = () => {
  const { documentId } = useParams<{ documentId: string }>();
  return <p>{`record ${documentId ?? 'none'}`}</p>;
};

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/stock/documents']}>
          <Routes>
            <Route path="/stock/documents" element={<StockDocuments />} />
            <Route path="/stock/documents/:documentId" element={<DocumentPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  documents.list.mockResolvedValue([listed('d1', 'ISS-1'), listed('d2', 'TRF-2')]);
  documents.count.mockResolvedValue(2);
});

describe('stock documents floor controls', () => {
  it('floor: the document number opens that document record', async () => {
    renderPage();
    await screen.findByText('ISS-1');
    await userEvent.click(screen.getByRole('link', { name: 'TRF-2' }));
    expect(await screen.findByText('record d2')).toBeInTheDocument();
  });

  it('floor: row activation by pointer opens the selected document record', async () => {
    renderPage();
    await screen.findByText('ISS-1');
    const row = screen.getAllByRole('row').find((candidate) => candidate.textContent?.includes('ISS-1'));
    expect(row).toBeDefined();
    await userEvent.click(within(row as HTMLElement).getByText('Tower A'));
    expect(await screen.findByText('record d1')).toBeInTheDocument();
  });

});
