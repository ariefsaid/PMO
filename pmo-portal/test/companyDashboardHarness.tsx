import React from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui/Toast';
import { BahasaProvider } from './bahasa';

const dashboardHarness = vi.hoisted(() => ({
  role: 'Executive',
  dashboard: null as Record<string, unknown> | null,
  today: [] as Array<Record<string, unknown>>,
  period: [] as Array<Record<string, unknown>>,
  needsItems: [] as Array<Record<string, unknown>>,
  areaItems: [] as Array<Record<string, unknown>>,
  pipeline: { stages: [] as Array<Record<string, unknown>>, projects: [] as Array<Record<string, unknown>> },
  pipelinePending: false,
  pipelineError: false,
}));
export const getDashboardHarness = () => dashboardHarness;

const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });

vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: dashboardHarness.role, realRole: dashboardHarness.role }) }));
vi.mock('@/src/components/dashboard/restructure/useCompanyFigures', () => ({
  useCompanyFigures: () => ({
    today: dashboardHarness.today,
    period: dashboardHarness.period,
    todayPending: false,
    todayError: false,
    periodPending: false,
    periodError: false,
    todayRetry: vi.fn(),
    periodRetry: vi.fn(),
    dashboard: dashboardHarness.dashboard,
    dashboardPending: false,
    dashboardError: false,
    dashboardRetry: vi.fn(),
    pipeline: dashboardHarness.pipeline,
    pipelinePending: dashboardHarness.pipelinePending,
    pipelineError: dashboardHarness.pipelineError,
    pipelineRetry: vi.fn(),
    winRateRange: { key: 'test-period', from: new Date(2026, 0, 1), to: new Date(2026, 9, 27) },
    orgCurrency: 'USD',
    currencyPending: false,
    organizationToday: '2026-10-27',
    organizationDayPending: false,
    isEmpty: false,
  }),
}));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({
  useNeedsYou: () => ({ items: dashboardHarness.needsItems, areaItems: dashboardHarness.areaItems, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({ data: dashboardHarness.pipeline, isPending: dashboardHarness.pipelinePending, isError: dashboardHarness.pipelineError, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ok([]),
  useWinRate: () => ok(null),
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ok([]) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ok([]) }));
vi.mock('@/src/hooks/useErpSnapshots', () => ({ useActualsSnapshot: () => ok([]), useApAgingSnapshot: () => ok([]), useArAgingSnapshot: () => ok([]) }));
vi.mock('@/src/hooks/useFinancePosition', () => ({ useFinancePosition: () => ({ position: { receivablesAgeing: {}, payablesAgeing: {} }, isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));

import { CompanyDashboard } from '@/src/components/dashboard/hub/company/CompanyDashboard';

export function resetCompanyDashboardHarness() {
  dashboardHarness.role = 'Executive';
  dashboardHarness.dashboard = {
    active_projects: 2,
    active_delivery_projects: 7,
    active_delivery_actual_project_count: 2,
    risk_unchecked_projects: 5,
    projects_at_risk: 1,
    projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
    procurements_by_status: [],
    pipeline_projected_margin: null,
    on_hand_actual_coverage_count: 1,
    on_hand_actual_coverage_total: 2,
    top_projects: [{
      id: 'p1', name: 'Alpha', client_name: null, contract_value: 1_000, currency: 'USD', budget: null,
      spent: 500, actual_currency: 'USD', actual_complete: true, status: 'Ongoing Project',
    }],
  };
  dashboardHarness.today = [{ id: 'contract-on-hand', label: 'Contract on hand', value: '$1,000', href: '/projects?filter=Ongoing' }];
  dashboardHarness.period = [];
  dashboardHarness.needsItems = [];
  dashboardHarness.areaItems = [{ id: 'at-risk', count: 1, label: 'project at risk', href: '/projects?filter=at-risk', tone: 'warn' }];
  dashboardHarness.pipeline = { stages: [], projects: [] };
  dashboardHarness.pipelinePending = false;
  dashboardHarness.pipelineError = false;
}

export function renderCompanyDashboard(locale: 'en' | 'id' = 'en') {
  return render(
    <BahasaProvider locale={locale}>
      <MemoryRouter><ToastProvider><CompanyDashboard role="Executive" /></ToastProvider></MemoryRouter>
    </BahasaProvider>,
  );
}
