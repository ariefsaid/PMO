import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

/**
 * R2 (ux/1110): the stock document kind/status filters live in the URL, so a filtered list
 * survives opening a document and pressing Back, or a refresh.
 */

const { documents } = vi.hoisted(() => ({ documents: { list: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { documents } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

import StockDocuments from './StockDocuments';

const doc = (n: number) => ({
  id: `d${n}`, number: `ISS-${n}`, kind: 'issue', status: 'Posted', warehouse_id: 'w1', to_warehouse_id: null, project_id: 'p1', occurred_on: '2026-10-30', created_by: 'u1', created_at: `2026-10-30T0${n}:00:00Z`,
  warehouse: { code: 'SITE-A', name: 'Site A' }, to_warehouse: null, project: { name: 'Tower A' }, author: { full_name: 'Eka Engineer' },
});

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
};

const renderPage = (initialEntry = '/stock/documents') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LocationProbe />
          <StockDocuments />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  documents.list.mockResolvedValue([doc(1)]);
});

describe('R2 — stock document filters live in the URL', () => {
  it('a refresh of ?kind=receive reopens the receives-only list and asks the server for it', async () => {
    renderPage('/stock/documents?kind=receive');
    expect(screen.getByLabelText('Kind')).toHaveValue('receive');
    await vi.waitFor(() => expect(documents.list.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'receive' }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?kind=receive');
  });

  it('choosing a status writes it into the URL and the server filters', async () => {
    const user = userEvent.setup();
    renderPage('/stock/documents');
    await screen.findByText('ISS-1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Draft');
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?status=Draft');
    expect(documents.list.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'Draft' });
  });
});
