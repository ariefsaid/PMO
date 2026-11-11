import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import stockEn from '@/public/locales/en/stock.json';

const { documents } = vi.hoisted(() => ({ documents: { list: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { documents } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

import StockDocuments from './StockDocuments';

const doc = (n: number, over: Record<string, unknown> = {}) => ({
  id: `d${n}`, number: `ISS-${n}`, kind: 'issue', status: 'Posted', warehouse_id: 'w1', to_warehouse_id: null, project_id: 'p1', occurred_on: '2026-10-30', created_by: 'u1', created_at: `2026-10-30T0${n}:00:00Z`,
  warehouse: { code: 'SITE-A', name: 'Site A' }, to_warehouse: null, project: { name: 'Tower A' }, author: { full_name: 'Eka Engineer' }, ...over,
});

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter><StockDocuments /></MemoryRouter></ToastProvider></QueryClientProvider>);
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => { vi.clearAllMocks(); documents.list.mockResolvedValue([doc(1)]); });

describe('StockDocuments (AC-STK-032)', () => {
  it('AC-STK-032 loading, then a populated document with number, status, warehouse, project and author', async () => {
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(await screen.findByText('ISS-1')).toBeInTheDocument();
    expect(screen.getAllByText('Posted').length).toBeGreaterThan(0);
    expect(screen.getByText('Tower A')).toBeInTheDocument();
    expect(screen.getByText('Eka Engineer')).toBeInTheDocument();
  });

  it('AC-STK-032 empty and error-with-retry', async () => {
    documents.list.mockResolvedValueOnce([]);
    const { unmount } = renderPage();
    expect(await screen.findByText('No stock documents yet')).toBeInTheDocument();
    unmount();
    documents.list.mockRejectedValueOnce(new AppError('boom'));
    renderPage();
    expect(await screen.findByText("Couldn't load stock")).toBeInTheDocument();
    documents.list.mockResolvedValue([doc(1)]);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('ISS-1')).toBeInTheDocument();
  });

  it('a full page offers Load more and requests the next page by (created_at, id)', async () => {
    const page = Array.from({ length: 50 }, (_, i) => doc(i + 1, { id: `d${i + 1}`, number: `ISS-${i + 1}`, created_at: `2026-10-01T00:00:${String(i).padStart(2, '0')}Z` }));
    documents.list.mockResolvedValueOnce(page);
    documents.list.mockResolvedValueOnce([doc(51, { number: 'ISS-51' })]);
    renderPage();
    await screen.findByText('ISS-1');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('ISS-51')).toBeInTheDocument();
    expect(documents.list.mock.calls[1][0].before).toEqual({ createdAt: page[49].created_at, id: 'd50' });
  });

  it('the kind filter reaches the list call', async () => {
    renderPage();
    await screen.findByText('ISS-1');
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'receive');
    await vi.waitFor(() => expect(documents.list.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'receive' }));
  });
});
