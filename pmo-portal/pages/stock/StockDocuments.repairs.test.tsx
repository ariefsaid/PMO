import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

const { documents, listKeepers, may, role } = vi.hoisted(() => ({
  documents: { list: vi.fn(), count: vi.fn() },
  listKeepers: vi.fn(),
  may: vi.fn(),
  role: { realRole: 'Engineer', effectiveRole: 'Engineer' },
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: { stock: { documents, master: { listKeepers } } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => role }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => may }));

import StockDocuments from './StockDocuments';

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1', number: 'DOC-1', kind: 'issue', status: 'Posted', warehouse_id: 'w1', to_warehouse_id: null,
  project_id: 'p1', occurred_on: '2026-10-30', created_by: 'u1', created_at: '2026-10-30T03:00:00Z',
  warehouse: { code: 'SITE-A', name: 'Site A' }, to_warehouse: null,
  project: { name: 'Tower A' }, author: { full_name: 'Eka Engineer' }, ...over,
});

const DocumentPage: React.FC = () => {
  const { documentId } = useParams<{ documentId: string }>();
  return <p>{`record ${documentId ?? 'none'}`}</p>;
};

const NewDocumentPage: React.FC = () => {
  const { kind } = useParams<{ kind: string }>();
  return <p>{`new ${kind ?? 'none'}`}</p>;
};

const renderPage = (initialEntry = '/stock/documents') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/stock/documents" element={<StockDocuments />} />
            <Route path="/stock/documents/:documentId" element={<DocumentPage />} />
            <Route path="/stock/new/:kind" element={<NewDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  role.realRole = 'Engineer';
  role.effectiveRole = 'Engineer';
  may.mockReturnValue(true);
  documents.list.mockResolvedValue([doc()]);
  documents.count.mockResolvedValue(1);
  listKeepers.mockResolvedValue([{ user_id: 'me' }]);
});

describe('StockDocuments repair controls', () => {
  it('the document number can be reached with Tab and opens its record with Enter', async () => {
    const user = userEvent.setup();
    renderPage();
    const number = await screen.findByRole('link', { name: 'DOC-1' });

    let reachedNumber = false;
    for (let i = 0; i < 20; i += 1) {
      await user.tab();
      if (document.activeElement === number) {
        reachedNumber = true;
        break;
      }
    }
    expect(reachedNumber).toBe(true);
    expect(number).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(await screen.findByText('record d1')).toBeInTheDocument();
  });
});
