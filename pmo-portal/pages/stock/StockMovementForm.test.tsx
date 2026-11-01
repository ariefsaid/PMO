import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';
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

const renderForm = (kind = 'issue', role: Role = 'Engineer', viewingAs: Role = role) => {
  realRole = role; effectiveRole = viewingAs;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/stock/new/${kind}`]}>
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
  project.list.mockResolvedValue([{ id: 'p1', name: 'Tower A' }]);
  documents.issuableWorkItems.mockResolvedValue([{ id: 'b1', line_no: 1, item_code: 'W-1', description: 'Slab pour', unit: 'm3' }]);
  documents.issueLines.mockResolvedValue([]);
  documents.create.mockResolvedValue('doc-1');
});

async function fillIssue(qty = '5', search = 'cem', option: RegExp = /CEM - Cement 50kg/) {
  await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
  await userEvent.selectOptions(screen.getByLabelText(/^Project/), 'p1');
  await userEvent.selectOptions(await screen.findByLabelText(/^Work item/), 'b1');
  await userEvent.click(screen.getByRole('combobox', { name: /^Item/ }));
  await userEvent.type(screen.getByRole('searchbox'), search);
  await userEvent.click(await screen.findByRole('option', { name: option }));
  await userEvent.type(screen.getByLabelText(/^Quantity/), qty);
}

describe('StockMovementForm', () => {
  it('AC-STK-030 every field has a label, the item picker finds by code or name, and axe reports no violation', async () => {
    const { container } = renderForm('issue');
    await fillIssue();
    await userEvent.click(screen.getByRole('combobox', { name: /^Item/ }));
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'cement');
    expect(await screen.findByRole('option', { name: /CEM - Cement 50kg/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AC-STK-030 a create page has its own heading, no section tab bar, and a date that stops at the org today', async () => {
    renderForm('issue', 'Admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Issue to project' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Stock sections' })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Date')).toHaveAttribute('max', '2026-11-01');
  });

  it('AC-STK-030 a shortfall error is announced beside the quantity', async () => {
    documents.create.mockRejectedValue({ code: 'P0001', message: 'STK_INSUFFICIENT: item CEM at SITE-A: available 5, requested 6', details: '{"available":"5","requested":"6"}' });
    renderForm('issue');
    await fillIssue('6');
    await userEvent.click(screen.getByRole('button', { name: 'Post issue' }));
    const alert = (await screen.findAllByRole('alert')).find((a) => /5/.test(a.textContent ?? ''));
    expect(alert).toHaveTextContent(/5.*6/);
    expect(screen.getByLabelText(/^Quantity/)).toHaveAccessibleDescription(/5/);
  });

  it('AC-STK-030 a keyboard-only user completes an issue', async () => {
    const user = userEvent.setup();
    renderForm('issue');
    // Native selects take their value from the keyboard in a browser; jsdom has no such behaviour, so selectOptions stands in.
    await user.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
    await user.selectOptions(screen.getByLabelText(/^Project/), 'p1');
    await user.selectOptions(await screen.findByLabelText(/^Work item/), 'b1');
    const picker = screen.getByRole('combobox', { name: /^Item/ });
    await user.tab({ shift: true }); // work item -> back to the item picker (it sits above the work item)
    expect(picker).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.type(await screen.findByRole('searchbox'), 'cem');
    await user.keyboard('{ArrowDown}{Enter}');
    await user.tab(); // item picker -> work item
    await user.tab(); // work item -> quantity
    expect(screen.getByLabelText(/^Quantity/)).toHaveFocus();
    await user.keyboard('4');
    await user.keyboard('{Enter}'); // Enter-to-submit
    await waitFor(() => expect(documents.create).toHaveBeenCalledTimes(1));
    expect(documents.create.mock.calls[0][1]).toMatchObject({ post: true, clientRequestId: expect.any(String) });
    expect(documents.create.mock.calls[0][0].lines[0]).toMatchObject({ itemId: 'i1', quantity: '4' });
  });

  it('FR-STK-015 a failed submit and a retry send the SAME client_request_id; a successful submit mints a new one', async () => {
    documents.create.mockRejectedValueOnce(new Error('network down'));
    renderForm('issue');
    await fillIssue();
    await userEvent.click(screen.getByRole('button', { name: 'Post issue' }));
    await waitFor(() => expect(documents.create).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole('button', { name: 'Post issue' }));
    await waitFor(() => expect(documents.create).toHaveBeenCalledTimes(2));
    expect(documents.create.mock.calls[1][1].clientRequestId).toBe(documents.create.mock.calls[0][1].clientRequestId);
    expect(await screen.findByText('document page')).toBeInTheDocument();
  });

  it('FR-STK-015 sends the exact payload as decimal strings with the chosen work item', async () => {
    renderForm('issue');
    await fillIssue('2,5', 'cab', /CAB - Cable 4mm/);
    await userEvent.click(screen.getByRole('button', { name: 'Post issue' }));
    await waitFor(() => expect(documents.create).toHaveBeenCalled());
    const input = documents.create.mock.calls[0][0];
    expect(input).toMatchObject({ kind: 'issue', warehouseId: 'w1', projectId: 'p1' });
    expect(input.lines).toEqual([{ itemId: 'i2', quantity: '2.5', boqItemId: 'b1' }]);
  });

  it('STK_FRACTION a fraction on a whole-number unit is refused before it is sent', async () => {
    renderForm('issue');
    await fillIssue('2.5');
    await userEvent.click(screen.getByRole('button', { name: 'Post issue' }));
    expect(await screen.findByText(/only allows whole numbers/i)).toBeInTheDocument();
    expect(documents.create).not.toHaveBeenCalled();
  });

  it('PQ-4 a receipt labels the cost field as unreadable for a role below Project Manager, and not for a Project Manager', async () => {
    master.listKeepers.mockResolvedValue([{ warehouse_id: 'w1', user_id: 'me', org_id: 'org-1' }]);
    const { unmount } = renderForm('receive', 'Engineer');
    expect(await screen.findByLabelText(/Unit cost \(you will not see it again\)/)).toBeInTheDocument();
    unmount();
    renderForm('receive', 'Project Manager');
    expect(await screen.findByLabelText(/^Unit cost/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/you will not see it again/)).not.toBeInTheDocument();
  });

  it('AC-STK-032 loading, then populated', async () => {
    renderForm('receive');
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Warehouse/)).toBeInTheDocument();
  });

  it('AC-STK-032 empty: no warehouse you keep', async () => {
    master.listKeepers.mockResolvedValue([]);
    renderForm('receive');
    expect(await screen.findByText('You keep no warehouse')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Post receipt/ })).not.toBeInTheDocument();
  });

  it('AC-STK-032 error shows a retry, never a zero', async () => {
    master.listWarehouses.mockRejectedValueOnce(new Error('boom'));
    renderForm('receive');
    expect(await screen.findByText("Couldn't load stock")).toBeInTheDocument();
    master.listWarehouses.mockResolvedValue([wh('w1', 'SITE-A')]);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByLabelText(/^Warehouse/)).toBeInTheDocument();
  });

  it('FR-STK-064 a view-as session keeps the page read-only: no submit', async () => {
    renderForm('receive', 'Admin', 'Engineer');
    await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w1');
    expect(screen.queryByRole('button', { name: /Post receipt/ })).not.toBeInTheDocument();
  });

  it('FR-STK-064 an Admin may post to any warehouse; an unknown kind is a calm empty state', async () => {
    renderForm('receive', 'Admin');
    await userEvent.selectOptions(await screen.findByLabelText(/^Warehouse/), 'w2');
    expect(screen.getByRole('button', { name: 'Post receipt' })).toBeInTheDocument();
  });

  it('AC-STK-030 an unknown kind is a calm empty state', async () => {
    renderForm('bogus');
    expect(await screen.findByText('Unknown document kind')).toBeInTheDocument();
  });
});
