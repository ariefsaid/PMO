import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { MemoryRouter } from 'react-router';
import enCatalogue from '../../../../public/locales/en/common.json';
import idCatalogue from '../../../../public/locales/id/common.json';
import enDashboardCatalogue from '../../../../public/locales/en/dashboard.json';
import idDashboardCatalogue from '../../../../public/locales/id/dashboard.json';
import { FinanceDashboard } from '../FinanceDashboard';
import type { BudgetReviewRow } from '@/src/lib/db/dashboard';
import { formatCurrency } from '@/src/lib/format';

const dashboard = {
  active_projects: 0,
  total_contract_value: 0,
  on_hand_actual_known: 0,
  on_hand_actual_project_count: 0,
  on_hand_actual_project_total: 0,
  on_hand_actual_coverage_count: 0,
  on_hand_actual_coverage_total: 0,
  on_hand_contract_remaining: 0,
  on_hand_realized_margin: 0,
  pipeline_total_value: 0,
  pipeline_weighted_value: 0,
  pipeline_projected_margin: 0,
  projects_at_risk: 0,
  projects_by_status: [],
  procurements_by_status: [],
  top_projects: [],
};

const state = vi.hoisted(() => ({ rows: [] as BudgetReviewRow[] }));

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: dashboard, isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: state.rows, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }), useProjectIdentity: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useCompanyCollections', () => ({
  useCompanyCollections: () => ({ customerLinks: new Map() }),
}));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [] }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'finance-user', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/components/dashboard/StillToInvoiceCard', () => ({ StillToInvoiceCard: () => null }));

const row = (input: Partial<BudgetReviewRow> & Pick<BudgetReviewRow, 'id' | 'name'>): BudgetReviewRow => {
  const { id, name, ...overrides } = input;
  return {
    id,
    name,
    client_name: null,
    status: 'Ongoing Project',
    currency: 'USD',
    budget: 100,
    budget_currency: 'USD',
    spent: 50,
    variance: -50,
    actual_currency: 'USD',
    actual_complete: true,
    actual_coverage_count: 1,
    actual_coverage_total: 1,
    actual_as_of: '2026-10-17T12:00:00Z',
    ...overrides,
  };
};

async function renderPane(rows: BudgetReviewRow[], locale: 'en' | 'id' = 'en') {
  state.rows = rows;
  const instance = i18next.createInstance();
  await instance.init({
    lng: locale,
    fallbackLng: 'en',
    defaultNS: 'common',
    fallbackNS: 'common',
    resources: {
      en: { common: enCatalogue, dashboard: enDashboardCatalogue },
      id: { common: idCatalogue, dashboard: idDashboardCatalogue },
    },
  });
  return render(
    <I18nextProvider i18n={instance}>
      <MemoryRouter><FinanceDashboard /></MemoryRouter>
    </I18nextProvider>,
  );
}

function budgetReviewTable() {
  return screen.getAllByRole('table')[1];
}

afterEach(() => {
  cleanup();
  state.rows = [];
});

describe('AC-FAA-003 Finance Actual alignment', () => {
  it('uses the shared risk rule at 90%, and keeps terminal or pipeline overages out of the warning', async () => {
    await renderPane([
      row({ id: 'below', name: 'Below threshold', spent: 89.99, variance: -10.01 }),
      row({ id: 'threshold', name: 'At threshold', status: 'Won, Pending KoM', spent: 90, variance: -10 }),
      row({ id: 'full', name: 'Fully used', status: 'Internal Project', spent: 100, variance: 0 }),
      row({ id: 'close', name: 'Closed over budget', status: 'Close Out', spent: 120, variance: 20 }),
      row({ id: 'pipeline', name: 'Pipeline over budget', status: 'Tender Submitted', spent: 200, variance: 100 }),
    ]);

    const table = budgetReviewTable();
    expect(within(table).getAllByText('At risk')).toHaveLength(2);
    expect(within(table).getByText('Below threshold')).toBeInTheDocument();
    expect(within(table).getByText('Closed over budget')).toBeInTheDocument();
    expect(within(table).getByText('Pipeline over budget')).toBeInTheDocument();
  });

  it('keeps a genuine zero Actual while withholding partial and incompatible comparisons', async () => {
    await renderPane([
      row({ id: 'zero', name: 'Known zero', status: 'On Hold', spent: 0, variance: -100 }),
      row({
        id: 'partial', name: 'Partial Actual', currency: 'IDR', budget: 1000, budget_currency: 'IDR',
        spent: null, variance: null, actual_currency: 'IDR', actual_complete: false,
        actual_coverage_count: 1, actual_coverage_total: 2,
      }),
      row({
        id: 'mixed', name: 'Different currencies', currency: 'IDR', budget: 1500, budget_currency: 'IDR',
        spent: 75, variance: null, actual_currency: 'USD', actual_complete: true,
      }),
    ]);

    const table = budgetReviewTable();
    expect(within(table).getByText(formatCurrency(0, 'USD'))).toBeInTheDocument();
    expect(within(table).getByRole('progressbar', { name: 'Known zero budget utilization' })).toHaveAttribute('aria-valuenow', '0');
    expect(within(table).getByText('Partial Actual')).toBeInTheDocument();
    expect(within(table).getByText('Different currencies')).toBeInTheDocument();
    expect(within(table).getByText(/IDR\s+1,500/)).toBeInTheDocument();
    expect(within(table).getByText(formatCurrency(75, 'USD'))).toBeInTheDocument();
    expect(table).toHaveTextContent('Source currency: IDR');
    expect(table).toHaveTextContent('Actual coverage: 1 of 2 mapped cost categories');
    expect(table).toHaveTextContent('As of Oct 17, 2026');
    expect(within(table).getAllByText('Not available yet')).toHaveLength(5);
    expect(within(table).queryByRole('progressbar', { name: 'Partial Actual budget utilization' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('progressbar', { name: 'Different currencies budget utilization' })).not.toBeInTheDocument();
    expect(within(table).getByText(/1 of 2 mapped cost categories/)).toBeInTheDocument();
  });

  it('sorts unknown Actual last in either direction and keeps only five rows', async () => {
    await renderPane([
      row({ id: 'a', name: 'Alpha', spent: 110, variance: 10 }),
      row({ id: 'b', name: 'Beta', spent: 105, variance: 5 }),
      row({ id: 'a-tie', name: 'Tie A', spent: 95, variance: -5 }),
      row({ id: 'z-tie', name: 'Tie Z', spent: 95, variance: -5 }),
      row({ id: 'unknown-a', name: 'Unknown A', spent: null, variance: null, actual_complete: false }),
      row({ id: 'unknown-b', name: 'Unknown B', spent: null, variance: null, actual_complete: false }),
    ]);

    const table = budgetReviewTable();
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).queryByText('Unknown B')).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Variance' }));
    const rowsAscending = within(table).getAllByRole('row').slice(1).map((rowNode) => rowNode.textContent ?? '');
    expect(rowsAscending.slice(0, 4).map((text) => text.match(/Alpha|Beta|Tie A|Tie Z/)?.[0])).toEqual([
      'Tie A', 'Tie Z', 'Beta', 'Alpha',
    ]);
    expect(rowsAscending.at(-1)).toContain('Unknown A');
  });
});

describe('AC-FAA-004 Finance labels and empty state', () => {
  it('labels each money basis and explains eligible Active budgets in English and Bahasa', async () => {
    const english = await renderPane([], 'en');
    expect(screen.getByText('Active budget', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Actual', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Variance', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Utilization', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('No active budgets ready for review')).toBeInTheDocument();
    expect(screen.getByText('Active, positive-value budgets appear here.')).toBeInTheDocument();
    english.unmount();

    await renderPane([], 'id');
    expect(screen.getByText('Anggaran aktif', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Aktual', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Selisih', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Pemakaian', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Belum ada anggaran aktif yang siap ditinjau')).toBeInTheDocument();
  });
});

describe('Finance dashboard Bahasa copy', () => {
  it('keeps the English labels and renders the corresponding Indonesian dashboard copy', async () => {
    const english = await renderPane([], 'en');
    expect(screen.getByRole('heading', { name: 'Finance Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Portfolio revenue, spend, margin, and budget utilization.')).toBeInTheDocument();
    expect(screen.getByText('Budget review — top 5 by variance (portfolio-wide)')).toBeInTheDocument();
    expect(within(budgetReviewTable()).getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByText('Ready to pay', { exact: true })).toBeInTheDocument();
    english.unmount();

    await renderPane([], 'id');
    expect(screen.getByRole('heading', { name: 'Dasbor Keuangan' })).toBeInTheDocument();
    expect(screen.getByText('Pendapatan, pengeluaran, margin, dan pemakaian anggaran portofolio.')).toBeInTheDocument();
    expect(screen.getByText('Tinjauan anggaran — 5 teratas berdasarkan selisih (seluruh portofolio)')).toBeInTheDocument();
    expect(within(budgetReviewTable()).getByRole('columnheader', { name: 'Proyek' })).toBeInTheDocument();
    expect(screen.getByText('Siap dibayar', { exact: true })).toBeInTheDocument();
  });
});
