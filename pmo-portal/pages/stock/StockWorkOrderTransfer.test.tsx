import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';
import stockId from '@/public/locales/id/stock.json';
import refusalsEn from '@/public/locales/en/refusals.json';
import refusalsId from '@/public/locales/id/refusals.json';

const h = vi.hoisted(() => ({ enabled: true, role: 'Engineer', real: 'Engineer', post: vi.fn(), navigate: vi.fn() }));
vi.mock('react-router', async (orig) => ({ ...(await orig<typeof import('react-router')>()), useNavigate: () => h.navigate }));
vi.mock('@/src/hooks/useStockWorkOrderTransfer', () => ({
  useWoTransfersEnabled: () => h.enabled,
  useWoTransferRefresh: () => async () => [],
  useProjectWorkOrdersForStock: (p?: string) => ({ data: p ? [
    { id: 'wa', wo_number: 'WO-1', title: 'Slab', status: 'Issued' }, { id: 'wb', wo_number: 'WO-2', title: 'Wall', status: 'Issued' }, { id: 'wc', wo_number: 'WO-3', title: 'Old', status: 'Cancelled' }] : [] }),
  useReturnable: (w?: string) => ({ data: w === 'wa' ? [{ itemId: 'i1', itemCode: 'PIPE', itemName: 'Pipe', unitCode: 'pc', quantity: '3', boqItemId: 'e1', value: null }] : w ? [] : undefined }),
}));
vi.mock('@/src/hooks/useStock', () => ({
  useIssuableProjects: () => ({ data: [{ id: 'p1', name: 'Tower A' }] }),
  useStockWarehouses: () => ({ data: [
    { id: 'w1', code: 'SITE1', name: 'Site one', kind: 'site', project_id: 'p1' }, { id: 'w2', code: 'CEN', name: 'Central', kind: 'central', project_id: null },
    { id: 'w3', code: 'SITE9', name: 'Other site', kind: 'site', project_id: 'p1' }] }),
  useStockKeepers: () => ({ data: [{ user_id: 'me', warehouse_id: 'w1' }, { user_id: 'me', warehouse_id: 'w2' }] }),
}));
vi.mock('@/src/lib/repositories/stockWorkOrderTransfer', () => ({ stockWorkOrderTransferRepository: { post: h.post } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.real, effectiveRole: h.role }) }));

import StockWorkOrderTransfer from './StockWorkOrderTransfer';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => { vi.clearAllMocks(); h.enabled = true; h.role = 'Engineer'; h.real = 'Engineer'; h.post.mockResolvedValue('wot-1'); });
const renderPage = () => render(<ToastProvider><MemoryRouter><StockWorkOrderTransfer /></MemoryRouter></ToastProvider>);

const fill = async (qty: string) => {
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /Project/ }), 'Tower A');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /From work order/ }), 'WO-1 - Slab');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /To work order/ }), 'WO-2 - Wall');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /Where the material is/ }), 'SITE1 - Site one');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /Item1/ }), 'PIPE - Pipe');
  await userEvent.type(screen.getByRole('textbox', { name: /Quantity1/ }), qty);
};

describe('StockWorkOrderTransfer (AC-WOT-016, 017, 019)', () => {
  it('AC-WOT-019 while the setting is off the page shows that transfers are off, not a form', () => {
    h.enabled = false;
    renderPage();
    expect(screen.getByText('Work-order transfers are off')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to the other work order/ })).not.toBeInTheDocument();
  });

  it('AC-WOT-009 view-only impersonation sees no form (the real role is the authority, so the UI hides it)', () => {
    h.real = 'Admin'; h.role = 'Engineer';
    renderPage();
    expect(screen.queryByRole('combobox', { name: /Project/ })).not.toBeInTheDocument();
  });

  it('AC-WOT-016 the pickers list the kept project locations and the open work orders, never a cancelled one or another kind of location', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Project/ }), 'Tower A');
    const from = screen.getByRole('combobox', { name: /From work order/ });
    expect(from).toHaveTextContent('WO-1 - Slab');
    expect(from).not.toHaveTextContent('WO-3');
    const loc = screen.getByRole('combobox', { name: /Where the material is/ });
    expect(loc).toHaveTextContent('SITE1 - Site one');
    expect(loc).not.toHaveTextContent('CEN');       // central is not a project location
    expect(loc).not.toHaveTextContent('SITE9');     // not kept by this person
  });

  it('AC-WOT-016 a quantity above what the work order holds is refused before submitting, in the person\'s words', async () => {
    renderPage();
    await fill('5');
    await userEvent.click(screen.getByRole('button', { name: 'Move to the other work order' }));
    expect(await screen.findByText('The work order holds only 3 of this item.')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });

  it('AC-WOT-016 a valid move confirms, then posts the payload with the work item of the returned lines and one request id', async () => {
    renderPage();
    await fill('2');
    await userEvent.click(screen.getByRole('button', { name: 'Move to the other work order' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to the other work order' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0][0]).toEqual({ warehouseId: 'w1', fromWorkOrderId: 'wa', toWorkOrderId: 'wb', note: '', disciplineId: null, lines: [{ itemId: 'i1', quantity: '2', boqItemId: 'e1' }] });
    expect(h.post.mock.calls[0][1]).toMatch(/[0-9a-f-]{36}/);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/stock/work-order-transfer/wot-1'));
  });

  it('AC-WOT-017 every work-order transfer string and refusal exists in English and Bahasa Indonesia', () => {
    const keys = (o: Record<string, unknown>, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    const en = keys(stockEn.workOrderTransfer as Record<string, unknown>).sort();
    const id = keys(stockId.workOrderTransfer as Record<string, unknown>).sort();
    expect(id).toEqual(en);
    for (const code of ['STK_WOT_OFF', 'STK_WOT_EXCEEDS', 'STK_WOT_PROJECT', 'STK_WOT_LOCATION', 'STK_WOT_INCOMPLETE', 'STK_WOT_SYSTEM']) {
      expect((refusalsEn as Record<string, string>)[code]).toBeTruthy();
      expect((refusalsId as Record<string, string>)[code]).toBeTruthy();
    }
  });
});
