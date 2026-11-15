import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

const { documents, reports, master, consumption } = vi.hoisted(() => ({
  documents: { get: vi.fn(), cancel: vi.fn(), post: vi.fn(), costs: vi.fn(), erpState: vi.fn(), releaseHold: vi.fn() },
  reports: { ledgerAll: vi.fn(), onHand: vi.fn() },
  master: { listKeepers: vi.fn() },
  consumption: { report: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { documents, reports, master, consumption } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
let role: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: role, effectiveRole: role }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import StockDocumentDetail from './StockDocumentDetail';

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1', number: 'TRF-1', kind: 'transfer', status: 'Draft', revision: 2, warehouse_id: 'w1', to_warehouse_id: 'w2', project_id: null, procurement_id: null, reason: null, note: null, occurred_on: '2026-11-10',
  created_by: 'me', created_at: '2026-11-10T03:00:00Z', posted_by: null, posted_at: null, cancelled_at: null,
  warehouse: { code: 'A', name: 'A' }, to_warehouse: { code: 'B', name: 'B' }, project: null, author: { full_name: 'Eka' },
  lines: [{ id: 'l1', line_no: 1, item_id: 'i1', quantity: '5', counted_quantity: null, expected_quantity: null, direction: null, boq_item_id: null, source_line_id: null, item: { code: 'CEM', name: 'Cement', unit: { code: 'bag', whole_only: true } } }],
  ...over,
});
const renderPage = (r: Role = 'Admin') => {
  role = r;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={['/stock/documents/d1']}>
      <Routes><Route path="/stock/documents/:documentId" element={<StockDocumentDetail />} /></Routes>
    </MemoryRouter></ToastProvider></QueryClientProvider>,
  );
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  clearOwnershipCache();
  setTaskOwnership([{ domain: 'inventory', externalTier: 'odoo' }]);
  documents.get.mockResolvedValue(doc());
  documents.costs.mockResolvedValue([]);
  documents.releaseHold.mockResolvedValue(undefined);
  reports.ledgerAll.mockResolvedValue([]);
  reports.onHand.mockResolvedValue([]);
  master.listKeepers.mockResolvedValue([{ warehouse_id: 'w1', user_id: 'me', org_id: 'org-1' }]);
  consumption.report.mockResolvedValue({ from: 'a', to: 'b', months: [], allowances: [], unplanned: [] });
});

describe('StockDocumentDetail connected posting (AC-OSP-007)', () => {
  it('AC-OSP-007 a held document names the reason in plain words and an Admin can release it', async () => {
    documents.erpState.mockResolvedValue({ command: { id: 'c1', state: 'held' }, mirror: { state: 'held', exception: 'Odoo needs a lot number', externalId: null, completedQuantity: null, completedValue: null, currency: null } });
    renderPage('Admin');
    expect(await screen.findByText('Held in Odoo check: Odoo needs a lot number')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Release hold' }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Release hold' })).at(-1)!);
    await waitFor(() => expect(documents.releaseHold).toHaveBeenCalledWith('c1'));
  });

  it('AC-OSP-007 a non-Admin sees the hold but no release', async () => {
    documents.erpState.mockResolvedValue({ command: { id: 'c1', state: 'held' }, mirror: { state: 'held', exception: 'x', externalId: null, completedQuantity: null, completedValue: null, currency: null } });
    renderPage('Project Manager');
    expect(await screen.findByText(/Held in Odoo check/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release hold' })).not.toBeInTheDocument();
  });

  it('AC-OSP-007 a pending post says it is being posted and offers no edit or post', async () => {
    documents.erpState.mockResolvedValue({ command: { id: 'c1', state: 'pending' }, mirror: null });
    renderPage('Admin');
    expect(await screen.findByText(/being posted in Odoo/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
  });

  it('AC-OSP-007 a Draft with no command stays postable', async () => {
    documents.erpState.mockResolvedValue({ command: null, mirror: null });
    renderPage('Admin');
    expect(await screen.findByRole('button', { name: 'Post' })).toBeInTheDocument();
  });

  it('AC-OSP-007 a Posted document shows what Odoo reported', async () => {
    documents.get.mockResolvedValue(doc({ status: 'Posted', posted_by: 'me', posted_at: '2026-11-10T04:00:00Z' }));
    documents.erpState.mockResolvedValue({ command: { id: 'c1', state: 'confirmed' }, mirror: { state: 'confirmed', exception: null, externalId: 'stock.picking:9', completedQuantity: '5', completedValue: '0', currency: 'IDR' } });
    renderPage('Admin');
    expect(await screen.findByText(/Posted from Odoo transfer stock\.picking:9/)).toBeInTheDocument();
    expect(screen.getByText(/No value change/)).toBeInTheDocument();
  });
});
