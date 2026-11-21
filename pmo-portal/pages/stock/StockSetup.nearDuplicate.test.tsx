/**
 * #2692 — the near-duplicate warning on a new stock item. It is advisory: the person is told, can see
 * the existing item, and is never stopped. The existing StockSetup.test.tsx stays untouched; this file
 * is the journey the ticket describes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';
import { BahasaProvider } from '@/test/bahasa';

const ownership = vi.hoisted(() => ({ mode: 'pmo' }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ isOwnershipCacheSynced: () => true, routeDomainWrite: () => ownership.mode, subscribeOwnershipCache: () => () => {} }));

const { master, profile, project, reports, tags } = vi.hoisted(() => ({
  master: {
    listUnits: vi.fn(), listItems: vi.fn(), listWarehouses: vi.fn(), listKeepers: vi.fn(),
    createUnit: vi.fn(), updateUnit: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(),
    createWarehouse: vi.fn(), updateWarehouse: vi.fn(), archive: vi.fn(), setKeeper: vi.fn(),
  },
  tags: { list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn() },
  profile: { listOrgProfiles: vi.fn() },
  project: { listIdentity: vi.fn() },
  reports: { onHand: vi.fn() },
}));
vi.mock('@/src/lib/repositories/stockSiteWork', () => ({ stockSiteWorkRepository: { tags } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reports }, profile, project } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));

import StockSetup from './StockSetup';

const unit = { id: 'u1', org_id: 'org-1', code: 'bag', name: 'Bag', whole_only: true, archived_at: null, created_at: '2026-01-01T00:00:00Z' };
const cement = { id: 'i1', org_id: 'org-1', code: 'CEM-50', name: 'Cement 50 kg', description: null, unit_id: 'u1', lead_time_days: 7, archived_at: null, created_at: '2026-01-01T00:00:00Z' };
const mortar = { id: 'i2', org_id: 'org-1', code: 'MOR-10', name: 'Mortar 10 kg', description: null, unit_id: 'u1', lead_time_days: null, archived_at: null, created_at: '2026-01-01T00:00:00Z' };

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/stock/setup?tab=items']}>
          <StockSetup />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

const openNewItem = async (label = 'New item') => {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  return screen.findByRole('dialog');
};

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', stockEn, true, true);
});

beforeEach(() => {
  vi.clearAllMocks();
  ownership.mode = 'pmo';
  tags.list.mockResolvedValue([]);
  master.listUnits.mockResolvedValue([unit]);
  master.listItems.mockResolvedValue([cement, mortar]);
  master.listWarehouses.mockResolvedValue([]);
  master.listKeepers.mockResolvedValue([]);
  for (const k of ['createUnit', 'updateUnit', 'createItem', 'updateItem', 'createWarehouse', 'updateWarehouse', 'archive', 'setKeeper'] as const) master[k].mockResolvedValue(undefined);
  profile.listOrgProfiles.mockResolvedValue([]);
  project.listIdentity.mockResolvedValue([]);
  reports.onHand.mockResolvedValue([]);
});

describe('near-duplicate warning on a new stock item (AC-NDI-001, 007)', () => {
  it('AC-NDI-001 warns when the typed name matches an existing item and leaves the create button enabled', async () => {
    renderPage();
    const dialog = await openNewItem();
    await userEvent.type(within(dialog).getByLabelText(/^Code/), 'CEM-51');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Unit/), 'u1');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'cement 50kg');

    const notice = await within(dialog).findByTestId('similar-item-notice');
    expect(notice).toHaveTextContent('A similar item already exists');
    expect(notice).toHaveTextContent('CEM-50 · Cement 50 kg');
    expect(within(dialog).getByRole('button', { name: 'Create item' })).toBeEnabled();
  });

  it('AC-NDI-007 links each match to that item ledger from a polite status region', async () => {
    master.listItems.mockResolvedValue([cement, mortar]);
    renderPage();
    const dialog = await openNewItem();
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Cement 50 kgs');

    const status = await within(dialog).findByRole('status');
    expect(status).toHaveAttribute('data-testid', 'similar-item-notice');
    const list = within(status).getByRole('list', { name: 'Similar items' });
    const link = within(list).getByRole('link', { name: /CEM-50/ });
    expect(link).toHaveAttribute('href', '/stock/ledger?item=i1');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('the warning never blocks (AC-NDI-005)', () => {
  it('AC-NDI-005 creates the item with the typed values while the warning is showing', async () => {
    renderPage();
    const dialog = await openNewItem();
    await userEvent.type(within(dialog).getByLabelText(/^Code/), 'CEM-51');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Unit/), 'u1');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Cement 50 kg');
    await within(dialog).findByTestId('similar-item-notice');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));

    await waitFor(() => expect(master.createItem).toHaveBeenCalledWith(expect.objectContaining({ code: 'CEM-51', name: 'Cement 50 kg', unitId: 'u1' })));
    expect(screen.queryByTestId('similar-item-notice')).not.toBeInTheDocument();
  });
});

describe('the check has edges (AC-NDI-004, 006, 008)', () => {
  it('AC-NDI-004 says nothing when the name is far from every item', async () => {
    renderPage();
    const dialog = await openNewItem();
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Bitumen drum');
    expect(within(dialog).queryByTestId('similar-item-notice')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
  });

  it('AC-NDI-006 says the check could not run when the item list failed, and the item can still be created', async () => {
    master.listItems.mockRejectedValue(new AppError('offline'));
    renderPage();
    const dialog = await openNewItem();
    expect(await within(dialog).findByText(/Could not check existing item names/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^Code/), 'BIT-01');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Unit/), 'u1');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Bitumen drum');
    expect(within(dialog).getByRole('button', { name: 'Create item' })).toBeEnabled();
  });

  it('AC-NDI-008 stays silent while an existing item is renamed', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Items' });
    const row = screen.getByRole('row', { name: /MOR-10/ });
    await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText(/^Name/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Cement 50 kg');
    expect(within(dialog).queryByTestId('similar-item-notice')).not.toBeInTheDocument();
  });
});

describe('the warning reads in Bahasa Indonesia (AC-NDI-009)', () => {
  it('AC-NDI-009 shows the shipped Bahasa copy for the warning', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <BahasaProvider>
          <ToastProvider>
            <MemoryRouter initialEntries={['/stock/setup?tab=items']}>
              <StockSetup />
            </MemoryRouter>
          </ToastProvider>
        </BahasaProvider>
      </QueryClientProvider>,
    );
    const dialog = await openNewItem('Barang baru');
    await userEvent.type(within(dialog).getByLabelText(/^Nama/), 'cement 50kg');
    const notice = await within(dialog).findByTestId('similar-item-notice');
    expect(notice).toHaveTextContent('Barang serupa sudah ada');
    expect(notice).toHaveTextContent('Periksa dulu sebelum menambah duplikat.');
  });
});
