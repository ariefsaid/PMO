import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const { master, profile, project, reports, odoo } = vi.hoisted(() => ({
  master: { listUnits: vi.fn(), listItems: vi.fn(), listWarehouses: vi.fn(), listKeepers: vi.fn() },
  profile: { listOrgProfiles: vi.fn() },
  project: { listIdentity: vi.fn() },
  reports: { onHand: vi.fn() },
  odoo: { getConnection: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reports }, profile, project, odoo } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));

import StockSetup from './StockSetup';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/stock/setup']}><StockSetup /></MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listUnits.mockResolvedValue([]); master.listItems.mockResolvedValue([]); master.listWarehouses.mockResolvedValue([]);
  master.listKeepers.mockResolvedValue([]); profile.listOrgProfiles.mockResolvedValue([]); project.listIdentity.mockResolvedValue([]);
  reports.onHand.mockResolvedValue([]);
});

describe('Stock setup navigation (#2448)', () => {
  it('offers a back link to Stock', async () => {
    odoo.getConnection.mockResolvedValue({ status: 'inactive', activated: false });
    renderPage();
    const back = await screen.findByRole('link', { name: /back to stock/i });
    expect(back).toHaveAttribute('href', '/stock');
  });

  it('links into the Odoo directories when Odoo is connected', async () => {
    odoo.getConnection.mockResolvedValue({ status: 'active', activated: true });
    renderPage();
    const link = await screen.findByRole('link', { name: /odoo directories/i });
    expect(link).toHaveAttribute('href', '/master-data/product');
  });

  it('hides the directories link when Odoo is not connected', async () => {
    odoo.getConnection.mockResolvedValue({ status: 'inactive', activated: false });
    renderPage();
    await screen.findByRole('link', { name: /back to stock/i });
    expect(screen.queryByRole('link', { name: /odoo directories/i })).toBeNull();
  });
});
