import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const { master, profile, project, reports } = vi.hoisted(() => ({
  master: {
    listUnits: vi.fn(), listItems: vi.fn(), listWarehouses: vi.fn(), listKeepers: vi.fn(),
    createUnit: vi.fn(), updateUnit: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(),
    createWarehouse: vi.fn(), updateWarehouse: vi.fn(), archive: vi.fn(), setKeeper: vi.fn(),
  },
  profile: { listOrgProfiles: vi.fn() },
  project: { listIdentity: vi.fn() },
  reports: { onHand: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reports }, profile, project } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));

let realRole: Role = 'Admin';
let effectiveRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole }) }));

import StockSetup from './StockSetup';

const unit = { id: 'u1', org_id: 'org-1', code: 'bag', name: 'Bag', whole_only: true, archived_at: null, created_at: '2026-01-01T00:00:00Z' };
const item = { id: 'i1', org_id: 'org-1', code: 'CEM-50', name: 'Cement 50kg', description: null, unit_id: 'u1', lead_time_days: 7, archived_at: null, created_at: '2026-01-01T00:00:00Z' };
const warehouse = { id: 'w1', org_id: 'org-1', code: 'CENTRAL', name: 'Central store', kind: 'central', project_id: null, archived_at: null, created_at: '2026-01-01T00:00:00Z' };

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <output data-testid="location" data-search={location.search} />;
};

const renderPage = (initialEntry = '/stock/setup') => {
  realRole = 'Admin';
  effectiveRole = 'Admin';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LocationProbe />
          <StockSetup />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listUnits.mockResolvedValue([unit]);
  master.listItems.mockResolvedValue([item]);
  master.listWarehouses.mockResolvedValue([warehouse]);
  master.listKeepers.mockResolvedValue([]);
  for (const name of ['createUnit', 'updateUnit', 'createItem', 'updateItem', 'createWarehouse', 'updateWarehouse', 'archive', 'setKeeper'] as const) {
    master[name].mockResolvedValue(undefined);
  }
  profile.listOrgProfiles.mockResolvedValue([]);
  project.listIdentity.mockResolvedValue([{ id: 'pr1', name: 'Tower A' }]);
  reports.onHand.mockResolvedValue([]);
});

describe('stock setup floor controls', () => {
  it('floor: Show archived reveals archived rows and removes them again when unchecked', async () => {
    const archivedUnit = { ...unit, id: 'u2', code: 'old-bag', name: 'Old bag', archived_at: '2026-02-01T00:00:00Z' };
    master.listUnits.mockImplementation((includeArchived: boolean) => Promise.resolve(includeArchived ? [unit, archivedUnit] : [unit]));
    renderPage();
    await screen.findByText('Bag');
    expect(screen.queryByText('Old bag')).not.toBeInTheDocument();

    const archived = screen.getByRole('checkbox', { name: 'Show archived' });
    await userEvent.click(archived);
    expect(await screen.findByText('Old bag')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?archived=true');

    await userEvent.click(archived);
    await waitFor(() => expect(screen.queryByText('Old bag')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '');
  });

  it('floor: Edit opens a prefilled unit form and saves the changed value', async () => {
    renderPage();
    await screen.findByText('Bag');
    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^Code/)).toHaveValue('bag');
    const name = within(dialog).getByLabelText(/^Name/);
    expect(name).toHaveValue('Bag');
    await userEvent.clear(name);
    await userEvent.type(name, 'Bag revised');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save unit' }));
    await waitFor(() => expect(master.updateUnit).toHaveBeenCalledWith('u1', { code: 'bag', name: 'Bag revised', wholeOnly: true }));
  });

  it('floor: Restore unarchives the row and it reads Active', async () => {
    let archivedAt: string | null = '2026-02-01T00:00:00Z';
    const getArchived = () => ({ ...unit, archived_at: archivedAt });
    master.listUnits.mockImplementation((includeArchived: boolean) => Promise.resolve(includeArchived ? [getArchived()] : []));
    master.archive.mockImplementation(async (_table: string, id: string, archived: boolean) => {
      if (id === 'u1') archivedAt = archived ? '2026-02-01T00:00:00Z' : null;
    });
    renderPage('/stock/setup?archived=true');
    await screen.findByText('Archived');
    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    await waitFor(() => expect(master.archive).toHaveBeenCalledWith('stock_units', 'u1', false));
    expect(await screen.findByText('Active')).toBeInTheDocument();
  });

  it('floor: item form sends its fields and refuses an out-of-range lead time', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Items' }));
    await screen.findByText('Cement 50kg');
    await userEvent.click(screen.getByRole('button', { name: 'New item' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Code/), 'ANCHOR');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Chemical anchor');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Unit' }), 'u1');
    const leadTime = within(dialog).getByLabelText('Lead time (days)');
    await userEvent.type(leadTime, '366');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Fixing compound');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(master.createItem).not.toHaveBeenCalled();
    expect(within(dialog).getAllByRole('alert').length).toBeGreaterThan(0);

    await userEvent.clear(leadTime);
    await userEvent.type(leadTime, '14');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    await waitFor(() => expect(master.createItem).toHaveBeenCalledWith({ code: 'ANCHOR', name: 'Chemical anchor', description: 'Fixing compound', unitId: 'u1', leadTimeDays: 14 }));
  });

  it('floor: warehouse form sends its kind and default project', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Warehouses' }));
    await screen.findByText('Central store');
    await userEvent.click(screen.getByRole('button', { name: 'New warehouse' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Code/), 'SITE-B');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'North yard');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Kind' }), 'site');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Site project' }), 'pr1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create warehouse' }));
    await waitFor(() => expect(master.createWarehouse).toHaveBeenCalledWith({ code: 'SITE-B', name: 'North yard', kind: 'site', projectId: 'pr1' }));
  });
});
