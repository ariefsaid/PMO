import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import ExecutiveDashboard from '@/pages/ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';
import { BahasaProvider } from '@/test/bahasa';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const state = vi.hoisted(() => ({
  actual: 1_200_000 as number | null,
  approvals: [] as Array<{ id: string }>,
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({
    data: {
      active_projects: 1,
      active_delivery_projects: 1,
      total_contract_value: 2_000_000,
      on_hand_value: 2_000_000,
      on_hand_value_by_currency: [{
        currency: 'USD', contract_value: 2_000_000, actual_known: state.actual,
        contract_remaining: state.actual === null ? null : 2_000_000 - state.actual,
        actual_coverage_count: state.actual === null ? 0 : 1, actual_coverage_total: 1,
        realized_margin_known: null, unknown_projects: state.actual === null ? 1 : 0,
      }],
      total_contract_value_by_currency: { USD: 2_000_000 },
      on_hand_contract_remaining: state.actual === null ? null : 2_000_000 - state.actual,
      on_hand_realized_margin: null,
      on_hand_realized_margin_by_currency: [{ currency: 'USD', known_amount: null, unknown_projects: 1 }],
      on_hand_actual_known: state.actual,
      on_hand_actual_project_count: state.actual === null ? 0 : 1,
      on_hand_actual_project_total: 1,
      on_hand_actual_coverage_count: state.actual === null ? 0 : 1,
      on_hand_actual_coverage_total: 1,
      pipeline_total_value: 0,
      pipeline_weighted_value: 0,
      pipeline_projected_margin: null,
      pipeline_total_value_by_currency: [],
      projects_at_risk: 0,
      risk_unchecked_projects: state.actual === null ? 1 : 0,
      projects_by_status: [{ status: 'Ongoing Project', count: 1 }],
      procurements_by_status: [],
      top_projects: [{
        id: 'p1', name: 'Project North', client_name: null, contract_value: 2_000_000, currency: 'USD',
        budget: 3_000_000, budget_currency: 'USD', spent: state.actual, actual_currency: 'USD',
        actual_complete: state.actual !== null, actual_coverage_count: state.actual === null ? 0 : 1,
        actual_coverage_total: 1, status: 'Ongoing Project',
      }],
    },
    isPending: false, isError: false, refetch: vi.fn(),
  }),
  useSalesPipeline: () => ({ data: { stages: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({ useTimesheetsAwaitingApproval: () => ({ data: state.approvals, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'exec-1', org_id: 'org-1' }, role: 'Executive' }) }));
vi.mock('@/src/components/reports/BoardPackAction', () => ({ BoardPackAction: () => null }));

function renderDashboard() {
  setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
  return render(
    <BahasaProvider locale="id">
      <MemoryRouter><ToastProvider><ExecutiveDashboard /></ToastProvider></MemoryRouter>
    </BahasaProvider>,
  );
}

beforeEach(() => {
  state.actual = 1_200_000;
  state.approvals = [];
});
afterEach(() => resetActiveLocale());

describe('Executive dashboard localized figures', () => {
  it('formats a complete Actual using the organization number locale and preserves its currency', () => {
    renderDashboard();
    const delivery = screen.getByRole('region', { name: 'Portofolio pelaksanaan' });
    expect(delivery).toHaveTextContent('USD');
    expect(delivery).toHaveTextContent('1.200.000');
  });

  it('keeps a known zero distinct from unavailable Actual', () => {
    state.actual = 0;
    const known = renderDashboard();
    const actualRow = screen.getByTestId('dashboard-known-actual');
    expect(actualRow).toBeInTheDocument();
    expect(within(actualRow).getByText('0')).toBeInTheDocument();
    known.unmount();

    state.actual = null;
    renderDashboard();
    const unknownDelivery = screen.getByRole('region', { name: 'Portofolio pelaksanaan' });
    const unknownRow = screen.getByTestId('dashboard-known-actual');
    expect(unknownRow).toHaveTextContent('—');
    expect(within(unknownRow as HTMLElement).getByRole('link', { name: /USD/ })).toHaveAttribute('href', '#executive-actual-note');
    expect(unknownDelivery).toHaveTextContent('Beberapa nilai portofolio tidak tersedia');
  });

  it('AC-806-EXEC-ACTUAL-001: scopes incomplete Actual coverage and its next step beside the figure', () => {
    state.actual = null;
    renderDashboard();
    const note = screen.getByTestId('dashboard-actual-coverage-note');
    expect(note).toHaveTextContent('Aktual tersedia untuk 0 dari 1 proyek pelaksanaan');
    expect(note).toHaveTextContent('Cakupan aktual: 0 dari 1 kategori biaya terpetakan');
    expect(note.textContent).toMatch(/Tinjau pemetaan akuntansi|Minta administrator/);
    expect(screen.queryByText('Aktual beberapa proyek pelaksanaan belum lengkap.')).not.toBeInTheDocument();
  });

  it('keeps Indonesian risk action and project identity destinations', () => {
    state.approvals = [{ id: 't1' }];
    renderDashboard();
    expect(screen.getByRole('link', { name: 'Tinjau permintaan' })).toHaveAttribute('href', '/approvals');
    const delivery = screen.getByRole('region', { name: 'Portofolio pelaksanaan' });
    expect(within(delivery).getByRole('link', { name: 'Project North' })).toHaveAttribute('href', '/projects/p1');
  });
});
