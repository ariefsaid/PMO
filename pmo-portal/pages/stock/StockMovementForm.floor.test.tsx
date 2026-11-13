import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

const { master, documents, project } = vi.hoisted(() => ({
  master: { listUnits: vi.fn(), listItems: vi.fn(), listWarehouses: vi.fn(), listKeepers: vi.fn() },
  documents: { create: vi.fn(), issuableWorkItems: vi.fn(), issueLines: vi.fn() },
  project: { list: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, documents }, project } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
let realRole: Role = 'Engineer';
let effectiveRole: Role = 'Engineer';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-11-01' }) }));

import StockMovementForm from './StockMovementForm';

const unit = { id: 'u1', code: 'bag', name: 'Bag', whole_only: true, archived_at: null };
const metre = { id: 'u2', code: 'm', name: 'Metre', whole_only: false, archived_at: null };
const item = { id: 'i1', code: 'CEM', name: 'Cement 50kg', unit_id: 'u1', archived_at: null };
const wh = (id: string, code: string) => ({ id, code, name: `${code} store`, kind: 'site', project_id: null, archived_at: null });

const renderForm = (kind = 'issue', role: Role = 'Engineer', entry = `/stock/new/${kind}`) => {
  realRole = role;
  effectiveRole = role;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/stock/new/:kind" element={<StockMovementForm />} />
            <Route path="/stock/documents/:documentId" element={<p>document page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listUnits.mockResolvedValue([unit, metre]);
  master.listItems.mockResolvedValue([item, { ...item, id: 'i2', code: 'CAB', name: 'Cable 4mm', unit_id: 'u2' }]);
  master.listWarehouses.mockResolvedValue([wh('w1', 'SITE-A'), wh('w2', 'SITE-B')]);
  master.listKeepers.mockResolvedValue([{ warehouse_id: 'w1', user_id: 'me', org_id: 'org-1' }]);
  project.list.mockResolvedValue([{ id: 'p1', name: 'Tower A' }, { id: 'p2', name: 'Tower B' }]);
  documents.issuableWorkItems.mockImplementation(async (projectId: string) => projectId === 'p2'
    ? [
      { id: 'b1', line_no: 1, item_code: 'W-1', description: 'Slab pour', unit: 'm3' },
      { id: 'b2', line_no: 2, item_code: 'W-2', description: 'Beam pour', unit: 'm3' },
    ]
    : [{ id: 'b1', line_no: 1, item_code: 'W-1', description: 'Slab pour', unit: 'm3' }]);
  documents.issueLines.mockResolvedValue([]);
  documents.create.mockResolvedValue('doc-1');
});

async function fillIssue(qty = '5') {
  await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
  await userEvent.selectOptions(screen.getByLabelText(/^Project/), 'p1');
  await userEvent.selectOptions(await screen.findByLabelText(/^Work item/), 'b1');
  await userEvent.click(screen.getByRole('combobox', { name: /^Item/ }));
  await userEvent.type(await screen.findByRole('combobox', { name: /^(search|cari) /i }), 'cem');
  await userEvent.click(await screen.findByRole('option', { name: /CEM - Cement 50kg/ }));
  await userEvent.type(screen.getByLabelText(/^Quantity/), qty);
}

describe('StockMovementForm floor', () => {
  it('floor: project query preselects the project and offers its work items', async () => {
    renderForm('issue', 'Engineer', '/stock/new/issue?project=p1');

    expect(await screen.findByLabelText(/^Project/)).toHaveValue('p1');
    expect(await screen.findByRole('option', { name: 'W-1 - Slab pour' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'W-2 - Beam pour' })).not.toBeInTheDocument();
  });

  it('floor: changing project clears each line work item', async () => {
    renderForm('issue');
    await userEvent.selectOptions(await screen.findByLabelText(/^Project/), 'p1');
    await userEvent.selectOptions((await screen.findAllByLabelText(/^Work item/))[0], 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Add another line' }));
    await userEvent.selectOptions(await screen.findByLabelText(/^Work item 2/), 'b1');

    await userEvent.selectOptions(screen.getByLabelText(/^Project/), 'p2');

    expect(screen.getAllByLabelText(/^Work item/).map((field) => field.value)).toEqual(['', '']);
  });

  it('floor: choosing a return source fills its item and warehouse and posts its reference', async () => {
    documents.issueLines.mockResolvedValue([{
      id: 'source-line-1', item_id: 'i1', quantity: '7', boq_item_id: null,
      item: { code: 'CEM', name: 'Cement 50kg', unit: { code: 'bag' } }, boq: null,
      document: { id: 'source-doc', number: 'ISS-001', occurred_on: '2026-10-30', warehouse_id: 'w2' },
    }]);
    renderForm('return', 'Admin');
    await userEvent.selectOptions(await screen.findByLabelText(/^Project/), 'p1');
    await userEvent.selectOptions(await screen.findByLabelText(/^Issue to return/), 'source-line-1');

    expect(screen.getByLabelText(/^Warehouse/)).toHaveValue('w2');
    await userEvent.type(screen.getByLabelText(/^Quantity/), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Post return' }));

    await waitFor(() => expect(documents.create).toHaveBeenCalled());
    expect(documents.create.mock.calls[0][0].lines).toEqual([
      { itemId: 'i1', quantity: '2', sourceLineId: 'source-line-1' },
    ]);
    expect(documents.create.mock.calls[0][0].warehouseId).toBe('w2');
  });

  it('floor: Add another line creates a second quantity field', async () => {
    renderForm('issue');
    await screen.findByLabelText(/^Quantity/);

    await userEvent.click(screen.getByRole('button', { name: 'Add another line' }));

    expect(screen.getByLabelText(/^Quantity 2/)).toBeInTheDocument();
  });

  it('floor: Remove line removes only the selected extra line', async () => {
    renderForm('issue');
    await screen.findByLabelText(/^Quantity/);
    await userEvent.click(screen.getByRole('button', { name: 'Add another line' }));
    expect(screen.getByLabelText(/^Quantity 2/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Remove line' })[1]);

    expect(screen.getAllByLabelText(/^Quantity/)).toHaveLength(1);
    expect(screen.queryByLabelText(/^Quantity 2/)).not.toBeInTheDocument();
  });

  it('floor: typed note reaches the posted movement', async () => {
    renderForm('issue');
    await fillIssue();
    await userEvent.type(screen.getByLabelText(/^Note/), 'Urgent pour');

    await userEvent.click(screen.getByRole('button', { name: 'Post issue' }));

    await waitFor(() => expect(documents.create).toHaveBeenCalled());
    expect(documents.create.mock.calls[0][0]).toMatchObject({ note: 'Urgent pour' });
  });
});
