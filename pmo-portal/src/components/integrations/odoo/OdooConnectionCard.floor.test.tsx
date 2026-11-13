/**
 * Floor test for the Odoo integration card's door into the master data (floor-wave2).
 *
 * Master-data.md item 1: the card names "Browse Odoo directories" only on an active, activated
 * connection — this drives it and asserts the directory route it opens.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({ getConnection: vi.fn(), setup: vi.fn() }));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    odoo: { getConnection: h.getConnection, setup: h.setup },
    integrations: { connectIntegration: vi.fn(), disconnectIntegration: vi.fn() },
  },
}));

import { OdooConnectionCard } from './OdooConnectionCard';

const recent = () => new Date(Date.now() - 60_000).toISOString();
const connected = () => ({
  status: 'active',
  activated: true,
  connection: { state: 'healthy', failures: 0, last_ok_at: recent(), last_checked_at: recent(), error_class: null, missing: [] },
  capabilities: { missing: [], version_major: 20 },
  config: { database: 'prod_db', odoo_company_name: 'PT Contoh' },
});

const Where: React.FC = () => {
  const location = useLocation();
  return <div data-testid="where" data-pathname={location.pathname} />;
};

const mount = () => {
  h.getConnection.mockResolvedValue(connected());
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={'Admin' as never}>
        <MemoryRouter initialEntries={['/integrations']}>
          <Where />
          <Routes>
            <Route path="/integrations" element={<OdooConnectionCard />} />
            <Route path="*" element={<div data-testid="landed" />} />
          </Routes>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => { vi.clearAllMocks(); h.setup.mockResolvedValue({ ok: true }); });

describe('Odoo connection card floor', () => {
  it('floor: Browse Odoo directories opens the Items directory', async () => {
    mount();
    await userEvent.click(await screen.findByRole('link', { name: 'Browse Odoo directories' }));
    expect(screen.getByTestId('where').dataset.pathname).toBe('/master-data/product');
  });
});
