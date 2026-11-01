import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { axe } from 'jest-axe';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import stockEn from '@/public/locales/en/stock.json';

const { master, reorder } = vi.hoisted(() => ({
  master: { listWarehouses: vi.fn(), listItems: vi.fn(), listUnits: vi.fn() },
  reorder: { suggestion: vi.fn(), worklist: vi.fn(), setLevel: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reorder } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
let realRole: Role = 'Project Manager';
let effectiveRole: Role | null = null;
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: effectiveRole ?? realRole }) }));

import StockReorder from './StockReorder';

const wh = { id: 'w1', code: 'CEN', name: 'Central', kind: 'central', archived_at: null };
const item = { id: 'i1', code: 'CAB', name: 'Cable 4mm', unit_id: 'u1', archived_at: null };
const unit = { id: 'u1', code: 'm', name: 'Metre', whole_only: false, archived_at: null };
const rowBelow = { itemId: 'i1', itemCode: 'CAB', itemName: 'Cable 4mm', unitCode: 'm', warehouseId: 'w1', warehouseCode: 'CEN', qtyOnHand: '27', reorderLevel: '50', reorderQuantity: '60' };
const okSuggestion = {
  status: 'ok', suggestion: { reorderLevel: '42', reorderQuantity: '60' },
  inputs: { windowDays: 90, usage: '180', avgDailyUsage: '2.0000', leadTimeDays: 14, safetyDays: 7, orderCycleDays: 30, usageMovements: 6, historyDays: 91 },
  current: null,
};
const noHistory = {
  status: 'insufficient_history', suggestion: null,
  inputs: { historyDays: 27, usageMovements: 2, minHistoryDays: 28, minMovements: 3 }, current: null,
};

const renderPage = (role: Role = 'Project Manager', viewAs: Role | null = null) => {
  realRole = role;
  effectiveRole = viewAs;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter><StockReorder /></MemoryRouter></ToastProvider></QueryClientProvider>);
};

async function pickPair() {
  await userEvent.click(await screen.findByRole('combobox', { name: /^Item/ }));
  await userEvent.click(await screen.findByRole('option', { name: /CAB - Cable 4mm/ }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Warehouse' }), 'w1');
}

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listWarehouses.mockResolvedValue([wh]);
  master.listItems.mockResolvedValue([item]);
  master.listUnits.mockResolvedValue([unit]);
  reorder.worklist.mockResolvedValue([rowBelow]);
  reorder.suggestion.mockResolvedValue(okSuggestion);
  reorder.setLevel.mockResolvedValue(undefined);
});

describe('StockReorder', () => {
  it('AC-STK-025 the suggestion shows level, quantity and the inputs beside them', async () => {
    renderPage();
    await pickPair();
    expect(await screen.findByText('Suggested level')).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'Set a reorder level' });
    expect(within(panel).getByTestId('suggested-level')).toHaveTextContent('42');
    expect(within(panel).getByTestId('suggested-quantity')).toHaveTextContent('60');
    expect(within(panel).getByText(/180 m used over 90 days/)).toBeInTheDocument();
    expect(within(panel).getByText(/14 days lead time plus 7 days safety/)).toBeInTheDocument();
    expect(reorder.suggestion).toHaveBeenCalledWith('w1', 'i1');
  });

  it('AC-STK-026 "not enough history" shows no figure and says why (28 days / 3 movements)', async () => {
    reorder.suggestion.mockResolvedValue(noHistory);
    renderPage();
    await pickPair();
    expect(await screen.findByText(/needs at least 28 days of history and 3 usage movements; this item has 27 days and 2/)).toBeInTheDocument();
    expect(screen.queryByTestId('suggested-level')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set a level' })).toBeInTheDocument();
  });

  it('AC-STK-027 nothing changes until "Accept" or an edited value is saved', async () => {
    renderPage();
    await pickPair();
    await screen.findByText('Suggested level');
    expect(reorder.setLevel).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }));
    expect(reorder.setLevel).toHaveBeenCalledWith({ warehouseId: 'w1', itemId: 'i1', level: '42', quantity: '60' });
    expect((await screen.findAllByText('Reorder level saved')).length).toBeGreaterThan(0);
  });

  it('AC-STK-027 an edited value is saved as typed, and a bad one is refused before any call', async () => {
    renderPage();
    await pickPair();
    await screen.findByText('Suggested level');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const level = screen.getByRole('textbox', { name: /^Reorder level/ });
    expect(level).toHaveValue('42');
    await userEvent.clear(level);
    await userEvent.type(level, '1.2345');
    await userEvent.click(screen.getByRole('button', { name: 'Save level' }));
    expect(await screen.findByText('Enter a level of 0 or more, with at most 3 decimals.')).toBeInTheDocument();
    expect(reorder.setLevel).not.toHaveBeenCalled();
    await userEvent.clear(level);
    await userEvent.type(level, '45.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save level' }));
    expect(reorder.setLevel).toHaveBeenCalledWith({ warehouseId: 'w1', itemId: 'i1', level: '45.5', quantity: '60' });
  });

  it('FR-STK-053 the level in force is shown, and clearing asks first then sends a null level', async () => {
    reorder.suggestion.mockResolvedValue({ ...okSuggestion, current: { reorderLevel: '40', reorderQuantity: '55' } });
    renderPage();
    await pickPair();
    expect(await screen.findByText(/Level in force: 40 m/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear level' }));
    expect(reorder.setLevel).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Clear level' }));
    expect(reorder.setLevel).toHaveBeenCalledWith({ warehouseId: 'w1', itemId: 'i1', level: null });
  });

  it('FR-STK-054 the worklist lists items at or below their level and has no "Create purchase request" action', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Below reorder level' });
    expect(within(table).getByText('CAB')).toBeInTheDocument();
    expect(within(table).getByText('CEN')).toBeInTheDocument();
    expect(within(table).getByText(/^27/)).toBeInTheDocument();
    expect(within(table).getByText(/^50/)).toBeInTheDocument();
    expect(screen.queryByText(/purchase request/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
  });

  it('PQ-6 an Engineer sees the suggestion and the worklist but no Accept, Edit or Clear', async () => {
    renderPage('Engineer');
    await pickPair();
    await screen.findByText('Suggested level');
    for (const name of ['Accept suggestion', 'Edit', 'Clear level', 'Set a level']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit level for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Clear level for/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Below reorder level' })).toBeInTheDocument();
  });

  it('FR-STK-064 view-as is view-only: an Admin viewing as an Engineer gets no actions', async () => {
    renderPage('Admin', 'Engineer');
    await pickPair();
    await screen.findByText('Suggested level');
    expect(screen.queryByRole('button', { name: 'Accept suggestion' })).not.toBeInTheDocument();
  });

  it('the worklist shows the unit beside the level and the order quantity, and the form labels carry it', async () => {
    renderPage();
    const row = within(await screen.findByRole('table', { name: 'Below reorder level' })).getByText('CAB').closest('tr')!;
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent?.replace(/\s+/g, ' ').trim());
    expect(cells).toContain('50 m');
    expect(cells).toContain('60 m');
    await userEvent.click(within(row).getByRole('button', { name: 'Edit level for CAB' }));
    expect(await screen.findByRole('textbox', { name: /^Reorder level.*\(m\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Order quantity.*\(m\)$/ })).toBeInTheDocument();
  });

  it('a failed clear keeps the dialog open and shows the error in it', async () => {
    reorder.setLevel.mockRejectedValue(new AppError('STK_INVALID: nope', 'P0001'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Clear level for CAB' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear level' }));
    expect(await within(await screen.findByRole('alertdialog')).findByRole('alert')).toBeInTheDocument();
  });

  it('a worklist row opens its level for editing with the row\'s figures', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit level for CAB' }));
    expect(await screen.findByRole('textbox', { name: /^Reorder level/ })).toHaveValue('50');
    expect(screen.getByRole('textbox', { name: /^Order quantity/ })).toHaveValue('60');
  });

  it('AC-STK-032 worklist loading, empty, error with retry, populated', async () => {
    reorder.worklist.mockResolvedValue([]);
    const { unmount } = renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(await screen.findByText('Nothing is below its reorder level')).toBeInTheDocument();
    unmount();
    reorder.worklist.mockRejectedValueOnce(new AppError('boom'));
    renderPage();
    expect(await screen.findByText("Couldn't load stock")).toBeInTheDocument();
    reorder.worklist.mockResolvedValue([rowBelow]);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Below reorder level' })).toBeInTheDocument();
  });

  it('AC-STK-032 a failed suggestion shows an error, never a made-up figure', async () => {
    reorder.suggestion.mockRejectedValue(new AppError('STK_NOT_FOUND: item or warehouse is not in your organisation', 'P0001'));
    renderPage();
    await pickPair();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('suggested-level')).not.toBeInTheDocument();
  });

  it('AC-STK-030 the page has no axe violation', async () => {
    const { container } = renderPage();
    await screen.findByRole('table', { name: 'Below reorder level' });
    expect((await axe(container)).violations).toEqual([]);
  });
});
