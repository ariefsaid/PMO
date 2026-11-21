import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const ownership = vi.hoisted(() => ({ mode: 'pmo' }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ isOwnershipCacheSynced: () => true, routeDomainWrite: () => ownership.mode, subscribeOwnershipCache: () => () => {} }));

const { master, profile, project, reports, tags, company } = vi.hoisted(() => ({
  master: {
    listUnits: vi.fn(), listItems: vi.fn(), listWarehouses: vi.fn(), listKeepers: vi.fn(),
    createUnit: vi.fn(), updateUnit: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(),
    createWarehouse: vi.fn(), updateWarehouse: vi.fn(), archive: vi.fn(), setKeeper: vi.fn(),
  },
  tags: { list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn() },
  profile: { listOrgProfiles: vi.fn() },
  project: { listIdentity: vi.fn() },
  reports: { onHand: vi.fn() },
  company: { list: vi.fn() },
}));
vi.mock('@/src/lib/repositories/stockSiteWork', () => ({ stockSiteWorkRepository: { tags } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reports }, profile, project, company } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));

let realRole: Role = 'Admin';
let effectiveRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole }) }));

import StockSetup from './StockSetup';

const wh = { id: 'w1', org_id: 'org-1', code: 'CENTRAL', name: 'Central store', kind: 'central', project_id: null, archived_at: null, created_at: '2026-01-01T00:00:00Z' };


const vendorWh = { id: 'w9', org_id: 'org-1', code: 'COAT', name: 'At the coater', kind: 'vendor', project_id: null, vendor_company_id: 'c1', archived_at: null, created_at: '2026-01-01T00:00:00Z' };

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  ownership.mode = 'pmo';
  tags.list.mockResolvedValue([]);
  master.listUnits.mockResolvedValue([]);
  master.listItems.mockResolvedValue([]);
  master.listWarehouses.mockResolvedValue([wh, vendorWh]);
  master.listKeepers.mockResolvedValue([]);
  for (const k of ['createWarehouse', 'updateWarehouse'] as const) master[k].mockResolvedValue(undefined);
  profile.listOrgProfiles.mockResolvedValue([]);
  project.listIdentity.mockResolvedValue([{ id: 'pr1', name: 'Tower A' }]);
  reports.onHand.mockResolvedValue([]);
  company.list.mockResolvedValue([{ id: 'c1', name: 'Coating Co', type: 'Vendor' }, { id: 'c2', name: 'Pipe Supply', type: 'Vendor' }]);
});

const renderPage = () => {
  realRole = 'Admin'; effectiveRole = 'Admin';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={['/stock/setup?tab=warehouses']}><StockSetup /></MemoryRouter></ToastProvider></QueryClientProvider>);
};

describe('StockSetup vendor location (AC-SVL-010)', () => {
  it('AC-SVL-010 a Vendor kind hides the project, offers the vendor companies, and saves the vendor link without a project', async () => {
    renderPage();
    await screen.findByText('Central store');
    expect(screen.getByText('Coating Co')).toBeInTheDocument();                                  // the list names the vendor of a vendor location
    await userEvent.click(screen.getByRole('button', { name: 'New warehouse' }));
    expect(screen.getByRole('combobox', { name: /Site project/ })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Vendor company/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /^Code/ }), 'COAT2');
    await userEvent.type(screen.getByRole('textbox', { name: /^Name/ }), 'Second coater');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Kind/ }), 'Vendor');
    expect(screen.queryByRole('combobox', { name: /Site project/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Vendor company/ }), 'Pipe Supply');
    await userEvent.click(screen.getByRole('button', { name: 'Create warehouse' }));
    await waitFor(() => expect(master.createWarehouse).toHaveBeenCalledWith({ code: 'COAT2', name: 'Second coater', kind: 'vendor', projectId: null, vendorCompanyId: 'c2' }));
  });

  it('AC-SVL-010 the Vendor kind reads in Bahasa Indonesia too', async () => {
    const id = await import('@/public/locales/id/stock.json');
    expect(stockEn.setup.kinds.vendor).toBe('Vendor');
    expect(id.default.setup.kinds.vendor).toBe('Vendor luar');
    expect(id.default.onHand.atVendor).toBe('Di vendor');
  });
});
