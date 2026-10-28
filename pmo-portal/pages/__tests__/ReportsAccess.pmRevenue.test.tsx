/**
 * R-006 — Project Managers keep the revenue report for their projects.
 *
 * Restores the access the deleted Revenue-by-project page gave PMs (baseline fa511c382: the report used
 * `may('view','salesInvoice')`, Finance/PM/Executive/Admin). The replacement report lives at
 * /finance/reports; a PM must reach it from the rail and the route, read their projects' figures, and
 * still get no invoice write control. Engineers stay out. Runs against the REAL policy (only the role
 * and the data sources are stubbed), so it binds the route guard, the page gate and the rail together.
 */
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

describe('R-006 — Project Manager access to the revenue report', () => {
  it('R-006: the /finance/reports route opens the report for a Project Manager; an Engineer is still refused', async () => {
    renderReportsRoute();
    expect(await screen.findByRole('region', { name: 'Report figures' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText("You don't have access to the management pack")).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Finance' })).not.toBeInTheDocument();

    cleanup();
    h.role = 'Engineer';
    renderReportsRoute();
    expect(await screen.findByText(/Finance is available to Finance, Executive and Admin roles|You don't have access to the management pack/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Report figures' })).not.toBeInTheDocument();
  });

  it('R-006: a Project Manager reads their projects’ revenue but gets no invoice write action', () => {
    render(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Report figures' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();

    cleanup();
    h.query = { ...h.query, data: buildManagementPack({ ...facts, projects: [], invoiced: [] }) };
    render(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);
    expect(screen.getByText('No projects to report')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument();
  });

  it('R-006: the rail gives a Project Manager Reports (→ /finance/reports) without the Finance section, and only while Revenue is on', () => {
    render(<MemoryRouter><Rail /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/finance/reports');
    expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Receivables' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Statements' })).not.toBeInTheDocument();

    cleanup();
    h.revenue = false;
    render(<MemoryRouter><Rail /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();

    cleanup();
    h.revenue = true;
    h.role = 'Engineer';
    render(<MemoryRouter><Rail /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  });
});
