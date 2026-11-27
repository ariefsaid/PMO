import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({ twoStep: true, send: vi.fn(), navigate: vi.fn() }));
vi.mock('react-router', async (orig) => ({ ...(await orig<typeof import('react-router')>()), useNavigate: () => h.navigate }));
vi.mock('@/src/hooks/useStockTransfers', () => ({ useIsTwoStep: () => h.twoStep, useTransferRefresh: () => async () => [] }));
vi.mock('@/src/hooks/useStock', () => ({
  useStockWarehouses: () => ({ data: [
    { id: 'w1', code: 'CEN', name: 'Central', kind: 'central' }, { id: 'w2', code: 'SITE1', name: 'Site one', kind: 'site' },
    { id: 'w9', code: 'TRN-1', name: 'In transit TST-1', kind: 'transit' }] }),
  useStockKeepers: () => ({ data: [{ user_id: 'me', warehouse_id: 'w1' }, { user_id: 'p2', warehouse_id: 'w2' }, { user_id: 'p3', warehouse_id: 'w1' }] }),
  useMyStockLocations: () => ((rows: { user_id: string; warehouse_id: string }[], me: string) => { const ids = new Set(rows.filter((k) => k.user_id === me).map((k) => k.warehouse_id)); return { ids, keeps: (id?: string | null) => !!id && ids.has(id), keepsAny: ids.size > 0, isError: false, isPending: false, refetch: () => undefined }; })([{ user_id: 'me', warehouse_id: 'w1' }], 'me'),
  useStockItems: () => ({ data: [{ id: 'i1', code: 'PIPE', name: 'Pipe', unit_id: 'u1', archived_at: null }] }),
  useStockUnits: () => ({ data: [{ id: 'u1', code: 'pc', whole_only: false }] }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [{ id: 'p2', full_name: 'Site Foreman', is_active: true }, { id: 'p3', full_name: 'Central Clerk', is_active: true }, { id: 'me', full_name: 'Me', is_active: true }] }) }));
vi.mock('@/src/lib/repositories/stockTransfers', () => ({ stockTransfersRepository: { send: h.send } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

import StockTransferSend from './StockTransferSend';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => { vi.clearAllMocks(); h.twoStep = true; h.send.mockResolvedValue('tr-1'); });
const renderPage = () => render(<ToastProvider><MemoryRouter><StockTransferSend /></MemoryRouter></ToastProvider>);

describe('StockTransferSend (AC-TST-023)', () => {
  it('AC-TST-023 a one-step organisation sees that two-step transfers are off, not a form', () => {
    h.twoStep = false;
    renderPage();
    expect(screen.getByText('Two-step stock transfers are off')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send stock transfer' })).not.toBeInTheDocument();
  });

  it('AC-TST-023 the pickers list the kept source and every real destination, never an in-transit location', async () => {
    renderPage();
    const from = screen.getByRole('combobox', { name: /From warehouse/ });
    const to = screen.getByRole('combobox', { name: /To warehouse/ });
    expect(within(from).getByRole('option', { name: 'CEN - Central' })).toBeInTheDocument();
    expect(within(from).queryByRole('option', { name: /SITE1/ })).not.toBeInTheDocument();     // not kept by this person
    expect(within(to).getByRole('option', { name: 'SITE1 - Site one' })).toBeInTheDocument();
    expect(within(to).queryByRole('option', { name: /TRN-1/ })).not.toBeInTheDocument();
  });

  /** Fill a valid transfer using the options' real values: central (w1) to the site (w2), receiver p2, one line of 4 pipe. */
  const fillValidTransfer = async () => {
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /From warehouse/ }), 'w1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /To warehouse/ }), 'w2');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Receiver/ }), 'p2');
    await userEvent.click(screen.getByRole('combobox', { name: /^Item/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'PIPE - Pipe' }));
    await userEvent.type(screen.getByRole('textbox', { name: /^Quantity/ }), '4');
  };

  it('AC-TST-023 sending refuses a blank form without asking, then confirms once and sends the lines with a named receiver and one request id', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Send stock transfer' }));
    expect(h.send).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();          // a missing field is a field error, not a confirmation
    await fillValidTransfer();
    await userEvent.click(screen.getByRole('button', { name: 'Send stock transfer' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Send this transfer?')).toBeInTheDocument();
    expect(within(dialog).getByText('From CEN - Central to SITE1 - Site one')).toBeInTheDocument();
    expect(within(dialog).getByText('PIPE - Pipe: 4 pc')).toBeInTheDocument();  // the item, its quantity and unit
    expect(h.send).not.toHaveBeenCalled();                                  // nothing posts before the one confirmation
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send transfer' }));
    await waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
    expect(h.send.mock.calls[0][0]).toEqual({ fromWarehouseId: 'w1', toWarehouseId: 'w2', toUserId: 'p2', note: '', lines: [{ itemId: 'i1', quantity: '4' }] });
    expect(h.send.mock.calls[0][1]).toMatch(/[0-9a-f-]{36}/);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/stock/transfers/tr-1'));
  });

  it('FR-SKD-005 cancelling the guard sends nothing and keeps the filled form', async () => {
    renderPage();
    await fillValidTransfer();
    await userEvent.click(screen.getByRole('button', { name: 'Send stock transfer' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(h.send).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
    // The form kept the chosen source: the select's value is the option value, the label is what the person sees.
    expect(screen.getByRole('combobox', { name: /From warehouse/ })).toHaveValue('w1');
    expect(screen.getByRole('combobox', { name: /From warehouse/ })).toHaveDisplayValue('CEN - Central');
    expect(screen.getByRole('combobox', { name: /To warehouse/ })).toHaveValue('w2');
    expect(screen.getByRole('combobox', { name: /To warehouse/ })).toHaveDisplayValue('SITE1 - Site one');
    expect(screen.getByRole('textbox', { name: /^Quantity/ })).toHaveValue('4');
  });

  it('JOB-1122-1 the receiver picker offers only people who can receive at the destination, never the sender', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /To warehouse/ }), 'SITE1 - Site one');
    const receiver = screen.getByRole('combobox', { name: /Receiver/ });
    expect(within(receiver).getByRole('option', { name: 'Site Foreman' })).toBeInTheDocument();
    expect(within(receiver).queryByRole('option', { name: 'Central Clerk' })).not.toBeInTheDocument();   // keeps the source, not the destination
    expect(within(receiver).queryByRole('option', { name: 'Me' })).not.toBeInTheDocument();
  });
});

it("asks before leaving a transfer with a note", async () => { renderPage(); await userEvent.type(screen.getByRole("textbox", {name: /note/i}), "Keep this draft"); await userEvent.click(screen.getByRole("button", {name: "Cancel"})); expect(h.navigate).not.toHaveBeenCalled(); expect(screen.getByRole("button", {name: /keep editing/i})).toBeInTheDocument(); });
