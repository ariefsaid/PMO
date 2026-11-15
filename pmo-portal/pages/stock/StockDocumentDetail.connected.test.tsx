import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    documents.erpState.mockResolvedValue({ command: { id: 'c1', state: 'held' }, mirror: { state: 'held', exception: 'Odoo did not finish transfer WH/INT/00012: it asked to confirm a partial quantity. Check it in Odoo.', externalId: '4', externalReference: 'WH/INT/00012', completedQuantity: null, completedValue: null, currency: null } });
    renderPage('Admin');
    expect(await screen.findByText('Odoo did not finish transfer WH/INT/00012: it asked to confirm a partial quantity. Check it in Odoo.')).toBeInTheDocument();
    expect(screen.getByText('After checking the transfer in Odoo, release the hold so it can be posted again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Release hold' }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Release hold' })).at(-1)!);
    await waitFor(() => expect(documents.releaseHold).toHaveBeenCalledWith('c1'));
  });

  it('AC-OSP-007 a non-Admin sees the hold but no release', async () => {
    documents.erpState.mockResolvedValue({ command: { id: 'c1', state: 'held' }, mirror: { state: 'held', exception: 'x', externalId: null, externalReference: null, completedQuantity: null, completedValue: null, currency: null } });
    renderPage('Project Manager');
    expect(await screen.findByText('Ask an Admin to check it in Odoo.')).toBeInTheDocument();
    expect(screen.queryByText(/release the hold/)).not.toBeInTheDocument();
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

  const posted = (over: Record<string, unknown> = {}) => documents.get.mockResolvedValue(doc({ status: 'Posted', posted_by: 'me', posted_at: '2026-11-10T04:00:00Z', ...over }));
  const confirmed = (over: Record<string, unknown> = {}) => documents.erpState.mockResolvedValue({
    command: { id: 'c1', state: 'confirmed' },
    mirror: { state: 'confirmed', exception: null, externalId: '9', externalReference: 'WH/INT/00012', completedQuantity: '5', completedValue: '0', currency: 'IDR', ...over },
  });

  it('AC-OSP-007 a Posted document shows what Odoo reported, by the transfer reference', async () => {
    posted(); confirmed();
    renderPage('Admin');
    expect(await screen.findByText(/Posted to Odoo as transfer WH\/INT\/00012\. 5 bag moved\./)).toBeInTheDocument();
    expect(screen.queryByText(/stock\.picking|transfer 9\b/)).not.toBeInTheDocument();
    expect(screen.getByText(/No value change/)).toBeInTheDocument();
    expect(screen.getByText('Stock entries for this document are kept in Odoo.')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing has been posted/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open in the ledger' })).not.toBeInTheDocument();
  });

  it('AC-OSP-007 a Posted document whose transfer reference is unknown still reads plainly', async () => {
    posted(); confirmed({ externalReference: null });
    renderPage('Admin');
    expect(await screen.findByText(/Posted to Odoo\. 5 bag moved\./)).toBeInTheDocument();
  });

  it('AC-OSP-007 a Posted issue shows the value only when the database gave it, as an unrounded decimal', async () => {
    posted({ kind: 'issue', to_warehouse_id: null, to_warehouse: null, project_id: 'p1', project: { name: 'Tower' } }); confirmed({ completedValue: '-60.125' });
    renderPage('Finance');
    expect(await screen.findByText(/Value booked: /)).toHaveTextContent(/60[.,]125/);
  });

  it('AC-OSP-007 a role that does not see stock costs gets no value line', async () => {
    posted({ kind: 'issue', to_warehouse_id: null, to_warehouse: null, project_id: 'p1', project: { name: 'Tower' } }); confirmed({ completedValue: null });
    renderPage('Engineer');
    expect(await screen.findByText(/Posted to Odoo as transfer WH\/INT\/00012\. 5 bag moved\./)).toBeInTheDocument();
    expect(screen.queryByText(/Value booked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No value change/)).not.toBeInTheDocument();
  });

  it('AC-OSP-007 lines in different units are counted, never summed into one quantity', async () => {
    const line = (n: number, unit: string) => ({ id: `l${n}`, line_no: n, item_id: `i${n}`, quantity: '1', counted_quantity: null, expected_quantity: null, direction: null, boq_item_id: null, source_line_id: null, item: { code: `I${n}`, name: `Item ${n}`, unit: { code: unit, whole_only: false } } });
    posted({ lines: [line(1, 'bag'), line(2, 'litre')] }); confirmed({ completedQuantity: '8' });
    renderPage('Admin');
    expect(await screen.findByText(/2 lines moved/)).toBeInTheDocument();
    expect(screen.queryByText(/8 (bag )?moved/)).not.toBeInTheDocument();
  });

  it('AC-OSP-007 a refused post names the setup step on the Draft', async () => {
    documents.erpState.mockResolvedValue({ command: { id: 'c1', state: 'failed' }, mirror: { state: 'failed', exception: 'analytic-costs-disabled', externalId: null, externalReference: null, completedQuantity: null, completedValue: null, currency: null } });
    renderPage('Admin');
    expect(await screen.findByText(/Not posted: Project costs are switched off for this Odoo operation type\. Ask an Admin to switch them on in Odoo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
  });

  it('AC-OSP-007 a refusal reason the page does not know is still worded plainly', async () => {
    documents.erpState.mockResolvedValue({ command: { id: 'c1', state: 'failed' }, mirror: { state: 'failed', exception: 'a-new-reason', externalId: null, externalReference: null, completedQuantity: null, completedValue: null, currency: null } });
    renderPage('Admin');
    expect(await screen.findByText(/Not posted: Odoo's setup refused this post\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check Integration setup' })).toHaveAttribute('href', '/administration/integrations');
  });

  const failed = (exception: string) => documents.erpState.mockResolvedValue({ command: { id: 'c1', state: 'failed' }, mirror: { state: 'failed', exception, externalId: null, externalReference: null, completedQuantity: null, completedValue: null, currency: null } });

  it('AC-OSP-007 a role that may not open Integration setup is told to ask an Admin, with no link', async () => {
    failed('item-unmapped');
    renderPage('Project Manager');
    expect(await screen.findByText(/Not posted: An item on this document is not matched to an Odoo product\. Ask an Admin to check Integration setup\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Check Integration setup' })).not.toBeInTheDocument();
  });

  it('AC-OSP-007 a refusal that names a warehouse of the document names it, the destination as well as the source', async () => {
    failed('foreign-company w2');
    const view = renderPage('Admin');
    expect(await screen.findByText(/Not posted: Warehouse B does not match the connected Odoo company\./)).toBeInTheDocument();
    view.unmount();
    failed('warehouse-unmapped w1');
    renderPage('Admin');
    expect(await screen.findByText(/Not posted: Warehouse A is not matched to an Odoo warehouse\./)).toBeInTheDocument();
  });

  it('AC-OSP-007 a refusal that names something that is not a warehouse of the document keeps the general sentence', async () => {
    failed('foreign-company some-other-id');
    renderPage('Admin');
    expect(await screen.findByText(/Not posted: This document does not match the connected Odoo company\./)).toBeInTheDocument();
  });

  it('AC-OSP-007 a reason that points to Odoo, not to Integration setup, keeps its own sentence and gets no setup link', async () => {
    failed('missing-module-stock');
    renderPage('Admin');
    expect(await screen.findByText(/Not posted: Odoo's Inventory app is not installed\. Ask an Admin to install it, then post again\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Check Integration setup' })).not.toBeInTheDocument();
  });

  it('AC-OSP-007 a document with an open hold reads On hold, and Draft again after the hold is released', async () => {
    documents.erpState.mockResolvedValue({ command: { id: 'c1', state: 'held' }, mirror: { state: 'held', exception: 'x', externalId: null, externalReference: null, completedQuantity: null, completedValue: null, currency: null } });
    const view = renderPage('Admin');
    expect(await screen.findByText('On hold')).toBeInTheDocument();
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    view.unmount();
    documents.erpState.mockResolvedValue({ command: null, mirror: null });
    renderPage('Admin');
    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(screen.queryByText('On hold')).not.toBeInTheDocument();
  });

  it('AC-OSP-007 a post Odoo may have received, or is holding, is information and not a failure', async () => {
    documents.erpState.mockResolvedValue({ command: null, mirror: null });
    for (const [code, title] of [['external-unreachable', 'Sent to Odoo'], ['command-held', 'Held in Odoo']] as const) {
      documents.post.mockRejectedValueOnce(new AppError('x', code));
      const view = renderPage('Admin');
      await userEvent.click(await screen.findByRole('button', { name: 'Post' }));
      await userEvent.click((await screen.findAllByRole('button', { name: 'Post' })).at(-1)!);
      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.queryByText("That didn't work")).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('AC-OSP-007 a refused post is a failed action with the reason', async () => {
    documents.erpState.mockResolvedValue({ command: null, mirror: null });
    documents.post.mockRejectedValueOnce(new AppError('Project costs are off', 'commit-rejected', 'analytic-costs-disabled'));
    renderPage('Admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Post' }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Post' })).at(-1)!);
    expect((await screen.findAllByText(/Project costs are switched off for this Odoo operation type/)).length).toBeGreaterThan(0);
  });

  it('AC-OSP-007 a refused post caused by setup tells the person to ask an Admin', async () => {
    documents.erpState.mockResolvedValue({ command: null, mirror: null });
    documents.post.mockRejectedValueOnce(new AppError('Item not matched', 'commit-rejected', 'item-unmapped'));
    renderPage('Admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Post' }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Post' })).at(-1)!);
    expect((await screen.findAllByText(/not matched to an Odoo product\. Ask an Admin to check Integration setup\./)).length).toBeGreaterThan(0);
  });
});
