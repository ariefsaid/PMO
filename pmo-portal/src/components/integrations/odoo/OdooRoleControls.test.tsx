import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({
  getConnection: vi.fn(), setup: vi.fn(), listMasterRecords: vi.fn(), masterSummary: vi.fn(), listOwn: vi.fn(),
}));
// The global setup stubs the section for the Integrations view suites; this suite tests the real one.
vi.unmock('@/src/components/integrations/odoo/OdooIntegrationSection');
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { odoo: h, integrations: {} } }));
vi.mock('@/src/lib/db/externalDomainOwnership', () => ({ listOwnExternalDomainOwnership: h.listOwn }));

import { OdooIntegrationSection } from './OdooIntegrationSection';
import MasterDataPage from '@/pages/MasterData';

const fresh = new Date(Date.now() - 30_000).toISOString();
beforeEach(() => {
  vi.clearAllMocks();
  h.getConnection.mockResolvedValue({ status: 'active', activated: true, capabilities: { missing: [], version_major: 20 },
    connection: { state: 'healthy', failures: 0, last_ok_at: fresh, last_checked_at: fresh, error_class: null, missing: [] }, config: { odoo_company_name: 'PT Contoh', database: 'db' } });
  h.listMasterRecords.mockResolvedValue({ rows: [], total: 0 });
  h.masterSummary.mockResolvedValue({ inactive: 0, tombstoned: 0, asOf: null });
  h.listOwn.mockResolvedValue([]);
});
afterEach(cleanup);

function ViewAsEngineer({ children }: { children: React.ReactNode }) {
  const { viewAs } = useEffectiveRole();
  React.useEffect(() => { viewAs('Engineer'); }, [viewAs]);
  return <>{children}</>;
}
function mount(role: string, ui: React.ReactNode, path = '/x', viewAs = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const body = viewAs ? <ViewAsEngineer>{ui}</ViewAsEngineer> : ui;
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={role as never} demoEligibility={viewAs ? 'eligible' : 'pending'}>
        <MemoryRouter initialEntries={[path]}><Routes><Route path="/master-data/:kind" element={body} /><Route path="*" element={body} /></Routes></MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}

// [role, viewAs, Re-check, Disconnect, Refresh now, setup steps]
const CARD: Array<[string, boolean, boolean, boolean, boolean, boolean]> = [
  ['Admin', false, true, true, true, true],
  ['Finance', false, false, false, true, true],
  ['Executive', false, false, false, false, false],
  ['Project Manager', false, false, false, false, false],
  ['Engineer', false, false, false, false, false],
  ['Admin', true, false, false, false, false],
];

it.each(CARD)('AC-ODC-082 card and steps for %s (view-as %s)', async (role, viewAs, recheck, disconnect, refresh, steps) => {
  mount(role, <OdooIntegrationSection />, '/x', viewAs);
  expect(await screen.findByText('PT Contoh')).toBeInTheDocument();
  const has = (name: string) => screen.queryByRole('button', { name }) !== null;
  expect([has('Re-check'), has('Disconnect Odoo'), has('Refresh now'), screen.queryByTestId('odoo-checklist') !== null]).toEqual([recheck, disconnect, refresh, steps]);
});

const DIRECTORY: Array<[string, boolean, boolean]> = [
  ['Admin', false, true], ['Executive', false, true], ['Finance', false, true],
  ['Project Manager', false, false], ['Engineer', false, false], ['Admin', true, false],
];
it.each(DIRECTORY)('AC-ODC-082 directory tabs for %s (view-as %s): financial tabs %s', async (role, viewAs, financial) => {
  mount(role, <MasterDataPage />, '/master-data/product', viewAs);
  await screen.findAllByRole('tab');
  const names = screen.getAllByRole('tab').map((t) => t.textContent);
  expect(names.includes('Accounts') && names.includes('Taxes')).toBe(financial);
  expect(names).toContain('Items');
});

const PROPOSAL = { proposals: [], accounts: [], uoms: [], warehouses: [], units: [], current: { account_defaults: {}, unit_map: {}, default_warehouse_id: null }, attention: [] };
it.each([['Admin', false, true], ['Finance', false, true], ['Executive', false, false], ['Project Manager', false, false], ['Engineer', false, false], ['Admin', true, false]] as Array<[string, boolean, boolean]>)(
  'AC-ODC-070 the map-once screen for %s (view-as %s): shown %s', async (role, viewAs, shown) => {
    h.setup.mockResolvedValue(PROPOSAL);
    mount(role, <OdooIntegrationSection />, '/x', viewAs);
    expect(await screen.findByText('PT Contoh')).toBeInTheDocument();
    if (shown) expect(await screen.findByTestId('odoo-map-once')).toBeInTheDocument();
    else expect(screen.queryByTestId('odoo-map-once')).not.toBeInTheDocument();
    expect(h.setup.mock.calls.some(([verb]) => verb === 'propose-config')).toBe(shown);
  });
