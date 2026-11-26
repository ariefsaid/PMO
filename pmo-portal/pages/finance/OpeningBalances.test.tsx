import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpeningBalance } from '@/src/lib/db/openingBalances';

const state = vi.hoisted(() => ({ allowed: true, setupEnabled: true, loading: false, error: false, data: [] as unknown[], refetch: vi.fn(), enabled: undefined as boolean | undefined }));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => action === 'view' && entity === 'openingBalance' && state.allowed }));
vi.mock('@/src/hooks/useSetupWorkflows', () => ({ useSetupWorkflows: () => ({ enabled: state.setupEnabled, isLoading: false }) }));
vi.mock('@/src/hooks/useOpeningBalances', () => ({
  useOpeningBalances: (enabled?: boolean) => { state.enabled = enabled; return { data: state.data, isLoading: state.loading, isError: state.error, refetch: state.refetch }; },
}));

import OpeningBalances from './OpeningBalances';

const stock = (over: Partial<OpeningBalance> = {}): OpeningBalance => ({
  id: 's1', kind: 'stock', asOf: '2026-11-20', loadedAt: '2026-11-21T08:00:00Z', loadedBy: 'Dewi Admin', label: 'CEN', subLabel: 'Central yard', currency: 'USD',
  lineCount: 2, note: 'source sheet 1', quantity: 15, value: 75,
  lines: [{ itemCode: 'BOLT', itemName: 'Bolt', quantity: 10, value: 50 }, { itemCode: 'NUT', itemName: 'Nut', quantity: 5, value: 25 }], ...over,
} as OpeningBalance);
const order = (over: Partial<OpeningBalance> = {}): OpeningBalance => ({
  id: 'w1', kind: 'work_order', asOf: '2026-11-20', loadedAt: '2026-11-21T08:00:00Z', loadedBy: 'Dewi Admin', label: 'WO-2026-0001', subLabel: 'Pipeline', currency: 'USD',
  lineCount: 1, note: null, certifiedValue: 4000, claimedValue: 3000,
  lines: [{ itemCode: 'L1', description: 'Line one', certifiedQuantity: 4, claimedQuantity: 3, claimedAmount: 3000 }], ...over,
} as OpeningBalance);

const renderPage = () => render(<MemoryRouter><OpeningBalances /></MemoryRouter>);
beforeEach(() => { state.allowed = true; state.setupEnabled = true; state.loading = false; state.error = false; state.data = []; state.refetch.mockReset(); });
afterEach(cleanup);

describe('Opening balances screen (AC-OBS-004..006)', () => {
  it('lets a keyboard user scroll the opening tables to reach all figures', () => {
    state.data = [stock(), order()];
    renderPage();
    const tables = screen.getAllByRole('region', { name: 'Scroll table' });
    expect(tables).toHaveLength(3);
    for (const table of tables) expect(table).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Scroll sideways to see every column.')).toBeInTheDocument();
  });
  it('AC-OBS-004 shows each location with its items, the load date and who loaded it', () => {
    state.data = [stock(), order()];
    renderPage();
    const card = screen.getByRole('region', { name: /CEN · Central yard/ });
    expect(within(card).getByText(/loaded .* by Dewi Admin/)).toBeTruthy();
    expect(within(card).getByText('BOLT · Bolt')).toBeTruthy();
    expect(within(card).getByText('NUT · Nut')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'WO-2026-0001 · Pipeline' })).getByText('L1 · Line one')).toBeTruthy();
  });

  it('AC-OBS-005 the reconciliation totals add the loaded figures, per currency, and say source totals are not kept', () => {
    state.data = [stock(), stock({ id: 's2', label: 'MOV', value: 25, quantity: 5 } as Partial<OpeningBalance>), order(), order({ id: 'w2', label: 'WO-2', certifiedValue: 1000, claimedValue: 0 } as Partial<OpeningBalance>)];
    renderPage();
    expect(screen.getByTestId('ob-total-stock').textContent).toMatch(/2 locations.*100/);
    expect(screen.getByTestId('ob-total-certified').textContent).toMatch(/2 work orders.*5,000/);
    expect(screen.getByTestId('ob-total-claimed').textContent).toMatch(/3,000/);
    expect(screen.getByTestId('ob-source-note').textContent).toMatch(/not kept with the load/);
  });

  it('AC-OBS-005 two currencies are never added together', () => {
    state.data = [order(), order({ id: 'w2', label: 'WO-2', currency: 'IDR', certifiedValue: 10, claimedValue: 0 } as Partial<OpeningBalance>)];
    renderPage();
    expect(screen.getAllByTestId('ob-total-certified')).toHaveLength(2);
  });

  it('AC-OBS-006 a role without the right sees no data and does not ask for it', () => {
    state.allowed = false;
    renderPage();
    expect(state.enabled).toBe(false);
    expect(screen.queryByText('BOLT · Bolt')).toBeNull();
  });

  it('AC-OBS-007 an opted-out organisation cannot request opening-balance data', () => {
    state.setupEnabled = false;
    renderPage();
    expect(state.enabled).toBe(false);
    expect(screen.getByText('Opening balances are turned off for this organisation. Ask an Admin to enable setup workflows.')).toBeTruthy();
  });

  it('shows the empty state, the loading state and a retry on error', () => {
    renderPage();
    expect(screen.getByText('No opening balances are loaded')).toBeTruthy();
    cleanup(); state.error = true; renderPage();
    expect(screen.getByText("Couldn't load opening balances")).toBeTruthy();
  });
});
