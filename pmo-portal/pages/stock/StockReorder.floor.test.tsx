import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

/**
 * Floor list (all-screens/floor-tests/stock-reorder.md). Every other row is covered on the base
 * (StockReorder.test.tsx). What remained is "Set a level": the button that appears INSTEAD of
 * Accept/Edit when an item has too little history to suggest one — the base asserted only that the
 * button renders (:133-142), never that pressing it opens an empty form and that a typed level is
 * the one written.
 */

const { master, reorder } = vi.hoisted(() => ({
  master: { listWarehouses: vi.fn(), listItems: vi.fn(), listUnits: vi.fn() },
  reorder: { suggestion: vi.fn(), worklist: vi.fn(), setLevel: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reorder } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
let realRole: Role = 'Project Manager';
const effectiveRole: Role | null = null;
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: effectiveRole ?? realRole }) }));

import StockReorder from './StockReorder';

const wh = { id: 'w1', code: 'CEN', name: 'Central', kind: 'central', archived_at: null };
const item = { id: 'i1', code: 'CAB', name: 'Cable 4mm', unit_id: 'u1', archived_at: null };
const unit = { id: 'u1', code: 'm', name: 'Metre', whole_only: false, archived_at: null };
const rowBelow = { itemId: 'i1', itemCode: 'CAB', itemName: 'Cable 4mm', unitCode: 'm', warehouseId: 'w1', warehouseCode: 'CEN', qtyOnHand: '27', reorderLevel: '50', reorderQuantity: '60' };
const noHistory = {
  status: 'insufficient_history', suggestion: null,
  inputs: { historyDays: 27, usageMovements: 2, minHistoryDays: 28, minMovements: 3 }, current: null,
};

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location" data-search={location.search} />;
};

const renderPage = () => {
  realRole = 'Project Manager';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/reorder']}>
          <LocationProbe />
          <Routes><Route path="/reorder" element={<StockReorder />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
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
  reorder.suggestion.mockResolvedValue(noHistory);
  reorder.setLevel.mockResolvedValue(undefined);
});

describe('stock reorder floor controls', () => {
  it('floor: Set a level opens an empty level form and saves the level the person types', async () => {
    renderPage();
    await pickPair();
    const panel = await screen.findByRole('region', { name: 'Set a reorder level' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Set a level' }));

    const level = await screen.findByRole('textbox', { name: /^Reorder level/ });
    expect(level).toHaveValue('');
    await userEvent.type(level, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save level' }));

    await waitFor(() => expect(reorder.setLevel).toHaveBeenCalledWith({ warehouseId: 'w1', itemId: 'i1', level: '30', quantity: null }));
  });
});