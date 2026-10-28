/** SP-1 — Reports follows the Finance area access ruling: Finance, Executive and Admin only. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { matchRoutes, MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { buildManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';

const h = vi.hoisted(() => ({
  role: 'Project Manager' as string,
  revenue: true,
  query: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown, refetch: () => Promise.resolve() },
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { revenue: h.revenue }, isPending: false, isLoading: false, isError: false }),
}));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => h.query,
  useRecordProjectProgress: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {} }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: 'p1', name: 'Alpha', pm: { full_name: 'Test Manager' } }] }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useRevenuePerProject: () => ({ data: [{ project_id: 'p1', currency: 'IDR', total_amount: 250, open_ar: 0, invoice_count: 1 }], isPending: false, isError: false }),
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'IDR',
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));

import { appRouteConfig } from '../../App';
import ManagementPack from '../ManagementPack';
import { Rail } from '@/src/components/shell/Rail';

const facts: ManagementPackFacts = {
  from: '2026-03-01', to: '2026-04-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [{
    id: 'p1', name: 'Alpha', pmo_project_number: null, code: null, status: 'Ongoing Project', currency: 'IDR',
    contract_net: 1_000, start_date: null, end_date: null, project_manager_id: 'u-pm', client_name: null,
  }],
  invoiced: [{ project_id: 'p1', currency: 'IDR', month: '2026-04-01', net: 250, invoice_count: 1 }],
  invoiced_before: [], progress: [],
};

const renderReportsRoute = () => {
  const route = matchRoutes(appRouteConfig, '/finance/reports')?.at(-1)?.route;
  return render(
    <MemoryRouter initialEntries={['/finance/reports']}>
      <ToastProvider>
        <Routes>
          <Route path="/finance/reports" element={route?.element} />
          <Route path="*" element={<div>ELSEWHERE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  cleanup();
  h.role = 'Project Manager';
  h.revenue = true;
  h.query = { data: buildManagementPack(facts), isPending: false, isError: false, error: null, refetch: () => Promise.resolve() };
});

describe('SP-1 — Reports follows Finance access', () => {
  it('allows Finance, Executive and Admin, and refuses Project Managers and Engineers at the route', async () => {
    for (const role of ['Finance', 'Executive', 'Admin']) {
      h.role = role;
      renderReportsRoute();
      expect(await screen.findByRole('region', { name: 'Report figures' })).toBeInTheDocument();
      cleanup();
    }

    for (const role of ['Project Manager', 'Engineer']) {
      h.role = role;
      renderReportsRoute();
      expect(screen.getByText(/Finance is available to Finance, Executive and Admin roles/)).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Report figures' })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('keeps the page-level gate closed to a Project Manager when rendered directly', () => {
    h.role = 'Project Manager';
    render(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);
    expect(screen.getByText(/Finance reports are available to Finance, Executive and Admin roles/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Report figures' })).not.toBeInTheDocument();
  });

  it('shows Reports in the Finance rail group only for Finance, Executive and Admin', () => {
    for (const role of ['Finance', 'Executive', 'Admin']) {
      h.role = role;
      render(<MemoryRouter><Rail /></MemoryRouter>);
      expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/finance/reports');
      cleanup();
    }

    h.role = 'Project Manager';
    render(<MemoryRouter><Rail /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
    cleanup();

    h.role = 'Engineer';
    render(<MemoryRouter><Rail /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  });
});
