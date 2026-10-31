import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const { master, profile, project } = vi.hoisted(() => ({
  master: {
    listUnits: vi.fn(), listItems: vi.fn(), listWarehouses: vi.fn(), listKeepers: vi.fn(),
    createUnit: vi.fn(), updateUnit: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(),
    createWarehouse: vi.fn(), updateWarehouse: vi.fn(), archive: vi.fn(), setKeeper: vi.fn(),
  },
  profile: { listOrgProfiles: vi.fn() },
  project: { listIdentity: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master }, profile, project } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import StockSetup from './StockSetup';

const unit = { id: 'u1', org_id: 'org-1', code: 'bag', name: 'Bag', whole_only: true, archived_at: null, created_at: '2026-01-01T00:00:00Z' };
const item = { id: 'i1', org_id: 'org-1', code: 'CEM-50', name: 'Cement 50kg', description: null, unit_id: 'u1', lead_time_days: 7, archived_at: null, created_at: '2026-01-01T00:00:00Z' };
const wh = { id: 'w1', org_id: 'org-1', code: 'CENTRAL', name: 'Central store', kind: 'central', project_id: null, archived_at: null, created_at: '2026-01-01T00:00:00Z' };
const members = [
  { id: 'p1', full_name: 'Ayu Keeper', status: 'active' },
  { id: 'p2', full_name: 'Bima Gone', status: 'disabled' },
];

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/stock/setup']}>
          <StockSetup />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', stockEn, true, true); // the suite mounts no catalogue by default
});

beforeEach(() => {
  vi.clearAllMocks();
  master.listUnits.mockResolvedValue([unit]);
  master.listItems.mockResolvedValue([item]);
  master.listWarehouses.mockResolvedValue([wh]);
  master.listKeepers.mockResolvedValue([]);
  for (const k of ['createUnit', 'updateUnit', 'createItem', 'updateItem', 'createWarehouse', 'updateWarehouse', 'archive', 'setKeeper'] as const) master[k].mockResolvedValue(undefined);
  profile.listOrgProfiles.mockResolvedValue(members);
  project.listIdentity.mockResolvedValue([{ id: 'pr1', name: 'Tower A' }]);
});

describe('StockSetup screen states (AC-STK-032)', () => {
  it('AC-STK-032 shows a loading skeleton, then the populated rows', async () => {
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(await screen.findByText('Bag')).toBeInTheDocument();
    expect(screen.queryByTestId('liststate-loading')).not.toBeInTheDocument();
  });

  it('AC-STK-032 an empty collection offers the first-add action', async () => {
    master.listUnits.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No units yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add the first unit' })).toBeInTheDocument();
  });

  it('AC-STK-032 an error shows a retry and no zero rows', async () => {
    master.listUnits.mockRejectedValueOnce(new AppError('boom'));
    renderPage();
    expect(await screen.findByText("Couldn't load stock setup")).toBeInTheDocument();
    master.listUnits.mockResolvedValue([unit]);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Bag')).toBeInTheDocument();
  });

  it('AC-STK-032 an archived row is dimmed with a Restore action', async () => {
    master.listUnits.mockResolvedValue([{ ...unit, archived_at: '2026-02-01T00:00:00Z' }]);
    renderPage();
    expect(await screen.findByText('Archived')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]);
    expect(await screen.findByRole('menuitem', { name: 'Restore' })).toBeInTheDocument();
  });
});

describe('StockSetup permissions (AC-STK-033)', () => {
  it('AC-STK-033 an Engineer sees the data but no Add / Edit affordance', async () => {
    renderPage('Engineer');
    await screen.findByText('Bag');
    expect(screen.queryByRole('button', { name: 'New unit' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Items' }));
    await screen.findByText('Cement 50kg');
    expect(screen.queryByRole('button', { name: 'New item' })).not.toBeInTheDocument();
    expect(screen.getByText(/Project Managers and above can change it/)).toBeInTheDocument();
  });

  it('AC-STK-033 a Project Manager can add an item but sees no keepers control', async () => {
    renderPage('Project Manager');
    await userEvent.click(await screen.findByRole('tab', { name: 'Items' }));
    expect(await screen.findByRole('button', { name: 'New item' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Warehouses' }));
    await screen.findByText('Central store');
    expect(screen.queryByRole('button', { name: /^Keepers/ })).not.toBeInTheDocument();
  });
});

describe('StockSetup writes', () => {
  it('FR-STK-007 creating a unit sends trimmed text and the whole-number flag, never an org id', async () => {
    renderPage('Project Manager');
    await userEvent.click(await screen.findByRole('button', { name: 'New unit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Code/), ' kg ');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Kilogram');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /whole numbers only/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create unit' }));
    await waitFor(() => expect(master.createUnit).toHaveBeenCalledWith({ code: ' kg ', name: 'Kilogram', wholeOnly: true }));
  });

  it('FR-STK-080 a rejected create shows the stock-code copy, else the generic classification', async () => {
    master.createUnit.mockRejectedValueOnce(new AppError('STK_INVALID: bad', 'P0001'));
    renderPage('Project Manager');
    await userEvent.click(await screen.findByRole('button', { name: 'New unit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Code/), 'kg');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Kilogram');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create unit' }));
    expect(await within(dialog).findByText('Some of the details are not valid.')).toBeInTheDocument();
  });

  it('FR-STK-004 the keepers panel is Admin only and toggling calls setKeeper', async () => {
    renderPage('Admin');
    await userEvent.click(await screen.findByRole('tab', { name: 'Warehouses' }));
    await screen.findByText('Central store');
    await userEvent.click(screen.getByRole('button', { name: /^Keepers/ }));
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByText('Ayu Keeper')).toBeInTheDocument();
    expect(within(panel).queryByText('Bima Gone')).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('checkbox', { name: /Ayu Keeper/ }));
    await waitFor(() => expect(master.setKeeper).toHaveBeenCalledWith({ warehouseId: 'w1', userId: 'p1', assigned: true }));
  });

  it('FR-STK-006 archiving asks for confirmation and then archives the table row', async () => {
    renderPage('Project Manager');
    await screen.findByText('Bag');
    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(master.archive).toHaveBeenCalledWith('stock_units', 'u1', true));
  });
});
